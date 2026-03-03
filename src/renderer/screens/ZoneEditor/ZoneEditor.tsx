import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, PlusCircle, Trash2, Save, Eye, EyeOff,
  Hexagon, Minus, AlertTriangle, BarChart3, ChevronLeft,
} from 'lucide-react';
import type { Zone, ZoneType, CameraListItem } from '../../../shared/types';
import PolygonDrawTool from '../../components/PolygonDrawTool/PolygonDrawTool';
import TripwireDrawTool from '../../components/TripwireDrawTool/TripwireDrawTool';
import { useWebRTCStream } from '../../hooks/useWebRTCStream';

// --- Constants ---

const ZONE_TYPE_OPTIONS: { value: ZoneType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'RESTRICTED', label: 'Restricted', icon: <Shield size={14} />, color: '#EF4444' },
  { value: 'MONITORED', label: 'Monitored', icon: <Eye size={14} />, color: '#3B82F6' },
  { value: 'COUNTING', label: 'Counting', icon: <BarChart3 size={14} />, color: '#22C55E' },
  { value: 'TRIPWIRE', label: 'Tripwire', icon: <Minus size={14} />, color: '#F59E0B' },
];

const DEFAULT_ZONE_COLORS: Record<ZoneType, string> = {
  RESTRICTED: '#EF4444',
  MONITORED: '#3B82F6',
  COUNTING: '#22C55E',
  TRIPWIRE: '#F59E0B',
};

interface ZoneEditorProps {
  onBack?: () => void;
}

interface ZoneDraft {
  id?: string;
  name: string;
  zoneType: ZoneType;
  geometry: { points: Array<{ x: number; y: number }> } | { x1: number; y1: number; x2: number; y2: number; direction: string };
  color: string;
  alertEnabled: boolean;
  loiterThresholdSec: number;
  loiterCooldownSec: number;
  loiterMovementRadius: number;
}

const EMPTY_DRAFT: ZoneDraft = {
  name: '',
  zoneType: 'RESTRICTED',
  geometry: { points: [] },
  color: '#EF4444',
  alertEnabled: true,
  loiterThresholdSec: 15,
  loiterCooldownSec: 180,
  loiterMovementRadius: 80,
};

