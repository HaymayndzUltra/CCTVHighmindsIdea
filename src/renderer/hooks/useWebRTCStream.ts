import { useEffect, useRef, useState, useCallback } from 'react';

export type WebRTCConnectionStatus = 'connecting' | 'connected' | 'failed' | 'disconnected' | 'fallback';

interface UseWebRTCStreamResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  connectionStatus: WebRTCConnectionStatus;
  retry: () => void;
}

const RECONNECT_DELAY_MS = 3_000;
const ICE_TIMEOUT_MS = 15_000;

/**
 * Custom hook that establishes a WebRTC connection to a camera's main stream
 * via go2rtc, using the Electron IPC signaling proxy.
 *
 * Returns a videoRef to attach to a <video> element for hardware-decoded H.264 display.
 * Falls back to 'fallback' status if WebRTC negotiation fails repeatedly,
 * signaling the component to use the legacy useStreamFrame canvas path.
 */
export function useWebRTCStream(cameraId: string): UseWebRTCStreamResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<WebRTCConnectionStatus>('connecting');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const connectingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (iceTimeoutRef.current) {
      clearTimeout(iceTimeoutRef.current);
      iceTimeoutRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch { /* ignore */ }
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    connectingRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    if (!isMountedRef.current || connectingRef.current) return;
    connectingRef.current = true;

    cleanup();

    if (!window.electronAPI?.webrtc) {
      setConnectionStatus('disconnected');
      connectingRef.current = false;
      return;
    }

    setConnectionStatus('connecting');

    try {
      // Step 1: Get signaling info from main process
      const info = await window.electronAPI.webrtc.start(cameraId);
      if (!info.success || !isMountedRef.current) {
        connectingRef.current = false;
        return;
      }

      // Step 2: Create RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
      });
      pcRef.current = pc;

      // Add transceiver for receiving video
      pc.addTransceiver('video', { direction: 'recvonly' });
      // Add transceiver for receiving audio (some cameras have audio)
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Handle incoming tracks
      pc.ontrack = (event) => {
        if (!isMountedRef.current) return;
        if (event.track.kind === 'video' && videoRef.current) {
          const stream = event.streams[0] || new MediaStream([event.track]);
          videoRef.current.srcObject = stream;
        }
      };

      // Monitor connection state
      pc.onconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const state = pc.connectionState;

        if (state === 'connected') {
          if (iceTimeoutRef.current) {
            clearTimeout(iceTimeoutRef.current);
            iceTimeoutRef.current = null;
          }
          retryCountRef.current = 0;
          setConnectionStatus('connected');
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setConnectionStatus('failed');
          scheduleReconnect();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const iceState = pc.iceConnectionState;

        if (iceState === 'connected' || iceState === 'completed') {
          if (iceTimeoutRef.current) {
            clearTimeout(iceTimeoutRef.current);
            iceTimeoutRef.current = null;
          }
          retryCountRef.current = 0;
          setConnectionStatus('connected');
        } else if (iceState === 'failed' || iceState === 'disconnected') {
          scheduleReconnect();
        }
      };

      // Step 3: Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Step 4: Send offer to main process → go2rtc → get answer
      const sdpOffer = pc.localDescription?.sdp;
      if (!sdpOffer) {
        throw new Error('Failed to create SDP offer');
      }

      const result = await window.electronAPI.webrtc.signal(cameraId, sdpOffer);
      if (!result.success || !isMountedRef.current) {
        connectingRef.current = false;
        return;
      }

      // Step 5: Set remote description (SDP answer from go2rtc)
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: result.sdpAnswer })
      );

      // Step 6: Set ICE timeout — if not connected within timeout, retry
      iceTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        const currentState = pc.iceConnectionState;
        if (currentState !== 'connected' && currentState !== 'completed') {
          console.warn(`[useWebRTCStream][${cameraId}] ICE timeout after ${ICE_TIMEOUT_MS}ms. State: ${currentState}`);
          scheduleReconnect();
        }
      }, ICE_TIMEOUT_MS);

      connectingRef.current = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[useWebRTCStream][${cameraId}] Connection error: ${message}`);
      connectingRef.current = false;

      if (!isMountedRef.current) return;

      retryCountRef.current++;

      // After 3 failed attempts, switch to fallback mode
      if (retryCountRef.current >= 3) {
        console.warn(`[useWebRTCStream][${cameraId}] Max retries reached. Switching to fallback mode.`);
        setConnectionStatus('fallback');
        return;
      }

      scheduleReconnect();
    }
  }, [cameraId, cleanup]);

  const scheduleReconnect = useCallback(() => {
    if (!isMountedRef.current) return;
    if (reconnectTimerRef.current) return; // already scheduled

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (isMountedRef.current) {
        connect();
      }
    }, RECONNECT_DELAY_MS);
  }, [connect]);

  const retry = useCallback(() => {
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    isMountedRef.current = true;
    retryCountRef.current = 0;
    connect();

    return () => {
      isMountedRef.current = false;
      cleanup();
      // Notify main process
      window.electronAPI?.webrtc?.stop(cameraId).catch(() => { /* ignore */ });
    };
  }, [cameraId, connect, cleanup]);

  return { videoRef, connectionStatus, retry };
}
