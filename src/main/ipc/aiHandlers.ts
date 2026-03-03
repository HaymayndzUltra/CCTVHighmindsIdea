/**
 * AI Detection IPC Handlers
 *
 * Push channels (emitted from DetectionPipeline.emitDetectionResult):
 *   'ai:detection' — face detection + recognition results per frame
 *   'ai:objects'   — YOLO + ByteTrack tracked objects per frame
 *
 * Invoke channels registered here:
 *   'ai:pipeline-status' — query pipeline running state
 */

import { ipcMain } from 'electron';
import { detectionPipeline } from '../services/DetectionPipeline';

export function registerAiHandlers(): void {
  // ai:pipeline-status — query the current detection pipeline state
  ipcMain.handle('ai:pipeline-status', () => {
    try {
      return {
        isRunning: detectionPipeline.isActive(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[aiHandlers] Failed to get pipeline status:', errorMessage);
      return { isRunning: false };
    }
  });
}
