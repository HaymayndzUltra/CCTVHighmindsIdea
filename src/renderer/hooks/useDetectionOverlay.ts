import { useEffect, useRef, useState } from 'react';
import type { DetectionResult, BoundingBox } from '../../shared/types';

// --- Types ---

export interface OverlayFace {
  bbox: BoundingBox;
  label: string;
  confidence: number;
  isKnown: boolean;
  personId: string | null;
}

interface UseDetectionOverlayResult {
  faces: OverlayFace[];
  lastDetectionTime: number;
  isDetecting: boolean;
}

// Detections expire after this duration (no new data = clear overlay)
const DETECTION_EXPIRY_MS = 3000;

/**
 * Custom hook that listens to `ai:detection` IPC events for a given cameraId
 * and provides the latest detection faces for overlay rendering.
 */
export function useDetectionOverlay(cameraId: string): UseDetectionOverlayResult {
  const [faces, setFaces] = useState<OverlayFace[]>([]);
  const [lastDetectionTime, setLastDetectionTime] = useState<number>(0);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.ai?.onDetection) {
      return;
    }

    const resetExpiryTimer = () => {
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
      }
      expiryTimerRef.current = setTimeout(() => {
        setFaces([]);
        setIsDetecting(false);
      }, DETECTION_EXPIRY_MS);
    };

    const unsubscribe = window.electronAPI.ai.onDetection((data: DetectionResult) => {
      if (data.cameraId !== cameraId) {
        return;
      }

      try {
        const overlayFaces: OverlayFace[] = data.faces.map((f) => ({
          bbox: f.bbox,
          label: f.label,
          confidence: f.confidence,
          isKnown: f.isKnown,
          personId: f.personId,
        }));

        setFaces(overlayFaces);
        setLastDetectionTime(data.timestamp);
        setIsDetecting(true);
        resetExpiryTimer();
      } catch (error) {
        console.error(`[useDetectionOverlay][${cameraId}] Error processing detection:`, error);
      }
    });

    return () => {
      unsubscribe();
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  return { faces, lastDetectionTime, isDetecting };
}
