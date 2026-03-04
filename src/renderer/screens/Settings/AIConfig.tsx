import { useState, useEffect, useCallback } from 'react';
import { Brain, Save, Loader2, Activity } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

interface AISettings {
  detectionConfidence: number;
  faceConfidence: number;
  reidEnabled: boolean;
  reidThreshold: number;
  gaitEnabled: boolean;
  livenessEnabled: boolean;
  maxConcurrentInference: number;
  inferenceDevice: string;
}

const DEFAULT_SETTINGS: AISettings = {
  detectionConfidence: 0.5,
  faceConfidence: 0.6,
  reidEnabled: true,
  reidThreshold: 0.7,
  gaitEnabled: true,
  livenessEnabled: false,
  maxConcurrentInference: 4,
  inferenceDevice: 'cuda',
};

const TAB_ID = 'ai';

export default function AIConfig() {
  const { draftSettings, loadSettings, updateDraftBulk, saveDraft } = useSettings();
  const settings = (draftSettings[TAB_ID] as AISettings) || DEFAULT_SETTINGS;
  
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [healthStatus, setHealthStatus] = useState<{ aiStatus: string; gpuEnabled: boolean } | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      if (window.electronAPI?.system?.getStatus) {
        const status = await window.electronAPI.system.getStatus();
        setHealthStatus({
          aiStatus: status?.aiServiceStatus ?? 'unknown',
          gpuEnabled: status?.gpuEnabled ?? false,
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.settings?.get) return;

    const migrateKey = async (oldKey: string, newKey: string) => {
      try {
        const newVal = await window.electronAPI.settings.get(newKey);
        if (newVal != null) return;
        const oldVal = await window.electronAPI.settings.get(oldKey);
        if (oldVal != null) await window.electronAPI.settings.set(newKey, String(oldVal));
      } catch { /* ignore */ }
    };

    Promise.all([
      migrateKey('ai.detectionConfidence', 'yolo_confidence'),
      migrateKey('ai.faceConfidence', 'recognition_threshold'),
      migrateKey('ai.reidEnabled', 'reid_enabled'),
      migrateKey('ai.reidThreshold', 'reid_face_weight'),
      migrateKey('ai.gaitEnabled', 'gait_enabled'),
      migrateKey('ai.livenessEnabled', 'liveness_enabled'),
      migrateKey('ai.inferenceDevice', 'gpu_enabled'),
    ]).then(() => {
      const KEY_MAP: Record<keyof AISettings, string> = {
        detectionConfidence: 'yolo_confidence',
        faceConfidence: 'recognition_threshold',
        reidEnabled: 'reid_enabled',
        reidThreshold: 'reid_face_weight',
        gaitEnabled: 'gait_enabled',
        livenessEnabled: 'liveness_enabled',
        maxConcurrentInference: 'max_concurrent_inference',
        inferenceDevice: 'gpu_enabled',
      };
      return Promise.all(
        (Object.entries(KEY_MAP) as Array<[keyof AISettings, string]>).map(([uiKey, dbKey]) =>
          window.electronAPI.settings.get(dbKey).then((res) => [uiKey, res] as const).catch(() => [uiKey, null] as const)
        )
      );
    }).then((entries) => {
      const next = { ...DEFAULT_SETTINGS };
      for (const [key, val] of entries) {
        if (val == null) continue;
        const strVal = String(val);
        if (key === 'inferenceDevice') {
          (next as Record<string, unknown>)[key] = strVal === 'true' ? 'cuda' : 'cpu';
        } else if (typeof DEFAULT_SETTINGS[key] === 'number') {
          (next as Record<string, unknown>)[key] = parseFloat(strVal) || DEFAULT_SETTINGS[key];
        } else if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
          (next as Record<string, unknown>)[key] = strVal === 'true';
        } else {
          (next as Record<string, unknown>)[key] = strVal;
        }
      }
      updateDraftBulk(TAB_ID, next);
    }).catch(() => { /* use defaults */ });
    loadHealth();
  }, [loadHealth]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      await saveDraft(TAB_ID, async () => {
        if (window.electronAPI?.settings?.set) {
          await window.electronAPI.settings.set('yolo_confidence', String(settings.detectionConfidence));
          await window.electronAPI.settings.set('recognition_threshold', String(settings.faceConfidence));
          await window.electronAPI.settings.set('reid_enabled', String(settings.reidEnabled));
          await window.electronAPI.settings.set('reid_face_weight', String(settings.reidThreshold));
          await window.electronAPI.settings.set('gait_enabled', String(settings.gaitEnabled));
          await window.electronAPI.settings.set('liveness_enabled', String(settings.livenessEnabled));
          await window.electronAPI.settings.set('max_concurrent_inference', String(settings.maxConcurrentInference));
          await window.electronAPI.settings.set('gpu_enabled', settings.inferenceDevice === 'cuda' ? 'true' : 'false');
        }
      });
      setStatusMessage({ type: 'success', text: 'AI settings saved.' });
      loadHealth();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: `Save failed: ${msg}` });
    } finally {
      setIsSaving(false);
    }
  }, [settings, loadHealth, saveDraft]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Brain size={18} className="text-purple-400" />
        <h2 className="text-lg font-medium text-neutral-100">AI Configuration</h2>
      </div>

      {healthStatus && (
        <div className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-800/50 px-3 py-2 text-xs">
          <Activity size={14} className={healthStatus.aiStatus === 'healthy' ? 'text-emerald-400' : healthStatus.aiStatus === 'starting' ? 'text-yellow-400' : 'text-red-400'} />
          <span className="text-neutral-300">
            AI Service: <span className={healthStatus.aiStatus === 'healthy' ? 'text-emerald-400' : healthStatus.aiStatus === 'starting' ? 'text-yellow-400' : 'text-red-400'}>{healthStatus.aiStatus === 'healthy' ? 'Healthy' : healthStatus.aiStatus === 'starting' ? 'Starting' : healthStatus.aiStatus}</span>
          </span>
          <span className="text-neutral-500">|</span>
          <span className="text-neutral-300">
            GPU: <span className={healthStatus.gpuEnabled ? 'text-emerald-400' : 'text-neutral-500'}>{healthStatus.gpuEnabled ? 'Enabled' : 'Disabled (CPU)'}</span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">YOLO Detection Confidence</label>
          <input
            type="number"
            min={0.1}
            max={1.0}
            step={0.05}
            value={settings.detectionConfidence}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, detectionConfidence: parseFloat(e.target.value) || 0.5 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Face Recognition Confidence</label>
          <input
            type="number"
            min={0.1}
            max={1.0}
            step={0.05}
            value={settings.faceConfidence}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, faceConfidence: parseFloat(e.target.value) || 0.6 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Re-ID Threshold</label>
          <input
            type="number"
            min={0.1}
            max={1.0}
            step={0.05}
            value={settings.reidThreshold}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, reidThreshold: parseFloat(e.target.value) || 0.7 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Max Concurrent Inference</label>
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={settings.maxConcurrentInference}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, maxConcurrentInference: parseInt(e.target.value) || 4 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Inference Device</label>
          <select
            value={settings.inferenceDevice}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, inferenceDevice: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          >
            <option value="cuda">CUDA (GPU)</option>
            <option value="cpu">CPU</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={settings.reidEnabled}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, reidEnabled: e.target.checked })}
            className="rounded border-neutral-600"
          />
          Enable Cross-Camera Re-ID
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={settings.gaitEnabled}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, gaitEnabled: e.target.checked })}
            className="rounded border-neutral-600"
          />
          Enable Gait Recognition
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={settings.livenessEnabled}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, livenessEnabled: e.target.checked })}
            className="rounded border-neutral-600"
          />
          Enable Liveness Detection
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          data-settings-save="ai"
          className="flex items-center gap-1.5 rounded bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {statusMessage && (
          <span className={`text-xs ${statusMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
            {statusMessage.text}
          </span>
        )}
      </div>
    </div>
  );
}
