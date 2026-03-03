import { ipcMain } from 'electron';
import { getDb } from '../services/DatabaseService';

interface LineSavePayload {
  cameraId: string;
  lineCoords: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    enterDirection: string;
  };
  direction: string;
}

interface LineGetPayload {
  cameraId: string;
}

interface LineCrossingConfigRow {
  line_crossing_config: string | null;
}

export function registerLineHandlers(): void {
  ipcMain.handle('line:save', (_event, payload: LineSavePayload) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }

    const { cameraId, lineCoords, direction } = payload;

    if (
      lineCoords.x1 === undefined ||
      lineCoords.y1 === undefined ||
      lineCoords.x2 === undefined ||
      lineCoords.y2 === undefined
    ) {
      throw new Error('Line coordinates (x1, y1, x2, y2) are required.');
    }

    const validDirections = ['enter_from_left', 'enter_from_right'];
    const resolvedDirection = direction || lineCoords.enterDirection || 'enter_from_left';
    if (!validDirections.includes(resolvedDirection)) {
      throw new Error(`Invalid direction: ${resolvedDirection}. Must be one of: ${validDirections.join(', ')}`);
    }

    try {
      const configJson = JSON.stringify({
        x1: lineCoords.x1,
        y1: lineCoords.y1,
        x2: lineCoords.x2,
        y2: lineCoords.y2,
        enterDirection: resolvedDirection,
      });

      const result = getDb()
        .prepare(
          `UPDATE cameras SET line_crossing_config = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(configJson, cameraId);

      if (result.changes === 0) {
        throw new Error(`Camera ${cameraId} not found.`, { cause: new Error('not_found') });
      }

      console.log(`[IPC][line:save] Saved line config for ${cameraId}: ${configJson}`);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][line:save] Error saving config for ${cameraId}: ${message}`);
      throw new Error(`Failed to save line config: ${message}`, { cause: error });
    }
  });

  ipcMain.handle('line:get', (_event, payload: LineGetPayload) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }

    try {
      const row = getDb()
        .prepare('SELECT line_crossing_config FROM cameras WHERE id = ?')
        .get(payload.cameraId) as LineCrossingConfigRow | undefined;

      if (!row || !row.line_crossing_config) {
        return null;
      }

      try {
        const config = JSON.parse(row.line_crossing_config);
        return {
          x1: config.x1,
          y1: config.y1,
          x2: config.x2,
          y2: config.y2,
          enterDirection: config.enterDirection || 'enter_from_left',
        };
      } catch (parseError) {
        const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[IPC][line:get] Failed to parse line config for ${payload.cameraId}: ${parseMessage}`);
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][line:get] Error reading config for ${payload.cameraId}: ${message}`);
      throw new Error(`Failed to get line config: ${message}`, { cause: error });
    }
  });

  console.log('[IPC] Line crossing handlers registered.');
}
