import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ZoomIn,
  ZoomOut,
  Bookmark,
  Save,
  Loader2,
} from 'lucide-react';

interface PTZControlsProps {
  cameraId: string;
}

interface Preset {
  id: string;
  name: string;
}

type PtzDirection = 'move_up' | 'move_down' | 'move_left' | 'move_right';

export default function PTZControls({ cameraId }: PTZControlsProps) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const activeDirectionRef = useRef<PtzDirection | null>(null);

  const sendPtzCommand = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      try {
        if (window.electronAPI?.ptz?.command) {
          await window.electronAPI.ptz.command(cameraId, action, params);
        }
      } catch (error) {
        console.error(`[PTZControls] Command ${action} failed for ${cameraId}:`, error);
      }
    },
    [cameraId]
  );

  const handleDirectionStart = useCallback(
    (direction: PtzDirection) => {
      if (activeDirectionRef.current === direction) {
        return;
      }
      activeDirectionRef.current = direction;
      sendPtzCommand(direction, { speed: 50 });
    },
    [sendPtzCommand]
  );

  const handleDirectionStop = useCallback(() => {
    if (activeDirectionRef.current) {
      activeDirectionRef.current = null;
      sendPtzCommand('stop');
    }
  }, [sendPtzCommand]);

  const handleZoom = useCallback(
    (direction: 'zoom_in' | 'zoom_out') => {
      sendPtzCommand(direction, { speed: 20 });
    },
    [sendPtzCommand]
  );

  const loadPresets = useCallback(async () => {
    setIsLoadingPresets(true);
    try {
      if (window.electronAPI?.ptz?.presets) {
        const result = await window.electronAPI.ptz.presets(cameraId);
        setPresets(result.presets ?? []);
      }
    } catch (error) {
      console.error(`[PTZControls] Failed to load presets for ${cameraId}:`, error);
    } finally {
      setIsLoadingPresets(false);
    }
  }, [cameraId]);

  const goToPreset = useCallback(
    (presetId: string) => {
      sendPtzCommand('go_to_preset', { presetId });
    },
    [sendPtzCommand]
  );

  const savePreset = useCallback(async () => {
    if (!newPresetName.trim()) {
      return;
    }

    setIsSavingPreset(true);
    try {
      await sendPtzCommand('set_preset', { name: newPresetName.trim() });
      setNewPresetName('');
      await loadPresets();
    } catch (error) {
      console.error(`[PTZControls] Failed to save preset:`, error);
    } finally {
      setIsSavingPreset(false);
    }
  }, [newPresetName, sendPtzCommand, loadPresets]);

  const togglePresets = useCallback(() => {
    const next = !showPresets;
    setShowPresets(next);
    if (next) {
      loadPresets();
    }
  }, [showPresets, loadPresets]);

  // Stop PTZ on unmount
  useEffect(() => {
    return () => {
      if (activeDirectionRef.current) {
        sendPtzCommand('stop');
      }
    };
  }, [sendPtzCommand]);

  const directionButtonClass =
    'flex items-center justify-center rounded-md bg-neutral-800/80 p-2 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white active:bg-primary-600 active:text-white';

  return (
    <div className="flex flex-col items-end gap-3">
      {/* Presets panel */}
      {showPresets && (
        <div className="w-52 rounded-lg border border-neutral-700 bg-neutral-900/95 p-3 backdrop-blur-md">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Presets
          </h4>

          {isLoadingPresets ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 size={16} className="animate-spin text-neutral-500" />
            </div>
          ) : presets.length > 0 ? (
            <div className="mb-2 flex flex-col gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => goToPreset(preset.id)}
                  className="rounded px-2 py-1.5 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="mb-2 text-xs text-neutral-500">No presets saved</p>
          )}

          <div className="flex items-center gap-1 border-t border-neutral-700 pt-2">
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Preset name"
              className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 outline-none focus:ring-1 focus:ring-primary-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  savePreset();
                }
              }}
            />
            <button
              onClick={savePreset}
              disabled={!newPresetName.trim() || isSavingPreset}
              className="rounded bg-primary-600 p-1.5 text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
              title="Save current position as preset"
              aria-label="Save preset"
            >
              {isSavingPreset ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Control panel */}
      <div className="rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {/* Direction pad */}
          <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
            {/* Row 1 */}
            <div />
            <button
              className={directionButtonClass}
              onMouseDown={() => handleDirectionStart('move_up')}
              onMouseUp={handleDirectionStop}
              onMouseLeave={handleDirectionStop}
              aria-label="Pan up"
              title="Pan up"
            >
              <ChevronUp size={16} />
            </button>
            <div />

            {/* Row 2 */}
            <button
              className={directionButtonClass}
              onMouseDown={() => handleDirectionStart('move_left')}
              onMouseUp={handleDirectionStop}
              onMouseLeave={handleDirectionStop}
              aria-label="Pan left"
              title="Pan left"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="flex items-center justify-center rounded-md bg-neutral-800/80 p-2 text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-white active:bg-red-600 active:text-white"
              onClick={() => sendPtzCommand('stop')}
              aria-label="Stop movement"
              title="Stop"
            >
              <Circle size={12} fill="currentColor" />
            </button>
            <button
              className={directionButtonClass}
              onMouseDown={() => handleDirectionStart('move_right')}
              onMouseUp={handleDirectionStop}
              onMouseLeave={handleDirectionStop}
              aria-label="Pan right"
              title="Pan right"
            >
              <ChevronRight size={16} />
            </button>

            {/* Row 3 */}
            <div />
            <button
              className={directionButtonClass}
              onMouseDown={() => handleDirectionStart('move_down')}
              onMouseUp={handleDirectionStop}
              onMouseLeave={handleDirectionStop}
              aria-label="Pan down"
              title="Pan down"
            >
              <ChevronDown size={16} />
            </button>
            <div />
          </div>

          {/* Zoom + Presets column */}
          <div className="flex flex-col gap-1">
            <button
              className={directionButtonClass}
              onClick={() => handleZoom('zoom_in')}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button
              className={directionButtonClass}
              onClick={() => handleZoom('zoom_out')}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <button
              className={`${directionButtonClass} ${showPresets ? 'bg-primary-600/30 text-primary-400' : ''}`}
              onClick={togglePresets}
              aria-label="Toggle presets"
              title="Presets"
            >
              <Bookmark size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
