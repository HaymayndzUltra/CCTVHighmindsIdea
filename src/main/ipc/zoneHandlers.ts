/**
 * Zone IPC Handlers — zone:save, zone:list, zone:get, zone:delete, zone:update.
 *
 * Bridges renderer zone editor actions to ZoneService CRUD.
 * Zone events (zone:event) are emitted directly by DetectionPipeline.
 */

import { ipcMain } from 'electron';
import crypto from 'crypto';
import { zoneService } from '../services/ZoneService';

interface ZoneSavePayload {
  cameraId: string;
  name: string;
  zoneType: string;
  geometry: unknown;
  color?: string;
  alertEnabled?: boolean;
  loiterThresholdSec?: number;
  loiterCooldownSec?: number;
  loiterMovementRadius?: number;
  id?: string;
}

interface ZoneListPayload {
  cameraId: string;
}

interface ZoneGetPayload {
  zoneId: string;
}

interface ZoneDeletePayload {
  zoneId: string;
}

interface ZoneUpdatePayload {
  zoneId: string;
  data: Record<string, unknown>;
}

export function registerZoneHandlers(): void {
  ipcMain.handle('zone:save', (_event, payload: ZoneSavePayload) => {
    if (!payload || !payload.cameraId || !payload.name || !payload.zoneType || !payload.geometry) {
      throw new Error('cameraId, name, zoneType, and geometry are required.');
    }

    try {
      const zoneId = payload.id || crypto.randomUUID();
      const result = zoneService.saveZone({
        id: zoneId,
        cameraId: payload.cameraId,
        name: payload.name,
        zoneType: payload.zoneType,
        geometry: payload.geometry as { points: Array<{ x: number; y: number }> },
        color: payload.color,
        alertEnabled: payload.alertEnabled,
        loiterThresholdSec: payload.loiterThresholdSec,
        loiterCooldownSec: payload.loiterCooldownSec,
        loiterMovementRadius: payload.loiterMovementRadius,
      });

      console.log(`[IPC][zone:save] Zone saved: ${result} for camera ${payload.cameraId}`);
      return { success: true, id: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][zone:save] Error: ${message}`);
      throw new Error(`Failed to save zone: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('zone:list', (_event, payload: ZoneListPayload) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }

    try {
      const zones = zoneService.getZonesForCamera(payload.cameraId);
      return { zones };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][zone:list] Error: ${message}`);
      throw new Error(`Failed to list zones: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('zone:get', (_event, payload: ZoneGetPayload) => {
    if (!payload || !payload.zoneId) {
      throw new Error('zoneId is required.');
    }

    try {
      const zone = zoneService.getZoneById(payload.zoneId);
      return zone;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][zone:get] Error: ${message}`);
      throw new Error(`Failed to get zone: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('zone:update', (_event, payload: ZoneUpdatePayload) => {
    if (!payload || !payload.zoneId || !payload.data) {
      throw new Error('zoneId and data are required.');
    }

    try {
      zoneService.modifyZone(payload.zoneId, payload.data);
      console.log(`[IPC][zone:update] Zone updated: ${payload.zoneId}`);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][zone:update] Error: ${message}`);
      throw new Error(`Failed to update zone: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('zone:delete', (_event, payload: ZoneDeletePayload) => {
    if (!payload || !payload.zoneId) {
      throw new Error('zoneId is required.');
    }

    try {
      zoneService.removeZone(payload.zoneId);
      console.log(`[IPC][zone:delete] Zone deleted: ${payload.zoneId}`);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][zone:delete] Error: ${message}`);
      throw new Error(`Failed to delete zone: ${message}`, { cause: error });
    }
  });

  console.log('[IPC] Zone handlers registered.');
}
