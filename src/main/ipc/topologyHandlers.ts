import { ipcMain, BrowserWindow } from 'electron';
import { topologyService } from '../services/TopologyService';
import type { TopologyAnomaly } from '../services/TopologyService';
import {
  getTopologyEdges,
  getDb,
} from '../services/DatabaseService';
import crypto from 'crypto';

export function registerTopologyHandlers(): void {
  // --- Topology Edge CRUD ---

  ipcMain.handle('topology:get', () => {
    try {
      const rows = getTopologyEdges() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id,
        fromCameraId: row.from_camera_id,
        toCameraId: row.to_camera_id,
        transitMinSec: row.transit_min_sec,
        transitMaxSec: row.transit_max_sec,
        direction: row.direction,
        enabled: row.enabled !== 0,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][topology:get] Error: ${message}`);
      throw new Error(`Failed to get topology: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('topology:save', (_event, edges: Array<{
    id: string;
    from_camera_id: string;
    to_camera_id: string;
    transit_min_sec: number;
    transit_max_sec: number;
    direction: string;
    enabled: boolean;
  }>) => {
    if (!edges || !Array.isArray(edges)) {
      throw new Error('edges array is required.');
    }

    try {
      const db = getDb();

      // Delete all existing edges and replace with new set
      db.prepare('DELETE FROM topology_edges').run();

      const insertStmt = db.prepare(
        `INSERT INTO topology_edges (id, from_camera_id, to_camera_id, transit_min_sec, transit_max_sec, direction, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      );

      const insertMany = db.transaction((edgeList: typeof edges) => {
        for (const edge of edgeList) {
          const id = edge.id.startsWith('edge-') ? crypto.randomUUID() : edge.id;
          insertStmt.run(
            id,
            edge.from_camera_id,
            edge.to_camera_id,
            edge.transit_min_sec,
            edge.transit_max_sec,
            edge.direction || 'bidirectional',
            edge.enabled ? 1 : 0
          );
        }
      });

      insertMany(edges);

      // Invalidate topology cache
      topologyService.invalidateCache();

      console.log(`[IPC][topology:save] Saved ${edges.length} topology edges.`);
      return { success: true, count: edges.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][topology:save] Error: ${message}`);
      throw new Error(`Failed to save topology: ${message}`, { cause: error });
    }
  });

  // --- Anomaly Listener ---
  // Forward topology anomalies to renderer
  topologyService.on('topology:anomaly', (anomaly: TopologyAnomaly) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('topology:anomaly', {
          type: anomaly.type,
          globalPersonId: anomaly.globalPersonId,
          personId: anomaly.personId,
          fromCameraId: anomaly.fromCameraId,
          toCameraId: anomaly.toCameraId,
          elapsedSec: anomaly.elapsedSec,
          expectedMinSec: anomaly.expectedMinSec,
          expectedMaxSec: anomaly.expectedMaxSec,
          skippedCameraId: anomaly.skippedCameraId,
          description: anomaly.description,
          timestamp: anomaly.timestamp,
        });
      }
    }
  });

  console.log('[IPC] Topology handlers registered.');
}
