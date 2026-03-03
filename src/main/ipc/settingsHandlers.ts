import { ipcMain } from 'electron';
import {
  getSetting,
  setSetting,
  purgeAllFaces,
  deleteEventsOlderThan,
  getEventsCount,
  getDatabaseFileSize,
  getCamerasConnectedCount,
} from '../services/DatabaseService';
import { getSidecarStatus } from '../services/ProcessManager';

export function registerSettingsHandlers(): void {
  // --- Settings CRUD ---

  ipcMain.handle('settings:get', (_event, payload: { key: string }) => {
    if (!payload || !payload.key) {
      console.error('[IPC][settings:get] Missing key in payload.');
      throw new Error('key is required.');
    }

    try {
      const value = getSetting(payload.key);
      return { value: value ?? '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][settings:get] Error reading setting "${payload.key}": ${message}`);
      throw new Error(`Failed to get setting: ${message}`);
    }
  });

  ipcMain.handle('settings:set', (_event, payload: { key: string; value: string }) => {
    if (!payload || !payload.key) {
      console.error('[IPC][settings:set] Missing key in payload.');
      throw new Error('key is required.');
    }

    try {
      setSetting(payload.key, payload.value);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][settings:set] Error writing setting "${payload.key}": ${message}`);
      throw new Error(`Failed to set setting: ${message}`);
    }
  });

  // --- Privacy ---

  ipcMain.handle('privacy:purge-all-faces', () => {
    try {
      purgeAllFaces();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][privacy:purge-all-faces] Error: ${message}`);
      throw new Error(`Failed to purge face data: ${message}`);
    }
  });

  ipcMain.handle('privacy:purge-old-events', () => {
    try {
      const retentionDaysStr = getSetting('retention_days');
      const retentionDays = parseInt(retentionDaysStr || '90', 10);

      if (retentionDays <= 0) {
        return { deletedCount: 0 };
      }

      const deletedCount = deleteEventsOlderThan(retentionDays);
      return { deletedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][privacy:purge-old-events] Error: ${message}`);
      throw new Error(`Failed to purge old events: ${message}`);
    }
  });

  // --- System Status ---

  ipcMain.handle('system:status', () => {
    try {
      const aiStatus = getSidecarStatus();
      const camerasConnected = getCamerasConnectedCount();
      const totalEvents = getEventsCount();
      const dbFileSize = getDatabaseFileSize();
      const gpuEnabled = getSetting('gpu_enabled') === 'true';

      return {
        aiServiceStatus: aiStatus,
        gpuEnabled,
        camerasConnected,
        totalEvents,
        dbFileSize,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][system:status] Error: ${message}`);
      throw new Error(`Failed to get system status: ${message}`);
    }
  });

  console.log('[IPC] Settings handlers registered.');
}
