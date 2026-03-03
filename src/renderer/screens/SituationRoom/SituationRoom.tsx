import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, AlertTriangle, Camera, Users, Bell, Map, Activity } from 'lucide-react';
import { useWebRTCStream } from '../../hooks/useWebRTCStream';

interface AlertItem {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  cameraId: string | null;
  personId: string | null;
  timestamp: number;
}

interface PersonStatus {
  personId: string;
  personName: string;
  state: string;
  lastCameraId: string | null;
  lastSeenAt: string | null;
}

interface FloorPosition {
  globalPersonId: string;
  personId: string | null;
  cameraId: string;
  timestamp: number;
}

interface FloorPlanCamera {
  id: string;
  label: string;
  floorX: number | null;
  floorY: number | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-red-500 bg-red-950/30 text-red-400',
  high: 'border-orange-500 bg-orange-950/30 text-orange-400',
  medium: 'border-yellow-500 bg-yellow-950/30 text-yellow-400',
  low: 'border-neutral-600 bg-neutral-900/30 text-neutral-400',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500 motion-safe:animate-pulse',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-neutral-500',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
};

const STATE_BADGES: Record<string, { color: string; label: string }> = {
  HOME: { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', label: 'HOME' },
  AWAY: { color: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30', label: 'AWAY' },
  AT_GATE: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'AT GATE' },
  ARRIVING: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'ARRIVING' },
  DEPARTING: { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', label: 'DEPARTING' },
  UNKNOWN: { color: 'bg-neutral-700/20 text-neutral-500 border-neutral-700/30', label: 'UNKNOWN' },
};

const MAX_ALERTS = 50;
const POLL_INTERVAL_MS = 5000;

export default function SituationRoom() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [presences, setPresences] = useState<PersonStatus[]>([]);
  const [positions, setPositions] = useState<FloorPosition[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [activeTracksCount, setActiveTracksCount] = useState(0);
  const [floorPlanImage, setFloorPlanImage] = useState<string | null>(null);
  const [floorPlanCameras, setFloorPlanCameras] = useState<FloorPlanCamera[]>([]);
  const alertsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { videoRef, connectionStatus } = useWebRTCStream(selectedCamera ?? '');

  // Subscribe to real-time IPC events
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // Zone events → alerts
    if (window.electronAPI?.zone?.onEvent) {
      const cleanup = window.electronAPI.zone.onEvent((data) => {
        const events = data.events as Array<{ zone_id: string; track_id: number; event_type: string }>;
        for (const evt of events) {
          const severity = evt.event_type === 'loiter' ? 'high' : evt.event_type === 'zone_enter' ? 'medium' : 'low';
          addAlert({
            type: evt.event_type,
            severity,
            message: `${evt.event_type.replace('_', ' ')} in zone ${evt.zone_id} (track ${evt.track_id})`,
            cameraId: data.cameraId,
            personId: null,
            timestamp: data.timestamp,
          });
        }
      });
      cleanups.push(cleanup);
    }

    // Topology anomalies → critical alerts
    if (window.electronAPI?.topology?.onAnomaly) {
      const cleanup = window.electronAPI.topology.onAnomaly((data) => {
        addAlert({
          type: `topology:${data.type}`,
          severity: data.type === 'skip_detected' ? 'high' : data.type === 'disappearance' ? 'medium' : 'high',
          message: `Topology anomaly: ${data.type} — ${data.description}`,
          cameraId: data.fromCameraId,
          personId: data.personId,
          timestamp: data.timestamp,
        });
      });
      cleanups.push(cleanup);
    }

    // Sound events → critical alerts
    if (window.electronAPI?.sound?.onEvent) {
      const cleanup = window.electronAPI.sound.onEvent((data) => {
        for (const evt of data.events) {
          const isCritical = ['glass_break', 'gunshot', 'scream'].includes(evt.sound_class);
          addAlert({
            type: `sound:${evt.sound_class}`,
            severity: isCritical ? 'critical' : 'medium',
            message: `Sound detected: ${evt.sound_class} (${Math.round(evt.confidence * 100)}%)`,
            cameraId: data.cameraId,
            personId: null,
            timestamp: data.timestamp,
          });
        }
      });
      cleanups.push(cleanup);
    }

    // AI object detections for track count
    if (window.electronAPI?.ai?.onObjects) {
      const cleanup = window.electronAPI.ai.onObjects((data) => {
        const objects = data.objects as Array<Record<string, unknown>>;
        setActiveTracksCount(objects.length);
      });
      cleanups.push(cleanup);
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);

  // Load floor plan data
  useEffect(() => {
    if (window.electronAPI?.floorplan?.get) {
      window.electronAPI.floorplan.get().then((data) => {
        if (data) {
          setFloorPlanImage(data.imagePath ?? null);
          setFloorPlanCameras(data.cameras ?? []);
        }
      }).catch(() => {});
    }
  }, []);

  // Poll presence and floor positions
  const fetchData = useCallback(async () => {
    try {
      if (window.electronAPI?.presence?.list) {
        const result = await window.electronAPI.presence.list();
        setPresences(result.presences ?? []);
      }
      if (window.electronAPI?.floorplan?.positions) {
        const result = await window.electronAPI.floorplan.positions();
        setPositions((result?.persons as FloorPosition[]) ?? []);
      }
    } catch (error) {
      console.error('[SituationRoom] Poll error:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchData]);

  const addAlert = useCallback((alert: Omit<AlertItem, 'id'>) => {
    setAlerts((prev) => {
      const newAlert: AlertItem = { ...alert, id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
      const updated = [newAlert, ...prev].slice(0, MAX_ALERTS);
      return updated;
    });
  }, []);

  // Auto-scroll alerts
  useEffect(() => {
    alertsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [alerts.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatRelative = (ts: string | null) => {
    if (!ts) return 'N/A';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  };

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-primary-400" />
          <h1 className="text-lg font-semibold text-neutral-100">Situation Room</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Activity size={12} />
            {activeTracksCount} active tracks
          </span>
          <span className="flex items-center gap-1">
            <Users size={12} />
            {positions.length} persons on map
          </span>
          <span className="flex items-center gap-1">
            <Bell size={12} />
            {alerts.length} alerts
          </span>
        </div>
      </div>

      {/* 4-Panel Layout */}
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-3 overflow-hidden">
        {/* Top-Left: Alerts Panel */}
        <div className="flex flex-col rounded-lg border border-neutral-700 bg-neutral-900/50">
          <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2">
            <AlertTriangle size={14} className="text-orange-400" />
            <span className="text-xs font-medium text-neutral-300">Live Alerts</span>
            <span className="ml-auto rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
              {alerts.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1.5">
            {alerts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-neutral-600">
                No alerts yet
              </div>
            ) : (
              <div className="space-y-1">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex cursor-pointer items-start gap-2 rounded border-l-2 px-2 py-1.5 ${SEVERITY_COLORS[alert.severity]}`}
                    onClick={() => alert.cameraId && setSelectedCamera(alert.cameraId)}
                  >
                    <span className="mt-0.5 flex shrink-0 items-center gap-1">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[alert.severity]}`} />
                      <span className="text-[8px] font-bold uppercase opacity-70">{SEVERITY_LABEL[alert.severity]}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] leading-tight">{alert.message}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] opacity-70">
                        <span>{formatTime(alert.timestamp)}</span>
                        {alert.cameraId && <span>{alert.cameraId}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={alertsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Top-Right: Floor Map Mini */}
        <div className="flex flex-col rounded-lg border border-neutral-700 bg-neutral-900/50">
          <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2">
            <Map size={14} className="text-blue-400" />
            <span className="text-xs font-medium text-neutral-300">Property Map</span>
            <span className="ml-auto text-[10px] text-neutral-500">
              {positions.length} tracked
            </span>
          </div>
          <div className="relative flex-1 overflow-hidden bg-neutral-950">
            {floorPlanImage ? (
              <div className="relative h-full w-full">
                <img src={floorPlanImage} alt="Floor plan" className="h-full w-full object-contain" draggable={false} />
                {floorPlanCameras.filter((c) => c.floorX != null && c.floorY != null).map((cam) => (
                  <div
                    key={cam.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select camera ${cam.label}`}
                    className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center transition-transform hover:scale-110 ${selectedCamera === cam.id ? 'scale-125' : ''}`}
                    style={{ left: `${cam.floorX}%`, top: `${cam.floorY}%` }}
                    onClick={() => setSelectedCamera(cam.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedCamera(cam.id); }}
                    title={cam.label}
                  >
                    <div className={`flex h-4 w-4 items-center justify-center rounded-full border ${selectedCamera === cam.id ? 'border-primary-400 bg-primary-600/50' : 'border-neutral-400/50 bg-neutral-800/80'}`}>
                      <Camera size={8} className="text-neutral-300" />
                    </div>
                    <span className="mt-0.5 rounded bg-black/50 px-0.5 text-[7px] text-neutral-400">{cam.label}</span>
                  </div>
                ))}
                {positions.map((p, i) => {
                  const camPos = floorPlanCameras.find((c) => c.id === p.cameraId);
                  if (!camPos || camPos.floorX == null || camPos.floorY == null) return null;
                  return (
                    <div
                      key={p.globalPersonId}
                      role="button"
                      tabIndex={0}
                      aria-label={`Person ${p.personId ?? p.globalPersonId} at ${p.cameraId}`}
                      className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                      style={{ left: `${camPos.floorX + ((i * 2) % 5) - 2}%`, top: `${camPos.floorY + ((i * 3) % 5) - 2}%` }}
                      onClick={() => setSelectedCamera(p.cameraId)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedCamera(p.cameraId); }}
                      title={p.personId ?? p.globalPersonId}
                    >
                      <div className="h-3 w-3 rounded-full border border-white bg-emerald-500 shadow-lg" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="relative h-full w-full">
                <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <pattern id="sitroom-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.3" />
                    </pattern>
                  </defs>
                  <rect width="100" height="100" fill="url(#sitroom-grid)" />
                  <text x="50" y="48" textAnchor="middle" fontSize="3.5" fill="rgba(255,255,255,0.2)">No floor plan configured</text>
                  <text x="50" y="55" textAnchor="middle" fontSize="2.5" fill="rgba(255,255,255,0.1)">Configure in Settings → Floor Plan</text>
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Bottom-Left: Active Camera Feed */}
        <div className="flex flex-col rounded-lg border border-neutral-700 bg-neutral-900/50">
          <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2">
            <Camera size={14} className="text-emerald-400" />
            <span className="text-xs font-medium text-neutral-300">Active Feed</span>
            {selectedCamera && (
              <span className="ml-auto text-[10px] text-neutral-500">{selectedCamera}</span>
            )}
          </div>
          <div className="relative flex flex-1 items-center justify-center bg-neutral-950">
            {selectedCamera ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-contain"
                />
                {connectionStatus !== 'connected' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <Camera size={20} className="mx-auto mb-1 text-neutral-600" />
                      <p className="text-[10px] text-neutral-500">
                        {connectionStatus === 'connecting' ? `Connecting to ${selectedCamera}...` : `${selectedCamera} — ${connectionStatus}`}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center">
                <Camera size={20} className="mx-auto mb-1 text-neutral-600" />
                <p className="text-[10px] text-neutral-500">Select a camera or click a person on the map</p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom-Right: Person Status + Timeline */}
        <div className="flex flex-col rounded-lg border border-neutral-700 bg-neutral-900/50">
          <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2">
            <Users size={14} className="text-purple-400" />
            <span className="text-xs font-medium text-neutral-300">Person Status</span>
            <span className="ml-auto text-[10px] text-neutral-500">
              {presences.filter((p) => p.state === 'HOME').length} home
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1.5">
            {presences.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-neutral-600">
                No enrolled persons
              </div>
            ) : (
              <div className="space-y-1">
                {presences.map((person) => {
                  const badge = STATE_BADGES[person.state] ?? STATE_BADGES.UNKNOWN;
                  return (
                    <div
                      key={person.personId}
                      className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-neutral-800/50"
                      onClick={() => person.lastCameraId && setSelectedCamera(person.lastCameraId)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-[10px] font-medium text-neutral-300">
                          {person.personName?.charAt(0)?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <p className="text-xs text-neutral-200">{person.personName}</p>
                          <p className="text-[9px] text-neutral-500">
                            {person.lastCameraId && `${person.lastCameraId} · `}
                            {formatRelative(person.lastSeenAt)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
