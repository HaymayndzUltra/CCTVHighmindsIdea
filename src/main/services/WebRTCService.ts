/**
 * WebRTCService — manages WebRTC streaming lifecycle for each camera.
 *
 * Responsibilities:
 * - Track per-camera WebRTC connection state (idle → negotiating → connected → failed)
 * - Provide SDP signaling proxy to go2rtc's /api/webrtc endpoint
 * - Connection health monitoring and automatic re-negotiation on failure
 * - Fallback to raw frame IPC if WebRTC negotiation fails repeatedly
 * - Graceful start/stop per camera
 */

import {
  getWebRtcSignalingUrl,
  getStreamPrefix,
  getSubStreamRtspUrl,
} from './Go2RtcService';

export type WebRTCConnectionState = 'idle' | 'negotiating' | 'connected' | 'failed' | 'stopped';

interface CameraWebRTCState {
  state: WebRTCConnectionState;
  signalingUrl: string | null;
  streamName: string | null;
  negotiationAttempts: number;
  lastNegotiationAt: number | null;
  lastErrorMessage: string | null;
  useFallback: boolean;
}

const GO2RTC_API_BASE = 'http://127.0.0.1:1984';
const MAX_NEGOTIATION_ATTEMPTS = 3;
const SIGNALING_TIMEOUT_MS = 10_000;

const cameraStates = new Map<string, CameraWebRTCState>();

function getOrCreateState(cameraId: string): CameraWebRTCState {
  let state = cameraStates.get(cameraId);
  if (!state) {
    state = {
      state: 'idle',
      signalingUrl: null,
      streamName: null,
      negotiationAttempts: 0,
      lastNegotiationAt: null,
      lastErrorMessage: null,
      useFallback: false,
    };
    cameraStates.set(cameraId, state);
  }
  return state;
}

/**
 * Start WebRTC session for a camera.
 * Returns signaling info for the renderer to initiate peer connection.
 */
export function startWebRTC(cameraId: string): {
  success: boolean;
  signalingUrl: string;
  streamName: string;
  subStreamUrl: string | null;
  go2rtcApiBase: string;
} {
  if (!cameraId) {
    throw new Error('cameraId is required.');
  }

  const signalingUrl = getWebRtcSignalingUrl(cameraId);
  const streamPrefix = getStreamPrefix(cameraId);
  const subStreamUrl = getSubStreamRtspUrl(cameraId);

  if (!signalingUrl || !streamPrefix) {
    throw new Error(`No WebRTC stream configured for camera ${cameraId}`);
  }

  const state = getOrCreateState(cameraId);
  state.signalingUrl = signalingUrl;
  const streamSuffix = cameraId === 'CAM-2A' ? '_sub' : '_main';
  state.streamName = `${streamPrefix}${streamSuffix}`;
  state.state = 'idle';
  state.negotiationAttempts = 0;
  state.lastErrorMessage = null;
  state.useFallback = false;

  console.log(`[WebRTCService] Started for ${cameraId}: ${signalingUrl}`);

  return {
    success: true,
    signalingUrl,
    streamName: state.streamName,
    subStreamUrl,
    go2rtcApiBase: GO2RTC_API_BASE,
  };
}

/**
 * Proxy SDP offer from renderer to go2rtc, return SDP answer.
 * Tracks negotiation state and triggers fallback after max attempts.
 */
