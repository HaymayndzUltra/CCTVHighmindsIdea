import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * DetectionOverlay — SVG-based real-time detection overlay positioned over a <video> element.
 *
 * Features:
 * - Color-coded bounding boxes by object class (person=green, vehicle=blue, animal=yellow, unknown=red)
 * - Person name labels + confidence scores for identified persons
 * - Track trails: fading polyline of last N positions per track
 * - Smooth interpolation between detection frames
 * - Click/right-click handlers on boxes for enrollment, false positive marking, tracking
 *
 * Subscribes to `ai:objects` IPC channel for tracked object data.
 */

// --- Types ---

interface TrackedObjectData {
  trackId: number;
  objectClass: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
  personName?: string;
  personId?: string | null;
  isKnown?: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
  timestamp: number;
}

interface InterpolatedObject extends TrackedObjectData {
  displayBbox: { x1: number; y1: number; x2: number; y2: number };
  trail: TrailPoint[];
}

interface DetectionOverlayProps {
  cameraId: string;
  /** Detection frame width in pixels (default: 1280 for 720p sub-stream) */
  detectionWidth?: number;
  /** Detection frame height in pixels (default: 720 for 720p sub-stream) */
  detectionHeight?: number;
  /** Whether overlay is visible */
  visible?: boolean;
  /** Callback when user left-clicks a detection box */
  onBoxClick?: (trackId: number, objectClass: string, personId: string | null) => void;
  /** Callback when user right-clicks a detection box (context menu) */
  onBoxContextMenu?: (
    event: React.MouseEvent,
    trackId: number,
    objectClass: string,
    personId: string | null,
    bbox: { x1: number; y1: number; x2: number; y2: number }
  ) => void;
}

// --- Constants ---

const CLASS_COLORS: Record<string, string> = {
  person: '#22c55e',   // green-500
  vehicle: '#3b82f6',  // blue-500
  car: '#3b82f6',
  truck: '#3b82f6',
  bus: '#3b82f6',
  motorcycle: '#3b82f6',
  bicycle: '#3b82f6',
  animal: '#eab308',   // yellow-500
  cat: '#eab308',
  dog: '#eab308',
  bird: '#eab308',
};

const DEFAULT_COLOR = '#ef4444'; // red-500 for unknown classes
const KNOWN_PERSON_COLOR = '#22c55e';
const UNKNOWN_PERSON_COLOR = '#ef4444';
const TRAIL_MAX_POINTS = 20;
const TRAIL_MAX_AGE_MS = 5_000;
const INTERPOLATION_FACTOR = 0.3;
const STALE_TIMEOUT_MS = 2_000;

function getBoxColor(obj: TrackedObjectData): string {
  if (obj.objectClass === 'person') {
    return obj.isKnown ? KNOWN_PERSON_COLOR : UNKNOWN_PERSON_COLOR;
  }
  return CLASS_COLORS[obj.objectClass] ?? DEFAULT_COLOR;
}

