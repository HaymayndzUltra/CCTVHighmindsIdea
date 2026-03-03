import { ipcMain } from 'electron';
import { tapoAPIService } from '../services/TapoAPIService';
import { getDb } from '../services/DatabaseService';
import { ptzService } from '../services/PTZService';

interface CameraRow {
  id: string;
  ip_address: string;
  has_ptz: number;
}

interface PtzCommandPayload {
  cameraId: string;
  action: string;
  params: Record<string, unknown>;
}

function getCameraById(cameraId: string): CameraRow | undefined {
  try {
    return getDb()
      .prepare('SELECT id, ip_address, has_ptz FROM cameras WHERE id = ?')
      .get(cameraId) as CameraRow | undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[IPC][ptz] Failed to query camera ${cameraId}: ${message}`);
    return undefined;
  }
}

export function registerPtzHandlers(): void {
  ipcMain.handle('ptz:command', async (_event, payload: PtzCommandPayload) => {
    if (!payload || !payload.cameraId || !payload.action) {
      throw new Error('cameraId and action are required.');
    }

    const { cameraId, action, params } = payload;

    // Validate camera exists and has PTZ capability
    const camera = getCameraById(cameraId);
    if (!camera) {
      throw new Error(`Camera ${cameraId} not found.`);
    }

    if (camera.has_ptz !== 1) {
      throw new Error(`Camera ${cameraId} does not have PTZ capability.`);
    }

    const cameraIp = camera.ip_address;

    try {
      switch (action) {
        case 'move_up':
          await tapoAPIService.move(cameraId, cameraIp, 'up', Number(params?.speed ?? 50));
          break;
        case 'move_down':
          await tapoAPIService.move(cameraId, cameraIp, 'down', Number(params?.speed ?? 50));
          break;
        case 'move_left':
          await tapoAPIService.move(cameraId, cameraIp, 'left', Number(params?.speed ?? 50));
          break;
        case 'move_right':
          await tapoAPIService.move(cameraId, cameraIp, 'right', Number(params?.speed ?? 50));
          break;
        case 'stop':
          await tapoAPIService.stop(cameraId, cameraIp);
          break;
        case 'zoom_in':
          // Zoom handled as vertical motor movement on Tapo cameras
          await tapoAPIService.move(cameraId, cameraIp, 'up', Number(params?.speed ?? 20));
          break;
        case 'zoom_out':
          await tapoAPIService.move(cameraId, cameraIp, 'down', Number(params?.speed ?? 20));
          break;
        case 'go_to_preset':
          if (!params?.presetId) {
            throw new Error('presetId is required for go_to_preset action.');
          }
          await tapoAPIService.goToPreset(cameraId, cameraIp, String(params.presetId));
          break;
        case 'set_preset':
          if (!params?.name) {
            throw new Error('name is required for set_preset action.');
          }
          await tapoAPIService.setPreset(cameraId, cameraIp, String(params.name));
          break;
        default:
          throw new Error(`Unknown PTZ action: ${action}`);
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][ptz:command] Error executing ${action} on ${cameraId}: ${message}`);
      throw new Error(`PTZ command failed: ${message}`);
    }
  });

  ipcMain.handle('ptz:presets', async (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }

    const camera = getCameraById(payload.cameraId);
    if (!camera) {
      throw new Error(`Camera ${payload.cameraId} not found.`);
    }

    if (camera.has_ptz !== 1) {
      throw new Error(`Camera ${payload.cameraId} does not have PTZ capability.`);
    }

    try {
      const presets = await tapoAPIService.getPresets(payload.cameraId, camera.ip_address);
      return { presets };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][ptz:presets] Error for ${payload.cameraId}: ${message}`);
      throw new Error(`Failed to get presets: ${message}`);
    }
  });

  // --- Enhanced PTZ: Auto-Track ---

  ipcMain.handle('ptz:autotrack:start', async (_event, payload: { cameraId: string; trackId: number }) => {
    if (!payload?.cameraId || payload.trackId == null) {
      throw new Error('cameraId and trackId are required.');
    }
    ptzService.startAutoTrack(payload.cameraId, payload.trackId);
    return { success: true };
  });

  ipcMain.handle('ptz:autotrack:stop', async (_event, payload: { cameraId: string }) => {
    if (!payload?.cameraId) {
      throw new Error('cameraId is required.');
    }
    ptzService.stopAutoTrack(payload.cameraId);
    return { success: true };
  });

  // --- Enhanced PTZ: Patrol ---

  ipcMain.handle('ptz:patrol:start', async (_event, payload: { cameraId: string; dwellTimeMs?: number }) => {
    if (!payload?.cameraId) {
      throw new Error('cameraId is required.');
    }
    await ptzService.startPatrol(payload.cameraId, payload.dwellTimeMs);
    return { success: true };
  });

  ipcMain.handle('ptz:patrol:stop', async (_event, payload: { cameraId: string }) => {
    if (!payload?.cameraId) {
      throw new Error('cameraId is required.');
    }
    ptzService.stopPatrol(payload.cameraId);
    return { success: true };
  });

  // --- Enhanced PTZ: Zoom to Target ---

  ipcMain.handle('ptz:zoom:to', async (_event, payload: {
    cameraId: string;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    frameWidth?: number;
    frameHeight?: number;
  }) => {
    if (!payload?.cameraId || !payload.bbox) {
      throw new Error('cameraId and bbox are required.');
    }
    await ptzService.zoomToTarget(payload.cameraId, payload.bbox, payload.frameWidth, payload.frameHeight);
    return { success: true };
  });

  // --- Enhanced PTZ: Status ---

  ipcMain.handle('ptz:status', (_event, payload: { cameraId: string }) => {
    if (!payload?.cameraId) {
      throw new Error('cameraId is required.');
    }
    const caps = ptzService.getCapabilities(payload.cameraId);
    const autoTrack = ptzService.getAutoTrackInfo(payload.cameraId);
    return {
      capabilities: caps,
      isAutoTracking: ptzService.isAutoTracking(payload.cameraId),
      autoTrackInfo: autoTrack,
      isPatrolling: ptzService.isPatrolling(payload.cameraId),
    };
  });

  console.log('[IPC] PTZ handlers registered (with auto-track, patrol, zoom).');
}
