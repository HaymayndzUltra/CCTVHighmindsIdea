import { useState, useEffect, useCallback, useRef } from 'react';
import { Map, Camera, RefreshCw, Loader2, Eye, EyeOff } from 'lucide-react';

interface CameraMarker {
  id: string;
  label: string;
  floorX: number | null;
  floorY: number | null;
  fovDeg: number | null;
  rotationDeg: number | null;
}

interface PersonDot {
  globalPersonId: string;
  personId: string | null;
  cameraId: string;
  timestamp: number;
  x?: number;
  y?: number;
}

interface TrailPoint {
  x: number;
  y: number;
  timestamp: number;
}

const PERSON_COLORS = {
  known: '#22c55e',    // green
  unknown: '#ef4444',  // red
  bodyOnly: '#3b82f6', // blue
};

const TRAIL_MAX_POINTS = 30;
const POSITION_POLL_MS = 2000;

interface FloorPlanProps {
  onOpenFullscreen?: (camera: { cameraId: string; label: string; model: string; hasPtz: boolean }) => void;
}

export default function FloorPlan({ onOpenFullscreen }: FloorPlanProps) {
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraMarker[]>([]);
  const [persons, setPersons] = useState<PersonDot[]>([]);
  const [trails, setTrails] = useState<Record<string, TrailPoint[]>>({});
  const [showTrails, setShowTrails] = useState(true);
  const [showCameras, setShowCameras] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredPerson, setHoveredPerson] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFloorPlan = useCallback(async () => {
    try {
      if (!window.electronAPI?.floorplan?.get) return;
      const data = await window.electronAPI.floorplan.get();
      if (data) {
        setImagePath(data.imagePath);
        setCameras(data.cameras ?? []);
      }
    } catch (error) {
      console.error('[FloorPlan] Failed to load:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchPositions = useCallback(async () => {
    try {
      if (!window.electronAPI?.floorplan?.positions) return;
      const result = await window.electronAPI.floorplan.positions();
      const data = result?.persons ?? [];
      if (data.length === 0) return;

      // Map persons to floor positions using camera positions
      const camPosMap: Record<string, { x: number; y: number }> = {};
      for (const cam of cameras) {
        if (cam.floorX !== null && cam.floorY !== null) {
          camPosMap[cam.id] = { x: cam.floorX, y: cam.floorY };
        }
      }

      const updatedPersons: PersonDot[] = data.map((p) => {
        const camPos = camPosMap[p.cameraId];
        return {
          ...p,
          x: camPos?.x ?? undefined,
          y: camPos?.y ?? undefined,
        };
      });

      setPersons(updatedPersons);

      // Update trails
      setTrails((prev) => {
        const next = { ...prev };
        for (const p of updatedPersons) {
          if (p.x === undefined || p.y === undefined) continue;
          const existing = next[p.globalPersonId] ?? [];
          const newPoint: TrailPoint = { x: p.x, y: p.y, timestamp: Date.now() };
          const last = existing[existing.length - 1];
          if (last && Math.abs(last.x - newPoint.x) < 0.5 && Math.abs(last.y - newPoint.y) < 0.5) {
            continue;
          }
          next[p.globalPersonId] = [...existing, newPoint].slice(-TRAIL_MAX_POINTS);
        }
        return next;
      });
    } catch (error) {
      console.error('[FloorPlan] Position fetch error:', error);
    }
  }, [cameras]);

  useEffect(() => {
    loadFloorPlan();
  }, [loadFloorPlan]);

  useEffect(() => {
    if (cameras.length === 0) return;

    fetchPositions();
    pollRef.current = setInterval(fetchPositions, POSITION_POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [cameras, fetchPositions]);

  const handlePersonClick = useCallback((personId: string | null, cameraId: string) => {
    console.log(`[FloorPlan] Navigating to fullscreen: ${cameraId}`);
    if (!onOpenFullscreen) return;
    const cam = cameras.find((c) => c.id === cameraId);
    onOpenFullscreen({
      cameraId,
      label: cam?.label ?? cameraId,
      model: '',
      hasPtz: false,
    });
  }, [cameras, onOpenFullscreen]);

  const handleCameraClick = useCallback((cameraId: string) => {
    console.log(`[FloorPlan] Navigating to fullscreen: ${cameraId}`);
    if (!onOpenFullscreen) return;
    const cam = cameras.find((c) => c.id === cameraId);
    onOpenFullscreen({
      cameraId,
      label: cam?.label ?? cameraId,
      model: '',
      hasPtz: false,
    });
  }, [cameras, onOpenFullscreen]);

  const getPersonColor = (personId: string | null): string => {
    if (personId) return PERSON_COLORS.known;
    return PERSON_COLORS.unknown;
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <Loader2 size={24} className="animate-spin" />
        <span className="ml-2 text-sm">Loading floor plan...</span>
      </div>
    );
  }

  if (!imagePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <Map size={48} className="mb-4 text-neutral-600" />
        <h2 className="mb-2 text-lg font-semibold text-neutral-300">No Floor Plan Configured</h2>
        <p className="text-sm text-neutral-500">
          Go to Settings &rarr; Floor Plan to upload a floor plan image and position cameras.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Map size={20} className="text-neutral-400" />
          <h1 className="text-lg font-semibold text-neutral-100">Floor Plan</h1>
          <span className="text-xs text-neutral-500">
            {persons.length} person{persons.length !== 1 ? 's' : ''} tracked
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTrails(!showTrails)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
              showTrails ? 'bg-primary-600/20 text-primary-400' : 'text-neutral-500 hover:text-neutral-300'
            }`}
            title={showTrails ? 'Hide trails' : 'Show trails'}
          >
            {showTrails ? <Eye size={12} /> : <EyeOff size={12} />}
            Trails
          </button>
          <button
            onClick={() => setShowCameras(!showCameras)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
              showCameras ? 'bg-primary-600/20 text-primary-400' : 'text-neutral-500 hover:text-neutral-300'
            }`}
            title={showCameras ? 'Hide cameras' : 'Show cameras'}
          >
            <Camera size={12} />
            Cameras
          </button>
          <button
            onClick={() => { loadFloorPlan(); fetchPositions(); }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Floor Plan Map */}
      <div className="relative flex-1 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900">
        <img
          src={imagePath}
          alt="Floor plan"
          className="h-full w-full object-contain"
          draggable={false}
        />

        {/* SVG overlay for trails */}
        {showTrails && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {Object.entries(trails).map(([gid, points]) => {
              if (points.length < 2) return null;
              const pathData = points
                .map((p: TrailPoint, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x}% ${p.y}%`)
                .join(' ');
              const person = persons.find((pp) => pp.globalPersonId === gid);
              const color = getPersonColor(person?.personId ?? null);

              return (
                <path
                  key={gid}
                  d={pathData}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeOpacity="0.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>
        )}

        {/* Camera icons */}
        {showCameras &&
          cameras
            .filter((c) => c.floorX !== null && c.floorY !== null)
            .map((cam) => (
              <div
                key={cam.id}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center transition-transform hover:scale-110"
                style={{ left: `${cam.floorX}%`, top: `${cam.floorY}%` }}
                onClick={() => handleCameraClick(cam.id)}
                title={cam.label}
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-400/50 bg-neutral-800/80">
                  <Camera size={10} className="text-neutral-300" />
                </div>
                <span className="mt-0.5 rounded bg-black/50 px-0.5 text-[8px] text-neutral-400">
                  {cam.label}
                </span>
              </div>
            ))}

        {/* Person dots */}
        {persons
          .filter((p) => p.x !== undefined && p.y !== undefined)
          .map((person) => {
            const color = getPersonColor(person.personId);
            const isHovered = hoveredPerson === person.globalPersonId;
            const age = (Date.now() - person.timestamp) / 1000;
            const opacity = Math.max(0.4, 1.0 - age / 120);

            return (
              <div
                key={person.globalPersonId}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center transition-all duration-500"
                style={{
                  left: `${person.x}%`,
                  top: `${person.y}%`,
                  opacity,
                }}
                role="button"
                tabIndex={0}
                aria-label={`Person ${person.personId ?? person.globalPersonId} at ${cameras.find((c) => c.id === person.cameraId)?.label ?? person.cameraId}`}
                onClick={() => handlePersonClick(person.personId, person.cameraId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handlePersonClick(person.personId, person.cameraId); }}
                onMouseEnter={() => setHoveredPerson(person.globalPersonId)}
                onMouseLeave={() => setHoveredPerson(null)}
                onFocus={() => setHoveredPerson(person.globalPersonId)}
                onBlur={() => setHoveredPerson(null)}
              >
                <div
                  className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-white shadow-lg"
                  style={{ backgroundColor: color }}
                />
                {isHovered && (
                  <div className="absolute -top-8 whitespace-nowrap rounded bg-black/80 px-2 py-1 text-[10px] text-white shadow-lg">
                    <div className="font-medium">{person.personId ?? person.globalPersonId}</div>
                    <div className="text-neutral-400">
                      Last: {cameras.find((c) => c.id === person.cameraId)?.label ?? person.cameraId}
                      {' · '}
                      {age < 60 ? `${Math.round(age)}s ago` : `${Math.round(age / 60)}m ago`}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PERSON_COLORS.known }} />
          <span className="text-[10px] text-neutral-500">Known person</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PERSON_COLORS.unknown }} />
          <span className="text-[10px] text-neutral-500">Unknown person</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PERSON_COLORS.bodyOnly }} />
          <span className="text-[10px] text-neutral-500">Body-only (Re-ID)</span>
        </div>
      </div>
    </div>
  );
}