function getBoxLabel(obj: TrackedObjectData): string {
  if (obj.objectClass === 'person') {
    if (obj.personName) return obj.personName;
    return obj.isKnown ? 'Known' : 'Unknown';
  }
  return obj.objectClass.charAt(0).toUpperCase() + obj.objectClass.slice(1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpBbox(
  prev: { x1: number; y1: number; x2: number; y2: number },
  next: { x1: number; y1: number; x2: number; y2: number },
  t: number
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: lerp(prev.x1, next.x1, t),
    y1: lerp(prev.y1, next.y1, t),
    x2: lerp(prev.x2, next.x2, t),
    y2: lerp(prev.y2, next.y2, t),
  };
}

export default function DetectionOverlay({
  cameraId,
  detectionWidth = 1280,
  detectionHeight = 720,
  visible = true,
  onBoxClick,
  onBoxContextMenu,
}: DetectionOverlayProps) {
  const [objects, setObjects] = useState<InterpolatedObject[]>([]);
  const prevObjectsRef = useRef<Map<number, InterpolatedObject>>(new Map());
  const trailsRef = useRef<Map<number, TrailPoint[]>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Subscribe to ai:objects IPC channel
  useEffect(() => {
    if (!window.electronAPI?.ai?.onObjects) return;

    const unsubscribe = window.electronAPI.ai.onObjects((data) => {
      if (data.cameraId !== cameraId) return;

      const now = Date.now();
      lastUpdateRef.current = now;

      const rawObjects = data.objects as TrackedObjectData[];
      const prevMap = prevObjectsRef.current;
      const newMap = new Map<number, InterpolatedObject>();

      for (const obj of rawObjects) {
        const prev = prevMap.get(obj.trackId);

        // Update trail
        let trail = trailsRef.current.get(obj.trackId) ?? [];
        const centerX = (obj.bbox.x1 + obj.bbox.x2) / 2;
        const centerY = (obj.bbox.y1 + obj.bbox.y2) / 2;
        trail.push({ x: centerX, y: centerY, timestamp: now });

        // Prune old trail points
        trail = trail.filter((p) => now - p.timestamp < TRAIL_MAX_AGE_MS);
        if (trail.length > TRAIL_MAX_POINTS) {
          trail = trail.slice(trail.length - TRAIL_MAX_POINTS);
        }
        trailsRef.current.set(obj.trackId, trail);

        // Interpolate bbox for smooth motion
        const displayBbox = prev
          ? lerpBbox(prev.displayBbox, obj.bbox, INTERPOLATION_FACTOR)
          : { ...obj.bbox };

        newMap.set(obj.trackId, {
          ...obj,
          displayBbox,
          trail,
        });
      }

      // Remove stale tracks from trails
      for (const [trackId] of trailsRef.current) {
        if (!newMap.has(trackId)) {
          trailsRef.current.delete(trackId);
        }
      }

      prevObjectsRef.current = newMap;
      setObjects(Array.from(newMap.values()));
    });

    return () => {
      unsubscribe();
    };
  }, [cameraId]);

  // Clear stale objects if no updates received
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > STALE_TIMEOUT_MS) {
        setObjects([]);
        prevObjectsRef.current.clear();
        trailsRef.current.clear();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Continue interpolation via animation frames
  useEffect(() => {
    const animate = () => {
      const prevMap = prevObjectsRef.current;
      if (prevMap.size > 0) {
        // Nudge interpolated boxes closer to targets
        const updated: InterpolatedObject[] = [];
        for (const [, obj] of prevMap) {
          const nudgedBbox = lerpBbox(obj.displayBbox, obj.bbox, INTERPOLATION_FACTOR);
          const nudgedObj = { ...obj, displayBbox: nudgedBbox };
          prevMap.set(obj.trackId, nudgedObj);
          updated.push(nudgedObj);
        }
        setObjects(updated);
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const handleBoxClick = useCallback(
    (trackId: number, objectClass: string, personId: string | null) => {
      if (onBoxClick) {
        onBoxClick(trackId, objectClass, personId);
      }
    },
    [onBoxClick]
  );

  const handleBoxContextMenu = useCallback(
    (
      event: React.MouseEvent,
      trackId: number,
      objectClass: string,
      personId: string | null,
      bbox: { x1: number; y1: number; x2: number; y2: number }
    ) => {
      event.preventDefault();
      if (onBoxContextMenu) {
        onBoxContextMenu(event, trackId, objectClass, personId, bbox);
      }
    },
    [onBoxContextMenu]
  );

  if (!visible) return null;

  // Compute viewBox to match detection resolution for proper scaling
  const viewBox = `0 0 ${detectionWidth} ${detectionHeight}`;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <svg
        className="h-full w-full"
        viewBox={viewBox}
        preserveAspectRatio="none"
      >
        {/* Track trails */}
        {objects.map((obj) => {
          if (obj.trail.length < 2) return null;
          const color = getBoxColor(obj);
          const points = obj.trail
            .map((p) => `${p.x},${p.y}`)
            .join(' ');

          return (
            <polyline
              key={`trail-${obj.trackId}`}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeOpacity={0.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Bounding boxes + labels */}
        {objects.map((obj) => {
          const bbox = obj.displayBbox;
          const bw = bbox.x2 - bbox.x1;
          const bh = bbox.y2 - bbox.y1;
          if (bw <= 0 || bh <= 0) return null;

          const color = getBoxColor(obj);
          const label = getBoxLabel(obj);
          const confText = `${Math.round(obj.confidence * 100)}%`;
          const labelText = `${label} ${confText}`;

          // Label dimensions (approximate for SVG text)
          const labelFontSize = Math.max(12, Math.min(16, bw * 0.08));
          const labelW = labelText.length * labelFontSize * 0.6 + 12;
          const labelH = labelFontSize + 8;
          const labelX = bbox.x1;
          const labelY = bbox.y1 - labelH > 0 ? bbox.y1 - labelH : bbox.y1;

          return (
            <g key={`box-${obj.trackId}`}>
              {/* Bounding box rectangle */}
              <rect
                x={bbox.x1}
                y={bbox.y1}
                width={bw}
                height={bh}
                fill="none"
                stroke={color}
                strokeWidth={2}
                rx={2}
                className="pointer-events-auto cursor-pointer"
                onClick={() => handleBoxClick(obj.trackId, obj.objectClass, obj.personId ?? null)}
                onContextMenu={(e) =>
                  handleBoxContextMenu(e, obj.trackId, obj.objectClass, obj.personId ?? null, obj.bbox)
                }
              />

              {/* Label background */}
              <rect
                x={labelX}
                y={labelY}
                width={labelW}
                height={labelH}
                fill={color}
                fillOpacity={0.85}
                rx={2}
              />

              {/* Label text */}
              <text
                x={labelX + 6}
                y={labelY + labelH / 2}
                dominantBaseline="central"
                fill="#ffffff"
                fontSize={labelFontSize}
                fontWeight="600"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {labelText}
              </text>

              {/* Track ID badge (small, bottom-right corner) */}
              <text
                x={bbox.x2 - 4}
                y={bbox.y2 - 4}
                textAnchor="end"
                dominantBaseline="auto"
                fill={color}
                fontSize={Math.max(10, labelFontSize * 0.7)}
                fontWeight="500"
                fontFamily="Inter, system-ui, sans-serif"
                opacity={0.7}
              >
                #{obj.trackId}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
