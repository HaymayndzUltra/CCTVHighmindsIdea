import { ipcMain } from 'electron';
import {
  startRecording,
  stopRecording,
  getRecordingStatus,
  getAllRecordingStatuses,
  listSegments,
  getSegmentFilePath,
  getDiskUsage,
  type RecordingMode,
} from '../services/RecordingService';

export function registerRecordingHandlers(): void {
  /**
   * recording:start — Start recording for a camera.
   */
  ipcMain.handle(
    'recording:start',
    (_event, payload: { cameraId: string; mode?: RecordingMode }) => {
      if (!payload || !payload.cameraId) {
        throw new Error('cameraId is required.');
      }
      try {
        startRecording(payload.cameraId, payload.mode);
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[IPC][recording:start] Error: ${msg}`);
        throw new Error(`Failed to start recording: ${msg}`);
      }
    }
  );

  /**
   * recording:stop — Stop recording for a camera.
   */
  ipcMain.handle('recording:stop', (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }
    try {
      stopRecording(payload.cameraId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][recording:stop] Error: ${msg}`);
      throw new Error(`Failed to stop recording: ${msg}`);
    }
  });

  /**
   * recording:status — Get recording status for a camera or all cameras.
   */
  ipcMain.handle(
    'recording:status',
    (_event, payload?: { cameraId?: string }) => {
      if (payload?.cameraId) {
        return getRecordingStatus(payload.cameraId);
      }
      return getAllRecordingStatuses();
    }
  );

  /**
   * recording:segments — List recording segments for a camera within a time range.
   */
  ipcMain.handle(
    'recording:segments',
    (_event, payload: { cameraId: string; from: string; to: string }) => {
      if (!payload || !payload.cameraId || !payload.from || !payload.to) {
        throw new Error('cameraId, from, and to are required.');
      }
      try {
        const segments = listSegments(payload.cameraId, payload.from, payload.to);
        return { segments };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to list segments: ${msg}`);
      }
    }
  );

  /**
   * recording:playback — Get file path for a segment to play back.
   */
  ipcMain.handle(
    'recording:playback',
    (_event, payload: { segmentId: string }) => {
      if (!payload || !payload.segmentId) {
        throw new Error('segmentId is required.');
      }
      const filePath = getSegmentFilePath(payload.segmentId);
      if (!filePath) {
        throw new Error(`Segment file not found: ${payload.segmentId}`);
      }
      return { filePath };
    }
  );

  /**
   * recording:disk-usage — Get disk usage for recordings.
   */
  ipcMain.handle('recording:disk-usage', () => {
    return getDiskUsage();
  });

  console.log('[IPC] Recording handlers registered.');
}
