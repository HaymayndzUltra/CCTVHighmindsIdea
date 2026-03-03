import { ipcMain, BrowserWindow } from 'electron';
import {
  getFloorPlan,
  upsertFloorPlan,
  getDb,
} from '../services/DatabaseService';
import { topologyService } from '../services/TopologyService';

export function registerFloorplanHandlers(): void {
  ipcMain.handle('floorplan:get', () => {
    try {
      const plan = getFloorPlan() as Record<string, unknown> | null;
      if (!plan) return null;

      // Also fetch camera positions
      const cameras = getDb()
        .prepare('SELECT id, label, floor_x, floor_y, floor_fov_deg, floor_rotation_deg FROM cameras WHERE enabled = 1')
        .all() as Array<{
          id: string;
          label: string;
          floor_x: number | null;
          floor_y: number | null;
          floor_fov_deg: number | null;
          floor_rotation_deg: number | null;
        }>;

      return {
        imagePath: plan.image_path,
        imageWidth: plan.image_width,
        imageHeight: plan.image_height,
        scaleMetersPerPixel: plan.scale_meters_per_pixel,
        cameras: cameras.map((c) => ({
          id: c.id,
          label: c.label,
          floorX: c.floor_x,
          floorY: c.floor_y,
          fovDeg: c.floor_fov_deg,
          rotationDeg: c.floor_rotation_deg,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][floorplan:get] Error: ${message}`);
      throw new Error(`Failed to get floor plan: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('floorplan:save', (_event, payload: {
    imagePath?: string;
    imageWidth?: number;
    imageHeight?: number;
    scaleMetersPerPixel?: number;
    cameras?: Array<{
      id: string;
      floorX: number | null;
      floorY: number | null;
      fovDeg: number | null;
      rotationDeg: number | null;
    }>;
  }) => {
    try {
      upsertFloorPlan({
        imagePath: payload.imagePath,
        imageWidth: payload.imageWidth,
        imageHeight: payload.imageHeight,
        scaleMetersPerPixel: payload.scaleMetersPerPixel,
      });

      // Update camera positions
      if (payload.cameras && payload.cameras.length > 0) {
        const updateStmt = getDb().prepare(
          'UPDATE cameras SET floor_x = ?, floor_y = ?, floor_fov_deg = ?, floor_rotation_deg = ? WHERE id = ?'
        );

        const updateAll = getDb().transaction((cams: typeof payload.cameras) => {
          for (const cam of cams!) {
            updateStmt.run(cam.floorX, cam.floorY, cam.fovDeg, cam.rotationDeg, cam.id);
          }
        });

        updateAll(payload.cameras);
      }

      console.log('[IPC][floorplan:save] Floor plan saved.');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][floorplan:save] Error: ${message}`);
      throw new Error(`Failed to save floor plan: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('floorplan:positions', () => {
    try {
      const tracked = topologyService.getTrackedPersons();
      return {
        persons: tracked.map((p) => ({
          globalPersonId: p.globalPersonId,
          personId: p.personId,
          cameraId: p.cameraId,
          timestamp: p.timestamp,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][floorplan:positions] Error: ${message}`);
      throw new Error(`Failed to get floor plan positions: ${message}`, { cause: error });
    }
  });

  console.log('[IPC] Floor plan handlers registered.');
}
