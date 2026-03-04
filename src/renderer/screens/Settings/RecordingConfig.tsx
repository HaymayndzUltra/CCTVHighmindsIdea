import { useState, useEffect, useCallback } from 'react';
import { HardDrive, Save, Loader2 } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

interface RecordingSettings {
  defaultMode: 'off' | 'continuous' | 'event_triggered';
  segmentDurationSec: number;
  retentionDays: number;
  storagePath: string;
  preRecordSec: number;
  postRecordSec: number;
  maxStorageGb: number;
  outputFormat: 'mp4' | 'mkv';
}

const DEFAULT_SETTINGS: RecordingSettings = {
  defaultMode: 'event_triggered',
  segmentDurationSec: 900,
  retentionDays: 30,
  storagePath: '',
  preRecordSec: 5,
  postRecordSec: 10,
  maxStorageGb: 100,
  outputFormat: 'mp4',
};

const TAB_ID = 'recording';

export default function RecordingConfig() {
  const { draftSettings, updateDraftBulk, initDraftBulk, saveDraft } = useSettings();
  const settings = (draftSettings[TAB_ID] as RecordingSettings) || DEFAULT_SETTINGS;
  
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.settings?.get) return;

    const migrateKey = async (oldKey: string, newKey: string, transform?: (v: string) => string) => {
      try {
        const newVal = await window.electronAPI.settings.get(newKey);
        if (newVal != null) return;
        const oldVal = await window.electronAPI.settings.get(oldKey);
        if (oldVal != null) {
          const migrated = transform ? transform(String(oldVal)) : String(oldVal);
          await window.electronAPI.settings.set(newKey, migrated);
        }
      } catch { /* ignore migration errors */ }
    };

    Promise.all([
      migrateKey('recording.defaultMode', 'recording_mode'),
      migrateKey('recording.segmentDurationSec', 'recording_segment_duration_min', (v) => String(Math.round(Number(v) / 60))),
    ]).then(() => Promise.all([
      window.electronAPI.settings.get('recording_mode'),
      window.electronAPI.settings.get('recording_segment_duration_min'),
      window.electronAPI.settings.get('recording_retention_days'),
      window.electronAPI.settings.get('recording_storage_path'),
      window.electronAPI.settings.get('recording_pre_record_sec'),
      window.electronAPI.settings.get('recording_post_record_sec'),
      window.electronAPI.settings.get('recording_max_storage_gb'),
      window.electronAPI.settings.get('recording_output_format'),
    ])).then(([mode, segMin, retDays, storagePath, pre, post, maxGb, fmt]) => {
      const next = {
        ...DEFAULT_SETTINGS,
        ...(mode != null && { defaultMode: String(mode) as RecordingSettings['defaultMode'] }),
        ...(segMin != null && { segmentDurationSec: Number(segMin) * 60 }),
        ...(retDays != null && { retentionDays: Number(retDays) }),
        ...(storagePath != null && { storagePath: String(storagePath) }),
        ...(pre != null && { preRecordSec: Number(pre) }),
        ...(post != null && { postRecordSec: Number(post) }),
        ...(maxGb != null && { maxStorageGb: Number(maxGb) }),
        ...(fmt != null && { outputFormat: String(fmt) as RecordingSettings['outputFormat'] }),
      };
      initDraftBulk(TAB_ID, next);
    }).catch(() => {});
  }, [initDraftBulk]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      await saveDraft(TAB_ID, async () => {
        if (window.electronAPI?.settings?.set) {
          await window.electronAPI.settings.set('recording_mode', settings.defaultMode);
          await window.electronAPI.settings.set('recording_segment_duration_min', String(Math.round(settings.segmentDurationSec / 60)));
          await window.electronAPI.settings.set('recording_retention_days', String(settings.retentionDays));
          await window.electronAPI.settings.set('recording_storage_path', settings.storagePath);
          await window.electronAPI.settings.set('recording_pre_record_sec', String(settings.preRecordSec));
          await window.electronAPI.settings.set('recording_post_record_sec', String(settings.postRecordSec));
          await window.electronAPI.settings.set('recording_max_storage_gb', String(settings.maxStorageGb));
          await window.electronAPI.settings.set('recording_output_format', settings.outputFormat);
        }
      });
      setStatusMessage({ type: 'success', text: 'Recording settings saved.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: `Save failed: ${msg}` });
    } finally {
      setIsSaving(false);
    }
  }, [settings, saveDraft]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <HardDrive size={18} className="text-blue-400" />
        <h2 className="text-lg font-medium text-neutral-100">Recording Configuration</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Default Recording Mode</label>
          <select
            value={settings.defaultMode}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, defaultMode: e.target.value as RecordingSettings['defaultMode'] })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          >
            <option value="off">Off</option>
            <option value="continuous">Continuous</option>
            <option value="event_triggered">Event-Triggered</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Segment Duration (sec)</label>
          <input
            type="number"
            min={60}
            max={3600}
            step={60}
            value={settings.segmentDurationSec}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, segmentDurationSec: parseInt(e.target.value) || 300 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Retention (days)</label>
          <input
            type="number"
            min={1}
            max={365}
            step={1}
            value={settings.retentionDays}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, retentionDays: parseInt(e.target.value) || 30 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Pre-Record Buffer (sec) <span className="text-neutral-600">(planned)</span></label>
          <input
            type="number"
            min={0}
            max={30}
            step={1}
            value={settings.preRecordSec}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, preRecordSec: parseInt(e.target.value) || 5 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Post-Record Buffer (sec) <span className="text-neutral-600">(planned)</span></label>
          <input
            type="number"
            min={0}
            max={60}
            step={1}
            value={settings.postRecordSec}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, postRecordSec: parseInt(e.target.value) || 10 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Max Storage (GB) <span className="text-neutral-600">(planned)</span></label>
          <input
            type="number"
            min={10}
            max={10000}
            step={10}
            value={settings.maxStorageGb}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, maxStorageGb: parseInt(e.target.value) || 100 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Output Format <span className="text-neutral-600">(planned)</span></label>
          <select
            value={settings.outputFormat}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, outputFormat: e.target.value as RecordingSettings['outputFormat'] })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          >
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          data-settings-save="recording"
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
