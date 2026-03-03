import { useState, useEffect, useCallback } from 'react';
import { Save, LayoutGrid, Loader2 } from 'lucide-react';

type LayoutOption = '1x1' | '2x2' | '3x1' | 'custom';

const LAYOUT_OPTIONS: { value: LayoutOption; label: string; description: string }[] = [
  { value: '1x1', label: '1×1', description: 'Single camera fullscreen' },
  { value: '2x2', label: '2×2', description: 'Four cameras in grid' },
  { value: '3x1', label: '3×1', description: 'Three cameras in row' },
  { value: 'custom', label: 'Custom', description: 'User-defined layout' },
];

export default function LayoutPreferences() {
  const [defaultLayout, setDefaultLayout] = useState<LayoutOption>('2x2');
  const [miniPtzEnabled, setMiniPtzEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Stored values for change detection
  const [storedLayout, setStoredLayout] = useState<LayoutOption>('2x2');
  const [storedMiniPtz, setStoredMiniPtz] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      if (!window.electronAPI?.settings?.get) return;

      const [layoutRes, ptzRes] = await Promise.all([
        window.electronAPI.settings.get('default_layout'),
        window.electronAPI.settings.get('mini_ptz_enabled'),
      ]);

      const l = (layoutRes?.value || '2x2') as LayoutOption;
      const p = ptzRes?.value === 'true';

      setDefaultLayout(l);
      setMiniPtzEnabled(p);
      setStoredLayout(l);
      setStoredMiniPtz(p);
    } catch (error) {
      console.error('[LayoutPreferences] Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const hasChanges = defaultLayout !== storedLayout || miniPtzEnabled !== storedMiniPtz;

  const handleSave = async () => {
    if (!window.electronAPI?.settings?.set) return;

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await Promise.all([
        window.electronAPI.settings.set('default_layout', defaultLayout),
        window.electronAPI.settings.set('mini_ptz_enabled', String(miniPtzEnabled)),
      ]);

      setStoredLayout(defaultLayout);
      setStoredMiniPtz(miniPtzEnabled);
      setStatusMessage({ type: 'success', text: 'Layout preferences saved.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LayoutPreferences] Save failed:', message);
      setStatusMessage({ type: 'error', text: `Save failed: ${message}` });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading layout preferences...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <LayoutGrid size={18} className="text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-200">Layout Preferences</h3>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 space-y-4">
        {/* Default Layout Selector */}
        <div>
          <label className="mb-2 block text-xs text-neutral-500">Default Camera Layout</label>
          <div className="grid grid-cols-4 gap-2">
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDefaultLayout(opt.value)}
                className={`rounded border px-3 py-2 text-center transition-colors ${
                  defaultLayout === opt.value
                    ? 'border-primary-500 bg-primary-600/10 text-primary-400'
                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300'
                }`}
              >
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="mt-0.5 text-[10px] text-neutral-500">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Mini PTZ Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-200">Mini PTZ Controls (CAM-2)</p>
            <p className="text-xs text-neutral-500">
              Show compact PTZ overlay on the camera tile for CAM-2
            </p>
          </div>
          <button
            onClick={() => setMiniPtzEnabled(!miniPtzEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              miniPtzEnabled ? 'bg-primary-600' : 'bg-neutral-700'
            }`}
            role="switch"
            aria-checked={miniPtzEnabled}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                miniPtzEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Save */}
        <div className="flex items-center justify-between pt-1">
          <div>
            {statusMessage && (
              <span
                className={`text-xs ${statusMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {statusMessage.text}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="flex items-center gap-1.5 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
