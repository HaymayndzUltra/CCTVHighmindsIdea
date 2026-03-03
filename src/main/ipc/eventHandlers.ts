import { ipcMain, BrowserWindow } from 'electron';
import fs from 'node:fs';
import { getEvents } from '../services/DatabaseService';
import type { EventFilters } from '../../shared/types';

interface EventListPayload {
  filters: EventFilters;
}

/**
 * Emit a new event to all renderer windows via IPC push.
 * Called by EventProcessor after creating an event record.
 */
export function emitNewEvent(eventData: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('event:new', eventData);
    }
  }
}

export function registerEventHandlers(): void {
  ipcMain.handle('event:list', (_event, payload: EventListPayload) => {
    const filters = payload?.filters ?? {};

    try {
      const rows = getEvents(filters);

      return rows.map((row) => ({
        id: row.id,
        cameraId: row.camera_id,
        personId: row.person_id,
        personName: row.person_name ?? 'Unknown',
        isKnown: row.is_known === 1,
        direction: row.direction,
        detectionMethod: row.detection_method,
        confidence: row.confidence ?? 0,
        bbox: row.bbox ? (() => { try { return JSON.parse(row.bbox); } catch { return null; } })() : null,
        snapshotPath: row.snapshot_path,
        clipPath: row.clip_path,
        telegramSent: row.telegram_sent === 1,
        telegramSentAt: row.telegram_sent_at,
        createdAt: row.created_at,
        eventType: row.event_type ?? 'detection',
        trackId: row.track_id ?? null,
        globalPersonId: row.global_person_id ?? null,
        zoneId: row.zone_id ?? null,
        journeyId: row.journey_id ?? null,
        behaviorType: row.behavior_type ?? null,
        soundEventType: row.sound_event_type ?? null,
        soundConfidence: row.sound_confidence ?? null,
        livenessScore: row.liveness_score ?? null,
        isLive: row.is_live != null ? row.is_live === 1 : null,
        identityMethod: row.identity_method ?? null,
        identityFusionScore: row.identity_fusion_score ?? null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][event:list] Error querying events: ${message}`);
      throw new Error(`Failed to list events: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('event:snapshot-base64', (_event, payload: { snapshotPath: string }) => {
    if (!payload?.snapshotPath) return null;
    try {
      if (!fs.existsSync(payload.snapshotPath)) return null;
      return fs.readFileSync(payload.snapshotPath).toString('base64');
    } catch {
      return null;
    }
  });

  console.log('[IPC] Event handlers registered.');
}
