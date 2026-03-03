import { ipcMain } from 'electron';
import {
  createPerson,
  getPersons,
  updatePerson,
  deletePerson,
  storeEmbedding,
  PersonRow,
} from '../services/DatabaseService';
import { enrollPerson, addNegative, listNegatives, deleteNegative, syncEmbeddingsToSidecar } from '../services/AIBridgeService';

interface EnrollPayload {
  personName: string;
  label?: string;
  imageData: string[];
  source: 'upload' | 'capture' | 'event';
}

interface DeletePayload {
  personId: string;
}

interface TogglePayload {
  personId: string;
  enabled: boolean;
}

function personRowToResponse(row: PersonRow) {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    enabled: row.enabled === 1,
    telegramNotify: row.telegram_notify as 'immediate' | 'silent_log' | 'daily_summary',
    embeddingsCount: row.embeddings_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    presenceState: row.presence_state ?? 'UNKNOWN',
    presenceUpdatedAt: (row as unknown as Record<string, unknown>).presence_updated_at as string | null ?? null,
    lastSeenCameraId: row.last_seen_camera_id ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    autoEnrollCount: row.auto_enroll_count ?? 0,
    autoEnrollEnabled: (row.auto_enroll_enabled ?? 1) === 1,
    adaptiveThreshold: row.adaptive_threshold ?? null,
    globalPersonId: row.global_person_id ?? null,
  };
}

export function registerPersonHandlers(): void {
  ipcMain.handle('person:enroll', async (_event, payload: EnrollPayload) => {
    if (!payload || !payload.personName) {
      console.error('[IPC][person:enroll] Missing personName in payload.');
      throw new Error('personName is required.');
    }
    if (!payload.imageData || payload.imageData.length === 0) {
      console.error('[IPC][person:enroll] No images provided.');
      throw new Error('At least one image is required.');
    }

    try {
      const personId = createPerson(payload.personName, payload.label);

      const result = await enrollPerson(
        personId,
        payload.personName,
        payload.imageData
      );

      if (!result.success || result.embeddings.length === 0) {
        deletePerson(personId);
        return {
          success: false,
          embeddingsCount: 0,
          errors: result.errors.length > 0
            ? result.errors
            : ['No valid face embeddings could be extracted from the provided images.'],
        };
      }

      for (const embedding of result.embeddings) {
        storeEmbedding(personId, embedding, payload.source, payload.personName);
      }

      console.log(
        `[IPC][person:enroll] Enrolled "${payload.personName}" (${personId}) with ${result.embeddings.length} embedding(s).`
      );

      // Sync updated embeddings to sidecar (fire-and-forget)
      syncEmbeddingsToSidecar().catch((err) => {
        console.error('[IPC][person:enroll] Embeddings sync failed:', err);
      });

      return {
        success: true,
        embeddingsCount: result.embeddings.length,
        errors: result.errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:enroll] Error: ${message}`);
      throw new Error(`Enrollment failed: ${message}`);
    }
  });

  ipcMain.handle('person:list', (_event) => {
    try {
      const rows = getPersons();
      return rows.map(personRowToResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:list] Error: ${message}`);
      throw new Error(`Failed to list persons: ${message}`);
    }
  });

  ipcMain.handle('person:delete', (_event, payload: DeletePayload) => {
    if (!payload || !payload.personId) {
      console.error('[IPC][person:delete] Missing personId in payload.');
      throw new Error('personId is required.');
    }

    try {
      deletePerson(payload.personId);

      // Sync updated embeddings to sidecar (fire-and-forget)
      syncEmbeddingsToSidecar().catch((err) => {
        console.error('[IPC][person:delete] Embeddings sync failed:', err);
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:delete] Error: ${message}`);
      throw new Error(`Failed to delete person: ${message}`);
    }
  });

  ipcMain.handle('person:toggle', (_event, payload: TogglePayload) => {
    if (!payload || !payload.personId) {
      console.error('[IPC][person:toggle] Missing personId in payload.');
      throw new Error('personId is required.');
    }

    try {
      updatePerson(payload.personId, { enabled: payload.enabled });

      // Sync updated embeddings to sidecar (enabled/disabled affects gallery)
      syncEmbeddingsToSidecar().catch((err) => {
        console.error('[IPC][person:toggle] Embeddings sync failed:', err);
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:toggle] Error: ${message}`);
      throw new Error(`Failed to toggle person: ${message}`);
    }
  });

  ipcMain.handle('person:negative-add', async (_event, payload: { personId: string; cropBase64: string; sourceEventId?: string }) => {
    if (!payload || !payload.personId) {
      console.error('[IPC][person:negative-add] Missing personId in payload.');
      throw new Error('personId is required.');
    }
    if (!payload.cropBase64) {
      console.error('[IPC][person:negative-add] Missing cropBase64 in payload.');
      throw new Error('cropBase64 is required.');
    }
    try {
      const result = await addNegative(payload.personId, payload.cropBase64, payload.sourceEventId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:negative-add] Error: ${message}`);
      throw new Error(`Failed to add negative: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('person:negative-list', async (_event, payload: { personId: string }) => {
    if (!payload || !payload.personId) {
      console.error('[IPC][person:negative-list] Missing personId in payload.');
      throw new Error('personId is required.');
    }
    try {
      const result = await listNegatives(payload.personId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:negative-list] Error: ${message}`);
      throw new Error(`Failed to list negatives: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('person:negative-delete', async (_event, payload: { negativeId: string }) => {
    if (!payload || !payload.negativeId) {
      console.error('[IPC][person:negative-delete] Missing negativeId in payload.');
      throw new Error('negativeId is required.');
    }
    try {
      const result = await deleteNegative(payload.negativeId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][person:negative-delete] Error: ${message}`);
      throw new Error(`Failed to delete negative: ${message}`, { cause: error });
    }
  });

  console.log('[IPC] Person handlers registered.');
}
