import { useState, useEffect, useCallback } from 'react';
import { Shield, Save, Loader2 } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

interface ZoneDefaultSettings {
  defaultAlertEnabled: boolean;
  loiterThresholdSec: number;
  loiterCooldownSec: number;
  loiterMovementRadius: number;
  restrictedZoneColor: string;
  monitoredZoneColor: string;
  countingZoneColor: string;
  tripwireColor: string;
}

const DEFAULT_SETTINGS: ZoneDefaultSettings = {
  defaultAlertEnabled: true,
  loiterThresholdSec: 15,
  loiterCooldownSec: 180,
  loiterMovementRadius: 80,
  restrictedZoneColor: '#EF4444',
  monitoredZoneColor: '#3B82F6',
  countingZoneColor: '#22C55E',
  tripwireColor: '#F59E0B',
};

const TAB_ID = 'zones';

export default function ZoneDefaults() {
  const { draftSettings, updateDraftBulk, initDraftBulk, saveDraft } = useSettings();
  const settings = (draftSettings[TAB_ID] as ZoneDefaultSettings) || DEFAULT_SETTINGS;

  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.settings?.get) return;
    Promise.all([
      window.electronAPI.settings.get('zone_default_loiter_sec'),
      window.electronAPI.settings.get('zone_default_cooldown_sec'),
      window.electronAPI.settings.get('zone_default_movement_radius'),
      window.electronAPI.settings.get('zone_default_alert_enabled'),
      window.electronAPI.settings.get('zone_color_restricted'),
      window.electronAPI.settings.get('zone_color_monitored'),
      window.electronAPI.settings.get('zone_color_counting'),
      window.electronAPI.settings.get('zone_color_tripwire'),
    ]).then(([loiter, cooldown, radius, alert, cRestricted, cMonitored, cCounting, cTripwire]) => {
      const next = {
        ...DEFAULT_SETTINGS,
        ...(loiter != null && { loiterThresholdSec: Number(loiter) }),
        ...(cooldown != null && { loiterCooldownSec: Number(cooldown) }),
        ...(radius != null && { loiterMovementRadius: Number(radius) }),
        ...(alert != null && { defaultAlertEnabled: String(alert) !== 'false' }),
        ...(cRestricted != null && { restrictedZoneColor: String(cRestricted) }),
        ...(cMonitored != null && { monitoredZoneColor: String(cMonitored) }),
        ...(cCounting != null && { countingZoneColor: String(cCounting) }),
        ...(cTripwire != null && { tripwireColor: String(cTripwire) }),
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
          await window.electronAPI.settings.set('zone_default_loiter_sec', String(settings.loiterThresholdSec));
          await window.electronAPI.settings.set('zone_default_cooldown_sec', String(settings.loiterCooldownSec));
          await window.electronAPI.settings.set('zone_default_movement_radius', String(settings.loiterMovementRadius));
          await window.electronAPI.settings.set('zone_default_alert_enabled', String(settings.defaultAlertEnabled));
          await window.electronAPI.settings.set('zone_color_restricted', settings.restrictedZoneColor);
          await window.electronAPI.settings.set('zone_color_monitored', settings.monitoredZoneColor);
          await window.electronAPI.settings.set('zone_color_counting', settings.countingZoneColor);
          await window.electronAPI.settings.set('zone_color_tripwire', settings.tripwireColor);
        }
      });
      setStatusMessage({ type: 'success', text: 'Zone defaults saved.' });
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
        <Shield size={18} className="text-amber-400" />
        <h2 className="text-lg font-medium text-neutral-100">Zone Defaults</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Loiter Threshold (sec)</label>
          <input
            type="number"
            min={5}
            max={300}
            step={5}
            value={settings.loiterThresholdSec}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, loiterThresholdSec: parseInt(e.target.value) || 15 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Loiter Cooldown (sec)</label>
          <input
            type="number"
            min={30}
            max={3600}
            step={30}
            value={settings.loiterCooldownSec}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, loiterCooldownSec: parseInt(e.target.value) || 180 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Loiter Movement Radius (px)</label>
          <input
            type="number"
            min={20}
            max={500}
            step={10}
            value={settings.loiterMovementRadius}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, loiterMovementRadius: parseInt(e.target.value) || 80 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-neutral-300">Zone Colors</h3>
        <div className="grid grid-cols-4 gap-3">
          {[
            { key: 'restrictedZoneColor' as const, label: 'Restricted' },
            { key: 'monitoredZoneColor' as const, label: 'Monitored' },
            { key: 'countingZoneColor' as const, label: 'Counting' },
            { key: 'tripwireColor' as const, label: 'Tripwire' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                value={settings[key]}
                onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, [key]: e.target.value })}
                className="h-8 w-8 cursor-pointer rounded border border-neutral-700"
              />
              <span className="text-xs text-neutral-400">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={settings.defaultAlertEnabled}
          onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, defaultAlertEnabled: e.target.checked })}
          className="rounded border-neutral-600"
        />
        Enable alerts by default for new zones
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          data-settings-save="zones"
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
