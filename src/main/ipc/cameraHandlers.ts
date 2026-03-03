import { ipcMain } from 'electron';
import { getDb } from '../services/DatabaseService';

interface CameraRow {
  id: string;
  label: string;
  ip_address: string;
  model: string;
  type: string;
  rtsp_url: string;
  has_ptz: number;
  heuristic_direction: string | null;
  motion_sensitivity: number;
  enabled: number;
}

interface CameraUpdatePayload {
  cameraId: string;
  data: {
    label?: string;
    ipAddress?: string;
    model?: string;
    rtspUrl?: string;
    enabled?: boolean;
    motionSensitivity?: number;
  };
}

export function registerCameraHandlers(): void {
  ipcMain.handle('camera:list', () => {
    try {
      const rows = getDb()
        .prepare('SELECT id, label, ip_address, model, type, rtsp_url, has_ptz, heuristic_direction, motion_sensitivity, enabled FROM cameras ORDER BY id')
        .all() as CameraRow[];

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        ipAddress: row.ip_address,
        model: row.model,
        type: row.type,
        rtspUrl: row.rtsp_url,
        hasPtz: row.has_ptz === 1,
        heuristicDirection: row.heuristic_direction,
        motionSensitivity: row.motion_sensitivity,
        enabled: row.enabled === 1,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][camera:list] Error fetching cameras: ${message}`);
      throw new Error(`Failed to list cameras: ${message}`);
    }
  });

  ipcMain.handle('camera:update', (_event, payload: CameraUpdatePayload) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }

    const { cameraId, data } = payload;
    if (!data || Object.keys(data).length === 0) {
      throw new Error('No update data provided.');
    }

    try {
      const setClauses: string[] = [];
      const values: unknown[] = [];

      if (data.label !== undefined) {
        setClauses.push('label = ?');
        values.push(data.label);
      }
      if (data.ipAddress !== undefined) {
        setClauses.push('ip_address = ?');
        values.push(data.ipAddress);
      }
      if (data.model !== undefined) {
        setClauses.push('model = ?');
        values.push(data.model);
      }
      if (data.rtspUrl !== undefined) {
        setClauses.push('rtsp_url = ?');
        values.push(data.rtspUrl);
      }
      if (data.enabled !== undefined) {
        setClauses.push('enabled = ?');
        values.push(data.enabled ? 1 : 0);
      }
      if (data.motionSensitivity !== undefined) {
        setClauses.push('motion_sensitivity = ?');
        values.push(data.motionSensitivity);
      }

      setClauses.push("updated_at = datetime('now')");
      values.push(cameraId);

      const sql = `UPDATE cameras SET ${setClauses.join(', ')} WHERE id = ?`;
      const result = getDb().prepare(sql).run(...values);

      if (result.changes === 0) {
        throw new Error(`Camera ${cameraId} not found.`);
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][camera:update] Error updating ${cameraId}: ${message}`);
      throw new Error(`Failed to update camera: ${message}`);
    }
  });

  console.log('[IPC] Camera handlers registered.');
}
