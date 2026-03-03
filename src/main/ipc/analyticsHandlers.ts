import { ipcMain } from 'electron';
import {
  getActivityData,
  getHeatmapData,
  getPresenceTimeline,
  getZoneTrafficData,
} from '../services/AnalyticsService';

export function registerAnalyticsHandlers(): void {
  /**
   * analytics:heatmap — Get detection heatmap data for a camera.
   */
  ipcMain.handle(
    'analytics:heatmap',
    (_event, payload: { cameraId: string; from: string; to: string }) => {
      if (!payload || !payload.cameraId || !payload.from || !payload.to) {
        throw new Error('cameraId, from, and to are required.');
      }
      try {
        const cells = getHeatmapData(payload.cameraId, payload.from, payload.to);
        return { cells };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get heatmap data: ${msg}`);
      }
    }
  );

  /**
   * analytics:activity — Get activity data (hourly detection counts).
   */
  ipcMain.handle(
    'analytics:activity',
    (_event, payload: { cameraId?: string; from: string; to: string }) => {
      if (!payload || !payload.from || !payload.to) {
        throw new Error('from and to are required.');
      }
      try {
        const data = getActivityData(payload.cameraId ?? null, payload.from, payload.to);
        return { data };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get activity data: ${msg}`);
      }
    }
  );

  /**
   * analytics:presence — Get presence timeline segments.
   */
  ipcMain.handle(
    'analytics:presence',
    (_event, payload: { from: string; to: string; personId?: string }) => {
      if (!payload || !payload.from || !payload.to) {
        throw new Error('from and to are required.');
      }
      try {
        const segments = getPresenceTimeline(payload.from, payload.to, payload.personId);
        return { segments };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get presence timeline: ${msg}`);
      }
    }
  );

  /**
   * analytics:zoneTraffic — Get zone traffic data.
   */
  ipcMain.handle(
    'analytics:zoneTraffic',
    (_event, payload: { from: string; to: string; zoneId?: string }) => {
      if (!payload || !payload.from || !payload.to) {
        throw new Error('from and to are required.');
      }
      try {
        const data = getZoneTrafficData(payload.from, payload.to, payload.zoneId);
        return { data };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get zone traffic data: ${msg}`);
      }
    }
  );

  console.log('[IPC] Analytics handlers registered.');
}
