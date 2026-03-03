import { useState, useEffect, useCallback } from 'react';
import { Compass, Loader2, Play, Square, Crosshair } from 'lucide-react';

interface CameraOption {
  id: string;
  label: string;
  hasPtz: boolean;
}

interface PTZStatus {
  capabilities: {
    canPan: boolean;
    canTilt: boolean;
    canZoom: boolean;
    hasPresets: boolean;
    ptzType: string;
  };
  isAutoTracking: boolean;
  autoTrackInfo: { trackId: number; isActive: boolean } | null;
  isPatrolling: boolean;
}

interface PresetItem {
  id: string;
  name: string;
}

export default function PTZConfig() {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [ptzStatus, setPtzStatus] = useState<PTZStatus | null>(null);
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [dwellTime, setDwellTime] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadCameras = useCallback(async () => {
    try {
      if (!window.electronAPI?.camera?.list) return;
      const cameraList = await window.electronAPI.camera.list();
      const ptzCameras = (cameraList ?? [])
        .filter((c) => c.hasPtz)
        .map((c) => ({
          id: c.id,
          label: c.label,
          hasPtz: true,
        }));
      setCameras(ptzCameras);
      if (ptzCameras.length > 0 && !selectedCamera) {
        setSelectedCamera(ptzCameras[0].id);
      }
    } catch (error) {
      console.error('[PTZConfig] Failed to load cameras:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCamera]);

  const loadStatus = useCallback(async () => {
    if (!selectedCamera || !window.electronAPI?.ptz?.command) return;
    try {
      const status = await window.electronAPI.ptz.command(selectedCamera, 'status', {}) as unknown as PTZStatus;
      setPtzStatus(status);
    } catch (error) {
      console.error('[PTZConfig] Failed to load PTZ status:', error);
    }
  }, [selectedCamera]);

  const loadPresets = useCallback(async () => {
    if (!selectedCamera || !window.electronAPI?.ptz?.presets) return;
    try {
      const result = await window.electronAPI.ptz.presets(selectedCamera);
      setPresets((result as { presets: PresetItem[] })?.presets ?? []);
    } catch (error) {
      console.error('[PTZConfig] Failed to load presets:', error);
    }
  }, [selectedCamera]);

  useEffect(() => {
    loadCameras();
  }, [loadCameras]);

  useEffect(() => {
    if (selectedCamera) {
      loadStatus();
      loadPresets();
    }
  }, [selectedCamera, loadStatus, loadPresets]);

  const handleAutoTrackToggle = async () => {
    if (!selectedCamera || !window.electronAPI?.ptz) return;
    setStatusMessage(null);

    try {
      if (ptzStatus?.isAutoTracking) {
        await window.electronAPI.ptz.command(selectedCamera, 'autotrack:stop', {});
        setStatusMessage({ type: 'success', text: 'Auto-tracking stopped.' });
      } else {
        await window.electronAPI.ptz.command(selectedCamera, 'autotrack:start', { trackId: 0 });
        setStatusMessage({ type: 'success', text: 'Auto-tracking started (next detected person).' });
      }
      await loadStatus();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatusMessage({ type: 'error', text: `Auto-track failed: ${msg}` });
    }
  };

  const handlePatrolToggle = async () => {
    if (!selectedCamera || !window.electronAPI?.ptz) return;
    setStatusMessage(null);

    try {
      if (ptzStatus?.isPatrolling) {
        await window.electronAPI.ptz.command(selectedCamera, 'patrol:stop', {});
        setStatusMessage({ type: 'success', text: 'Patrol stopped.' });
      } else {
        await window.electronAPI.ptz.command(selectedCamera, 'patrol:start', { dwellTimeMs: dwellTime * 1000 });
        setStatusMessage({ type: 'success', text: `Patrol started (${dwellTime}s dwell).` });
      }
      await loadStatus();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatusMessage({ type: 'error', text: `Patrol failed: ${msg}` });
    }
  };

  const handleGotoPreset = async (presetId: string) => {
    if (!selectedCamera || !window.electronAPI?.ptz) return;
    try {
      await window.electronAPI.ptz.command(selectedCamera, 'go_to_preset', { presetId });
      setStatusMessage({ type: 'success', text: `Moved to preset.` });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatusMessage({ type: 'error', text: `Preset failed: ${msg}` });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading PTZ config...</span>
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Compass size={18} className="text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-200">PTZ Configuration</h3>
        </div>
        <p className="text-xs text-neutral-500">No PTZ-capable cameras found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Compass size={18} className="text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-200">PTZ Configuration</h3>
      </div>

      {/* Camera Selector */}
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Camera</label>
        <select
          value={selectedCamera}
          onChange={(e) => setSelectedCamera(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
        >
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Status */}
      {ptzStatus && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">PTZ Type</span>
            <span className="text-neutral-300">{ptzStatus.capabilities.ptzType}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">Capabilities</span>
            <span className="text-neutral-300">
              {[
                ptzStatus.capabilities.canPan && 'Pan',
                ptzStatus.capabilities.canTilt && 'Tilt',
                ptzStatus.capabilities.canZoom && 'Zoom',
                ptzStatus.capabilities.hasPresets && 'Presets',
              ].filter(Boolean).join(', ')}
            </span>
          </div>

          {/* Auto-Track Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-neutral-200">Auto-Tracking</p>
              <p className="text-[10px] text-neutral-500">
                {ptzStatus.isAutoTracking
                  ? `Tracking track #${ptzStatus.autoTrackInfo?.trackId ?? '?'}`
                  : 'PID-controlled smooth following'}
              </p>
            </div>
            <button
              onClick={handleAutoTrackToggle}
              aria-label={ptzStatus.isAutoTracking ? 'Stop auto-tracking' : 'Start auto-tracking'}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                ptzStatus.isAutoTracking
                  ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                  : 'bg-primary-600/20 text-primary-400 hover:bg-primary-600/30'
              }`}
            >
              {ptzStatus.isAutoTracking ? <Square size={10} /> : <Crosshair size={10} />}
              {ptzStatus.isAutoTracking ? 'Stop' : 'Start'}
            </button>
          </div>

          {/* Patrol Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-neutral-200">Patrol Mode</p>
              <p className="text-[10px] text-neutral-500">
                Cycle through {presets.length} preset{presets.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <label className="text-[10px] text-neutral-500">Dwell</label>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={dwellTime}
                  onChange={(e) => setDwellTime(parseInt(e.target.value, 10) || 10)}
                  className="w-12 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-200 focus:border-primary-500 focus:outline-none"
                />
                <span className="text-[10px] text-neutral-600">s</span>
              </div>
              <button
                onClick={handlePatrolToggle}
                disabled={presets.length === 0}
                aria-label={ptzStatus.isPatrolling ? 'Stop patrol' : 'Start patrol'}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
                  ptzStatus.isPatrolling
                    ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                    : 'bg-primary-600/20 text-primary-400 hover:bg-primary-600/30'
                }`}
              >
                {ptzStatus.isPatrolling ? <Square size={10} /> : <Play size={10} />}
                {ptzStatus.isPatrolling ? 'Stop' : 'Start'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presets */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
        <h4 className="mb-2 text-xs font-medium text-neutral-400">Presets</h4>
        {presets.length === 0 ? (
          <p className="text-[10px] text-neutral-600">No presets configured on this camera.</p>
        ) : (
          <div className="space-y-1">
            {presets.map((preset) => (
              <div key={preset.id} className="flex items-center justify-between">
                <span className="text-xs text-neutral-300">{preset.name}</span>
                <button
                  onClick={() => handleGotoPreset(preset.id)}
                  className="rounded px-2 py-0.5 text-[10px] text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
                >
                  Go To
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status Message */}
      {statusMessage && (
        <span className={`text-xs ${statusMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
          {statusMessage.text}
        </span>
      )}
    </div>
  );
}