export default function ZoneEditor({ onBack }: ZoneEditorProps) {
  const [cameras, setCameras] = useState<CameraListItem[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draft, setDraft] = useState<ZoneDraft>({ ...EMPTY_DRAFT });
  const [showZones, setShowZones] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // WebRTC camera feed for zone drawing canvas
  const { videoRef: webrtcVideoRef, connectionStatus: webrtcStatus } = useWebRTCStream(selectedCameraId);

  // Load cameras on mount
  useEffect(() => {
    window.electronAPI.camera.list().then((cams) => {
      setCameras(cams);
      if (cams.length > 0 && !selectedCameraId) {
        setSelectedCameraId(cams[0]!.id);
      }
    }).catch((err) => {
      console.error('[ZoneEditor] Failed to load cameras:', err);
    });
  }, []);

  const loadZones = useCallback(() => {
    if (!selectedCameraId) return;
    window.electronAPI.zone.list(selectedCameraId).then((result) => {
      setZones(result.zones);
    }).catch((err) => {
      console.error('[ZoneEditor] Failed to load zones:', err);
    });
  }, [selectedCameraId]);

  // Load zones when camera changes
  useEffect(() => {
    if (!selectedCameraId) return;
    loadZones();
  }, [selectedCameraId, loadZones]);

  const handleSelectZone = useCallback((zone: Zone) => {
    setSelectedZoneId(zone.id);
    try {
      const geometry = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;
      setDraft({
        id: zone.id,
        name: zone.name,
        zoneType: zone.zoneType,
        geometry,
        color: zone.color,
        alertEnabled: zone.alertEnabled,
        loiterThresholdSec: zone.loiterThresholdSec,
        loiterCooldownSec: zone.loiterCooldownSec,
        loiterMovementRadius: zone.loiterMovementRadius,
      });
    } catch {
      console.error('[ZoneEditor] Failed to parse zone geometry');
    }
    setIsDrawing(false);
  }, []);

  const handleNewZone = useCallback(async (type: ZoneType) => {
    setSelectedZoneId(null);
    const defaultGeometry = type === 'TRIPWIRE'
      ? { x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, direction: 'left_to_right' }
      : { points: [] };

    let loiterSec = EMPTY_DRAFT.loiterThresholdSec;
    let cooldownSec = EMPTY_DRAFT.loiterCooldownSec;
    let movementRadius = EMPTY_DRAFT.loiterMovementRadius;
    let alertEnabled = EMPTY_DRAFT.alertEnabled;

    try {
      if (window.electronAPI?.settings?.get) {
        const [ls, cs, mr, ae] = await Promise.all([
          window.electronAPI.settings.get('zone_default_loiter_sec'),
          window.electronAPI.settings.get('zone_default_cooldown_sec'),
          window.electronAPI.settings.get('zone_default_movement_radius'),
          window.electronAPI.settings.get('zone_default_alert_enabled'),
        ]);
        if (ls != null) loiterSec = Number(ls) || loiterSec;
        if (cs != null) cooldownSec = Number(cs) || cooldownSec;
        if (mr != null) movementRadius = Number(mr) || movementRadius;
        if (ae != null) alertEnabled = String(ae) !== 'false';
      }
    } catch { /* use EMPTY_DRAFT defaults */ }

    setDraft({
      ...EMPTY_DRAFT,
      zoneType: type,
      color: DEFAULT_ZONE_COLORS[type],
      geometry: defaultGeometry,
      loiterThresholdSec: loiterSec,
      loiterCooldownSec: cooldownSec,
      loiterMovementRadius: movementRadius,
      alertEnabled,
    });
    setIsDrawing(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedCameraId || !draft.name.trim()) return;

    setIsSaving(true);
    try {
      await window.electronAPI.zone.save({
        id: draft.id,
        cameraId: selectedCameraId,
        name: draft.name.trim(),
        zoneType: draft.zoneType,
        geometry: draft.geometry,
        color: draft.color,
        alertEnabled: draft.alertEnabled,
        loiterThresholdSec: draft.loiterThresholdSec,
        loiterCooldownSec: draft.loiterCooldownSec,
        loiterMovementRadius: draft.loiterMovementRadius,
      });
      setIsDrawing(false);
      setSelectedZoneId(null);
      setDraft({ ...EMPTY_DRAFT });
      loadZones();
    } catch (err) {
      console.error('[ZoneEditor] Failed to save zone:', err);
    } finally {
      setIsSaving(false);
    }
  }, [selectedCameraId, draft, loadZones]);

  const handleDelete = useCallback(async (zoneId: string) => {
    try {
      await window.electronAPI.zone.delete(zoneId);
      setSelectedZoneId(null);
      setDraft({ ...EMPTY_DRAFT });
      loadZones();
    } catch (err) {
      console.error('[ZoneEditor] Failed to delete zone:', err);
    }
  }, [loadZones]);

  const handlePolygonChange = useCallback((points: Array<{ x: number; y: number }>) => {
    setDraft((prev) => ({ ...prev, geometry: { points } }));
  }, []);

  const handleTripwireChange = useCallback((line: { x1: number; y1: number; x2: number; y2: number; direction: string }) => {
    setDraft((prev) => ({ ...prev, geometry: line }));
  }, []);

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-800 px-6 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Go back"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <Shield size={20} className="text-primary-400" />
        <h1 className="text-lg font-semibold text-neutral-100">Zone Editor</h1>

        {/* Camera Selector */}
        <select
          value={selectedCameraId}
          onChange={(e) => setSelectedCameraId(e.target.value)}
          className="ml-4 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          aria-label="Select camera"
        >
          {cameras.map((cam) => (
            <option key={cam.id} value={cam.id}>
              {cam.label} ({cam.id})
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Toggle Zone Visibility */}
        <button
          onClick={() => setShowZones(!showZones)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            showZones ? 'bg-primary-600/20 text-primary-400' : 'bg-neutral-800 text-neutral-500'
          }`}
          title={showZones ? 'Hide zones' : 'Show zones'}
        >
          {showZones ? <Eye size={14} /> : <EyeOff size={14} />}
          {showZones ? 'Visible' : 'Hidden'}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Zone List + Properties */}
        <div className="flex w-72 flex-col border-r border-neutral-800 bg-neutral-900/50">
          {/* Zone Type Buttons */}
          <div className="border-b border-neutral-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Add New Zone
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {ZONE_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleNewZone(opt.value)}
                  className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-750 hover:text-neutral-100"
                  style={{ borderLeftColor: opt.color, borderLeftWidth: 3 }}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Zone List */}
          <div className="flex-1 overflow-auto p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Zones ({zones.length})
            </p>
            {zones.length === 0 ? (
              <p className="text-xs text-neutral-600">No zones defined for this camera.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {zones.map((zone) => {
                  const isSelected = selectedZoneId === zone.id;
                  return (
                    <button
                      key={zone.id}
                      onClick={() => handleSelectZone(zone)}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-primary-600/20 text-primary-300'
                          : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: zone.color }}
                      />
                      <span className="flex-1 truncate">{zone.name}</span>
                      <span className="text-[10px] text-neutral-600">{zone.zoneType}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Zone Properties Panel */}
          {(isDrawing || selectedZoneId) && (
            <div className="border-t border-neutral-800 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                {selectedZoneId ? 'Edit Zone' : 'New Zone'}
              </p>

              {/* Name */}
              <label className="mb-2 block">
                <span className="text-[10px] text-neutral-500">Name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Zone name..."
                  className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none"
                />
              </label>

              {/* Type */}
              <label className="mb-2 block">
                <span className="text-[10px] text-neutral-500">Type</span>
                <select
                  value={draft.zoneType}
                  onChange={(e) => {
                    const newType = e.target.value as ZoneType;
                    setDraft((prev) => ({
                      ...prev,
                      zoneType: newType,
                      color: DEFAULT_ZONE_COLORS[newType],
                      geometry: newType === 'TRIPWIRE'
                        ? { x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, direction: 'left_to_right' }
                        : ('points' in prev.geometry ? prev.geometry : { points: [] }),
                    }));
                  }}
                  className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                >
                  {ZONE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Color */}
              <label className="mb-2 flex items-center gap-2">
                <span className="text-[10px] text-neutral-500">Color</span>
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft((prev) => ({ ...prev, color: e.target.value }))}
                  className="h-6 w-8 cursor-pointer rounded border border-neutral-700 bg-neutral-800"
                />
              </label>

              {/* Alert Enabled */}
              <label className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.alertEnabled}
                  onChange={(e) => setDraft((prev) => ({ ...prev, alertEnabled: e.target.checked }))}
                  className="rounded border-neutral-600"
                />
                <span className="text-[11px] text-neutral-300">Alert enabled</span>
              </label>

              {/* Loitering Settings (for non-tripwire) */}
              {draft.zoneType !== 'TRIPWIRE' && (
                <div className="mt-1 space-y-1.5">
                  <label className="block">
                    <span className="text-[10px] text-neutral-500">Loiter threshold (sec)</span>
                    <input
                      type="number"
                      value={draft.loiterThresholdSec}
                      min={5}
                      max={600}
                      onChange={(e) => setDraft((prev) => ({ ...prev, loiterThresholdSec: parseInt(e.target.value, 10) || 15 }))}
                      className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-neutral-500">Cooldown (sec)</span>
                    <input
                      type="number"
                      value={draft.loiterCooldownSec}
                      min={10}
                      max={3600}
                      onChange={(e) => setDraft((prev) => ({ ...prev, loiterCooldownSec: parseInt(e.target.value, 10) || 180 }))}
                      className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-neutral-500">Movement radius (px)</span>
                    <input
                      type="number"
                      value={draft.loiterMovementRadius}
                      min={10}
                      max={500}
                      onChange={(e) => setDraft((prev) => ({ ...prev, loiterMovementRadius: parseInt(e.target.value, 10) || 80 }))}
                      className="mt-0.5 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                    />
                  </label>
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !draft.name.trim()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
                >
                  <Save size={13} />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                {selectedZoneId && (
                  <button
                    onClick={() => handleDelete(selectedZoneId)}
                    className="flex items-center gap-1 rounded-md bg-red-600/20 px-2.5 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-600/30"
                    title="Delete zone"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Drawing Canvas */}
        <div className="relative flex-1 bg-neutral-950">
          <div className="flex h-full items-center justify-center">
            {/* Camera preview placeholder + drawing overlay */}
            <div className="relative aspect-video w-full max-w-4xl bg-neutral-900 rounded-lg overflow-hidden">
              {/* Live camera feed via WebRTC */}
              {selectedCameraId && webrtcStatus === 'connected' ? (
                <video
                  ref={webrtcVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm">
                  <div className="text-center">
                    <Hexagon size={48} className="mx-auto mb-2 text-neutral-700" />
                    <p>{selectedCamera ? `${selectedCamera.label} (${selectedCamera.id})` : 'No camera selected'}</p>
                    <p className="mt-1 text-[10px] text-neutral-700">
                      {selectedCameraId && webrtcStatus === 'connecting'
                        ? 'Connecting to camera feed...'
                        : isDrawing
                          ? draft.zoneType === 'TRIPWIRE'
                            ? 'Click start and end points to draw tripwire'
                            : 'Click to add vertices, double-click to close polygon'
                          : 'Select a zone or create a new one'}
                    </p>
                  </div>
                </div>
              )}

              {/* Render existing zones */}
              {showZones && (
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  {zones
                    .filter((z) => z.id !== selectedZoneId)
                    .map((zone) => {
                      try {
                        const geom = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;
                        if (zone.zoneType === 'TRIPWIRE' && 'x1' in geom) {
                          return (
                            <line
                              key={zone.id}
                              x1={geom.x1}
                              y1={geom.y1}
                              x2={geom.x2}
                              y2={geom.y2}
                              stroke={zone.color}
                              strokeWidth={0.004}
                              strokeOpacity={0.6}
                            />
                          );
                        }
                        if ('points' in geom && geom.points.length >= 3) {
                          const pointsStr = geom.points.map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(' ');
                          return (
                            <polygon
                              key={zone.id}
                              points={pointsStr}
                              fill={zone.color}
                              fillOpacity={0.15}
                              stroke={zone.color}
                              strokeWidth={0.003}
                              strokeOpacity={0.6}
                            />
                          );
                        }
                      } catch { /* ignore parse errors */ }
                      return null;
                    })}
                </svg>
              )}

              {/* Active Drawing Tool */}
              {isDrawing && draft.zoneType === 'TRIPWIRE' && (
                <TripwireDrawTool
                  initialLine={'x1' in draft.geometry ? draft.geometry as { x1: number; y1: number; x2: number; y2: number; direction: string } : undefined}
                  color={draft.color}
                  onChange={handleTripwireChange}
                />
              )}

              {isDrawing && draft.zoneType !== 'TRIPWIRE' && (
                <PolygonDrawTool
                  initialPoints={'points' in draft.geometry ? (draft.geometry as { points: Array<{ x: number; y: number }> }).points : []}
                  color={draft.color}
                  onChange={handlePolygonChange}
                />
              )}

              {/* Selected zone overlay */}
              {!isDrawing && selectedZoneId && showZones && (
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  {(() => {
                    try {
                      const geom = draft.geometry;
                      if (draft.zoneType === 'TRIPWIRE' && 'x1' in geom) {
                        return (
                          <line
                            x1={geom.x1}
                            y1={geom.y1}
                            x2={geom.x2}
                            y2={geom.y2}
                            stroke={draft.color}
                            strokeWidth={0.006}
                            strokeOpacity={0.9}
                          />
                        );
                      }
                      if ('points' in geom && geom.points.length >= 3) {
                        const pointsStr = geom.points.map((p) => `${p.x},${p.y}`).join(' ');
                        return (
                          <polygon
                            points={pointsStr}
                            fill={draft.color}
                            fillOpacity={0.25}
                            stroke={draft.color}
                            strokeWidth={0.005}
                            strokeOpacity={0.9}
                          />
                        );
                      }
                    } catch { /* ignore */ }
                    return null;
                  })()}
                </svg>
              )}

              {/* Loitering Warning Badge */}
              {(isDrawing || selectedZoneId) && draft.zoneType === 'RESTRICTED' && (
                <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-red-600/80 px-2 py-1 text-[10px] font-medium text-white">
                  <AlertTriangle size={12} />
                  RESTRICTED
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
