import { useState, useEffect, useCallback } from 'react';
import { Volume2, Save, Loader2 } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

interface SoundSettings {
  enabled: boolean;
  confidenceThreshold: number;
  glassBreakEnabled: boolean;
  gunshotEnabled: boolean;
  screamEnabled: boolean;
  dogBarkEnabled: boolean;
  hornEnabled: boolean;
  alertOnDetection: boolean;
  cooldownSec: number;
}

const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  confidenceThreshold: 0.3,
  glassBreakEnabled: true,
  gunshotEnabled: true,
  screamEnabled: true,
  dogBarkEnabled: true,
  hornEnabled: false,
  alertOnDetection: true,
  cooldownSec: 30,
};

const SOUND_CLASSES = [
  { key: 'glassBreakEnabled' as const, label: 'Glass Break', severity: 'critical' },
  { key: 'gunshotEnabled' as const, label: 'Gunshot', severity: 'critical' },
  { key: 'screamEnabled' as const, label: 'Scream', severity: 'critical' },
  { key: 'dogBarkEnabled' as const, label: 'Dog Bark', severity: 'medium' },
  { key: 'hornEnabled' as const, label: 'Horn/Honking', severity: 'low' },
];

const TAB_ID = 'sound';

export default function SoundDetectionConfig() {
  const { draftSettings, updateDraftBulk, initDraftBulk, saveDraft } = useSettings();
  const settings = (draftSettings[TAB_ID] as SoundSettings) || DEFAULT_SETTINGS;

  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      migrateKey('sound.enabled', 'sound_detection_enabled'),
      migrateKey('sound.confidenceThreshold', 'sound_confidence_threshold'),
    ]).then(() => Promise.all([
      window.electronAPI.settings.get('sound_detection_enabled'),
      window.electronAPI.settings.get('sound_confidence_threshold'),
      window.electronAPI.settings.get('sound_events'),
      window.electronAPI.settings.get('sound_cooldown_sec'),
      window.electronAPI.settings.get('sound_alert_on_detection'),
    ])).then(([enabled, threshold, events, cooldown, alertOn]) => {
      const next = { ...DEFAULT_SETTINGS };
      if (enabled != null) next.enabled = String(enabled) !== 'false';
      if (threshold != null) next.confidenceThreshold = parseFloat(String(threshold)) || 0.3;
      if (cooldown != null) next.cooldownSec = parseInt(String(cooldown), 10) || 30;
      if (alertOn != null) next.alertOnDetection = String(alertOn) !== 'false';
      if (events != null) {
        const activeClasses = String(events).split(',').map((c) => c.trim()).filter(Boolean);
        next.glassBreakEnabled = activeClasses.includes('glass_break');
        next.gunshotEnabled = activeClasses.includes('gunshot');
        next.screamEnabled = activeClasses.includes('scream');
        next.dogBarkEnabled = activeClasses.includes('dog_bark');
        next.hornEnabled = activeClasses.includes('horn');
      }
      initDraftBulk(TAB_ID, next);
    }).catch(() => {});
  }, [initDraftBulk]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      await saveDraft(TAB_ID, async () => {
        if (window.electronAPI?.settings?.set) {
          await window.electronAPI.settings.set('sound_detection_enabled', String(settings.enabled));
          await window.electronAPI.settings.set('sound_confidence_threshold', String(settings.confidenceThreshold));
          const enabledClasses: string[] = [];
          if (settings.glassBreakEnabled) enabledClasses.push('glass_break');
          if (settings.gunshotEnabled) enabledClasses.push('gunshot');
          if (settings.screamEnabled) enabledClasses.push('scream');
          if (settings.dogBarkEnabled) enabledClasses.push('dog_bark');
          if (settings.hornEnabled) enabledClasses.push('horn');
          await window.electronAPI.settings.set('sound_events', enabledClasses.join(','));
          await window.electronAPI.settings.set('sound_cooldown_sec', String(settings.cooldownSec));
          await window.electronAPI.settings.set('sound_alert_on_detection', String(settings.alertOnDetection));
        }
      });
      setStatusMessage({ type: 'success', text: 'Sound detection settings saved.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: `Save failed: ${msg}` });
    } finally {
      setIsSaving(false);
    }
  }, [saveDraft, settings]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Volume2 size={18} className="text-cyan-400" />
        <h2 className="text-lg font-medium text-neutral-100">Sound Detection</h2>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, enabled: e.target.checked })}
          className="rounded border-neutral-600"
        />
        Enable sound detection (YAMNet)
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Confidence Threshold</label>
          <input
            type="number"
            min={0.1}
            max={0.9}
            step={0.05}
            value={settings.confidenceThreshold}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, confidenceThreshold: parseFloat(e.target.value) || 0.3 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Cooldown Between Alerts (sec)</label>
          <input
            type="number"
            min={5}
            max={300}
            step={5}
            value={settings.cooldownSec}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, cooldownSec: parseInt(e.target.value) || 30 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-neutral-300">Sound Classes</h3>
        <div className="space-y-2">
          {SOUND_CLASSES.map(({ key, label, severity }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, [key]: e.target.checked })}
                className="rounded border-neutral-600"
              />
              {label}
              <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${
                severity === 'critical' ? 'bg-red-950 text-red-400' :
                severity === 'medium' ? 'bg-yellow-950 text-yellow-400' :
                'bg-neutral-800 text-neutral-500'
              }`}>
                {severity}
              </span>
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={settings.alertOnDetection}
          onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, alertOnDetection: e.target.checked })}
          className="rounded border-neutral-600"
        />
        Send Telegram alert on sound detection
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          data-settings-save="sound"
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
