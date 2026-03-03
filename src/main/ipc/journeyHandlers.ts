import { ipcMain } from 'electron';
import { journeyService } from '../services/JourneyService';
import { presenceService } from '../services/PresenceService';
import { getJourneysByPerson, getPresenceHistory } from '../services/DatabaseService';

export function registerJourneyHandlers(): void {
  // --- Journey Handlers ---

  ipcMain.handle('journey:list', (_event, payload?: { personId?: string }) => {
    try {
      if (payload?.personId) {
        const rows = getJourneysByPerson(payload.personId) as Array<Record<string, unknown>>;
        return {
          journeys: rows.map((row) => ({
            id: row.id,
            personId: row.person_id,
            personName: row.person_name,
            globalPersonId: row.global_person_id,
            status: row.status,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            totalDurationSec: row.total_duration_sec,
            path: (() => { try { return JSON.parse(row.path as string); } catch { return []; } })(),
            createdAt: row.created_at,
          })),
        };
      }

      // Return active journeys from in-memory state
      const active = journeyService.getActiveJourneysList();
      return {
        journeys: active.map((j) => ({
          id: j.id,
          personId: j.personId,
          personName: j.personName,
          globalPersonId: j.globalPersonId,
          status: 'active',
          startedAt: new Date(j.startedAt).toISOString(),
          completedAt: null,
          totalDurationSec: j.steps.length > 1
            ? (j.lastTimestamp - j.startedAt) / 1000
            : null,
          path: j.steps,
          createdAt: new Date(j.startedAt).toISOString(),
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][journey:list] Error: ${message}`);
      throw new Error(`Failed to list journeys: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('journey:active', () => {
    try {
      const active = journeyService.getActiveJourneysList();
      return {
        journeys: active.map((j) => ({
          id: j.id,
          personId: j.personId,
          personName: j.personName,
          globalPersonId: j.globalPersonId,
          status: 'active',
          steps: j.steps,
          lastCameraId: j.lastCameraId,
          summary: journeyService.formatJourneySummary(j),
          startedAt: new Date(j.startedAt).toISOString(),
          durationSec: j.steps.length > 1
            ? (j.lastTimestamp - j.startedAt) / 1000
            : 0,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][journey:active] Error: ${message}`);
      throw new Error(`Failed to get active journeys: ${message}`, { cause: error });
    }
  });

  // --- Presence Handlers ---

  ipcMain.handle('presence:list', () => {
    try {
      const states = presenceService.getAllPresenceStates();
      return {
        presences: states.map((s) => ({
          personId: s.personId,
          personName: s.personName,
          state: s.state,
          lastCameraId: s.lastCameraId,
          lastSeenAt: s.lastSeenAt > 0 ? new Date(s.lastSeenAt).toISOString() : null,
          stateChangedAt: s.stateChangedAt > 0 ? new Date(s.stateChangedAt).toISOString() : null,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][presence:list] Error: ${message}`);
      throw new Error(`Failed to list presence states: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('presence:history', (_event, payload: { personId: string; limit?: number }) => {
    if (!payload?.personId) {
      throw new Error('personId is required.');
    }

    try {
      const rows = getPresenceHistory(payload.personId, payload.limit ?? 50) as Array<Record<string, unknown>>;
      return {
        history: rows.map((row) => ({
          id: row.id,
          personId: row.person_id,
          state: row.state,
          previousState: row.previous_state,
          triggerCameraId: row.trigger_camera_id,
          triggerReason: row.trigger_reason,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][presence:history] Error: ${message}`);
      throw new Error(`Failed to get presence history: ${message}`, { cause: error });
    }
  });

  console.log('[IPC] Journey + Presence handlers registered.');
}
