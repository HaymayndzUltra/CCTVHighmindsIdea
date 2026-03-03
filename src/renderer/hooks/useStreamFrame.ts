import { useEffect, useRef, useState } from 'react';

interface FrameData {
  cameraId: string;
  frameBuffer: Buffer;
  timestamp: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseStreamFrameResult {
  frameRef: React.MutableRefObject<ImageData | null>;
  connectionStatus: ConnectionStatus;
  lastTimestamp: number;
}

const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;
const EXPECTED_RGB_SIZE = FRAME_WIDTH * FRAME_HEIGHT * 3;
const DISCONNECT_TIMEOUT_MS = 5000;
let debugFrameLogged = false;

/**
 * Custom hook that listens to `stream:frame` IPC events for a given cameraId
 * and provides the latest frame as ImageData for canvas rendering.
 */
export function useStreamFrame(cameraId: string): UseStreamFrameResult {
  const frameRef = useRef<ImageData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastTimestamp, setLastTimestamp] = useState<number>(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.stream?.onFrame) {
      setConnectionStatus('disconnected');
      return;
    }

    const resetDisconnectTimer = () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
      disconnectTimerRef.current = setTimeout(() => {
        setConnectionStatus('disconnected');
      }, DISCONNECT_TIMEOUT_MS);
    };

    resetDisconnectTimer();

    const unsubscribe = window.electronAPI.stream.onFrame((data: FrameData) => {
      if (data.cameraId !== cameraId) {
        return;
      }

      try {
        // Convert raw RGB24 buffer to RGBA ImageData
        // IPC with contextIsolation serializes Buffer → Uint8Array or ArrayBuffer
        const rawData = data.frameBuffer;
        const raw = rawData instanceof Uint8Array
          ? rawData
          : new Uint8Array(rawData as ArrayBuffer);

        if (!debugFrameLogged) {
          console.log(`[useStreamFrame][${cameraId}] First frame: type=${typeof rawData}, constructor=${rawData?.constructor?.name}, length=${raw.length}, expected=${EXPECTED_RGB_SIZE}`);
          debugFrameLogged = true;
        }

        if (raw.length !== EXPECTED_RGB_SIZE) {
          console.warn(`[useStreamFrame][${cameraId}] Frame size mismatch: got ${raw.length}, expected ${EXPECTED_RGB_SIZE}`);
          return;
        }

        const rgba = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);

        for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
          rgba[j] = raw[i];       // R
          rgba[j + 1] = raw[i + 1]; // G
          rgba[j + 2] = raw[i + 2]; // B
          rgba[j + 3] = 255;        // A
        }

        frameRef.current = new ImageData(rgba, FRAME_WIDTH, FRAME_HEIGHT);
        setLastTimestamp(data.timestamp);

        if (connectionStatus !== 'connected') {
          setConnectionStatus('connected');
        }

        resetDisconnectTimer();
      } catch (error) {
        console.error(`[useStreamFrame][${cameraId}] Error processing frame:`, error);
      }
    });

    return () => {
      unsubscribe();
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  return { frameRef, connectionStatus, lastTimestamp };
}