export async function signalWebRTC(
  cameraId: string,
  sdpOffer: string
): Promise<{ success: boolean; sdpAnswer: string }> {
  if (!cameraId || !sdpOffer) {
    throw new Error('cameraId and sdpOffer are required.');
  }

  const state = getOrCreateState(cameraId);

  if (state.useFallback) {
    throw new Error(`Camera ${cameraId} is in fallback mode (raw frame IPC). Reset to retry WebRTC.`);
  }

  const streamPrefix = getStreamPrefix(cameraId);
  if (!streamPrefix) {
    throw new Error(`No stream configured for camera ${cameraId}`);
  }

  // C246D dual-lens: CAM-2A uses sub (stream2), CAM-2B uses main (stream6)
  const streamSuffix = cameraId === 'CAM-2A' ? '_sub' : '_main';
  const streamName = `${streamPrefix}${streamSuffix}`;
  const url = `${GO2RTC_API_BASE}/api/webrtc?src=${streamName}`;

  state.state = 'negotiating';
  state.negotiationAttempts++;
  state.lastNegotiationAt = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SIGNALING_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: sdpOffer,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`go2rtc signaling failed (${response.status}): ${errText}`);
    }

    const sdpAnswer = await response.text();
    state.state = 'connected';
    state.lastErrorMessage = null;

    console.log(`[WebRTCService] Signaling succeeded for ${cameraId} (attempt ${state.negotiationAttempts})`);

    return { success: true, sdpAnswer };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastErrorMessage = message;

    if (state.negotiationAttempts >= MAX_NEGOTIATION_ATTEMPTS) {
      state.state = 'failed';
      state.useFallback = true;
      console.error(
        `[WebRTCService] Max negotiation attempts (${MAX_NEGOTIATION_ATTEMPTS}) reached for ${cameraId}. Falling back to raw frame IPC.`
      );
    } else {
      state.state = 'failed';
      console.warn(
        `[WebRTCService] Signaling failed for ${cameraId} (attempt ${state.negotiationAttempts}/${MAX_NEGOTIATION_ATTEMPTS}): ${message}`
      );
    }

    throw new Error(`WebRTC signaling failed: ${message}`);
  }
}

/**
 * Mark WebRTC connection as established (called when renderer confirms ICE connected).
 */
export function markConnected(cameraId: string): void {
  const state = getOrCreateState(cameraId);
  state.state = 'connected';
  state.negotiationAttempts = 0;
  console.log(`[WebRTCService] Connection confirmed for ${cameraId}`);
}

/**
 * Mark WebRTC connection as failed (called when renderer detects disconnection).
 */
export function markDisconnected(cameraId: string): void {
  const state = getOrCreateState(cameraId);
  if (state.state !== 'stopped') {
    state.state = 'failed';
    console.warn(`[WebRTCService] Connection lost for ${cameraId}`);
  }
}

/**
 * Stop WebRTC session for a camera.
 */
export function stopWebRTC(cameraId: string): void {
  const state = cameraStates.get(cameraId);
  if (state) {
    state.state = 'stopped';
    state.signalingUrl = null;
    state.streamName = null;
  }
  console.log(`[WebRTCService] Stopped for ${cameraId}`);
}

/**
 * Reset fallback mode for a camera, allowing WebRTC retry.
 */
export function resetFallback(cameraId: string): void {
  const state = getOrCreateState(cameraId);
  state.useFallback = false;
  state.negotiationAttempts = 0;
  state.state = 'idle';
  state.lastErrorMessage = null;
  console.log(`[WebRTCService] Fallback reset for ${cameraId}. WebRTC retry enabled.`);
}

/**
 * Get WebRTC connection state for a camera.
 */
export function getWebRTCState(cameraId: string): {
  state: WebRTCConnectionState;
  useFallback: boolean;
  negotiationAttempts: number;
  lastError: string | null;
} {
  const s = cameraStates.get(cameraId);
  if (!s) {
    return {
      state: 'idle',
      useFallback: false,
      negotiationAttempts: 0,
      lastError: null,
    };
  }
  return {
    state: s.state,
    useFallback: s.useFallback,
    negotiationAttempts: s.negotiationAttempts,
    lastError: s.lastErrorMessage,
  };
}

/**
 * Get all camera WebRTC states.
 */
export function getAllWebRTCStates(): Record<
  string,
  { state: WebRTCConnectionState; useFallback: boolean }
> {
  const result: Record<string, { state: WebRTCConnectionState; useFallback: boolean }> = {};
  for (const [cameraId, s] of cameraStates) {
    result[cameraId] = { state: s.state, useFallback: s.useFallback };
  }
  return result;
}

/**
 * Stop all WebRTC sessions (used during app shutdown).
 */
export function stopAllWebRTC(): void {
  for (const [cameraId] of cameraStates) {
    stopWebRTC(cameraId);
  }
  cameraStates.clear();
  console.log('[WebRTCService] All sessions stopped.');
}
