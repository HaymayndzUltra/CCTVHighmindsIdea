import { ipcMain } from 'electron';
import { streamManager } from '../services/StreamManager';
import { getAllStreamStatuses } from '../services/Go2RtcService';
import {
  startWebRTC,
  signalWebRTC,
  stopWebRTC,
  getWebRTCState,
} from '../services/WebRTCService';

export function registerStreamHandlers(): void {
  ipcMain.handle('stream:start', (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      console.error('[IPC][stream:start] Missing cameraId in payload.');
      throw new Error('cameraId is required.');
    }

    try {
      streamManager.startStream(payload.cameraId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][stream:start] Error starting stream for ${payload.cameraId}: ${message}`);
      throw new Error(`Failed to start stream: ${message}`);
    }
  });

  ipcMain.handle('stream:stop', (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      console.error('[IPC][stream:stop] Missing cameraId in payload.');
      throw new Error('cameraId is required.');
    }

    try {
      streamManager.stopStream(payload.cameraId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][stream:stop] Error stopping stream for ${payload.cameraId}: ${message}`);
      throw new Error(`Failed to stop stream: ${message}`);
    }
  });

  /**
   * webrtc:start — Get WebRTC stream info for a camera.
   * Returns the go2rtc signaling URL and stream name so the renderer
   * can initiate WebRTC negotiation directly with go2rtc.
   */
  ipcMain.handle('webrtc:start', (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      return { error: 'cameraId is required' };
    }

    try {
      return startWebRTC(payload.cameraId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][webrtc:start] Error for ${payload.cameraId}: ${message}`);
      throw new Error(`Failed to start WebRTC: ${message}`);
    }
  });

  /**
   * webrtc:signal — Proxy SDP offer from renderer to go2rtc, return SDP answer.
   * The renderer creates an RTCPeerConnection, generates an SDP offer, and
   * passes it here. We POST it to go2rtc's /api/webrtc endpoint and return
   * the SDP answer for the renderer to set as remote description.
   */
  ipcMain.handle('webrtc:signal', async (_event, payload: { cameraId: string; sdpOffer: string }) => {
    if (!payload || !payload.cameraId || !payload.sdpOffer) {
      throw new Error('cameraId and sdpOffer are required.');
    }

    try {
      return await signalWebRTC(payload.cameraId, payload.sdpOffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC][webrtc:signal] Signaling error for ${payload.cameraId}: ${message}`);
      throw new Error(`WebRTC signaling failed: ${message}`);
    }
  });

  /**
   * webrtc:stop — Stop WebRTC session for a camera.
   * Cleans up connection state in WebRTCService.
   */
  ipcMain.handle('webrtc:stop', (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      return { success: true };
    }
    stopWebRTC(payload.cameraId);
    return { success: true };
  });

  /**
   * webrtc:state — Get WebRTC connection state for a camera.
   */
  ipcMain.handle('webrtc:state', (_event, payload: { cameraId: string }) => {
    if (!payload || !payload.cameraId) {
      throw new Error('cameraId is required.');
    }
    return getWebRTCState(payload.cameraId);
  });

  /**
   * stream:go2rtc_status — Return health status of all go2rtc streams.
   */
  ipcMain.handle('stream:go2rtc_status', async () => {
    try {
      const statuses = await getAllStreamStatuses();
      return { success: true, streams: statuses };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get go2rtc stream statuses: ${message}`);
    }
  });

  console.log('[IPC] Stream handlers registered (AI sub-stream + WebRTC channels).');
}
