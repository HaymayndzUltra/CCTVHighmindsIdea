import { useState, useEffect, useCallback } from 'react';
import { Save, Trash2, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

const RETENTION_OPTIONS = [
  { label: '30 days', value: '30' },
  { label: '60 days', value: '60' },
  { label: '90 days', value: '90' },
  { label: '180 days', value: '180' },
  { label: 'Unlimited', value: '0' },
];

const TAB_ID = 'privacy';

interface RetentionSettings {
  retentionDays: string;
  autoPurgeEnabled: boolean;
}

const DEFAULT_SETTINGS: RetentionSettings = {
  retentionDays: '90',
  autoPurgeEnabled: true,
};

export default function RetentionConfig() {
  const { draftSettings, initDraftBulk, updateDraft, saveDraft } = useSettings();
  const settings = (draftSettings[TAB_ID] as RetentionSettings) || DEFAULT_SETTINGS;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPurgingFaces, setIsPurgingFaces] = useState(false);
  const [isPurgingEvents, setIsPurgingEvents] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  const loadTabSettings = useCallback(async () => {
    try {
      if (!window.electronAPI?.settings?.get) return;

      const [retRes, purgeRes] = await Promise.all([
        window.electronAPI.settings.get('retention_days'),
        window.electronAPI.settings.get('auto_purge_enabled'),
      ]);

      initDraftBulk(TAB_ID, {
        retentionDays: String(retRes || DEFAULT_SETTINGS.retentionDays),
        autoPurgeEnabled: String(purgeRes) === 'true',
      });
    } catch (error) {
      console.error('[RetentionConfig] Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [initDraftBulk]);

  useEffect(() => {
    loadTabSettings();
  }, [loadTabSettings]);

  const handleSave = async () => {
    if (!window.electronAPI?.settings?.set) return;

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await saveDraft(TAB_ID, async () => {
        await Promise.all([
          window.electronAPI.settings.set('retention_days', settings.retentionDays),
          window.electronAPI.settings.set('auto_purge_enabled', String(settings.autoPurgeEnabled)),
        ]);
      });
      setStatusMessage({ type: 'success', text: 'Retention settings saved.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RetentionConfig] Save failed:', message);
      setStatusMessage({ type: 'error', text: `Save failed: ${message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePurgeAllFaces = async () => {
    if (purgeConfirmText !== 'DELETE') return;
    if (!window.electronAPI?.privacy?.purgeAllFaces) return;

    setIsPurgingFaces(true);
    setStatusMessage(null);

    try {
      const result = await window.electronAPI.privacy.purgeAllFaces();
      if (result.success) {
        setStatusMessage({ type: 'success', text: 'All face data has been permanently deleted.' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RetentionConfig] Purge faces failed:', message);
      setStatusMessage({ type: 'error', text: `Purge failed: ${message}` });
    } finally {
      setIsPurgingFaces(false);
      setShowPurgeConfirm(false);
      setPurgeConfirmText('');
    }
  };

  const handlePurgeOldEvents = async () => {
    if (!window.electronAPI?.privacy?.purgeOldEvents) return;

    setIsPurgingEvents(true);
    setStatusMessage(null);

    try {
      const result = await window.electronAPI.privacy.purgeOldEvents();
      setStatusMessage({
        type: 'success',
        text: `Purged ${result.deletedCount} event${result.deletedCount !== 1 ? 's' : ''} older than ${settings.retentionDays} days.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RetentionConfig] Purge events failed:', message);
      setStatusMessage({ type: 'error', text: `Purge failed: ${message}` });
    } finally {
      setIsPurgingEvents(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading retention settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock size={18} className="text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-200">Data Retention & Privacy</h3>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 space-y-4">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Retention Period</label>
          <select
            value={settings.retentionDays}
            onChange={(e) => updateDraft(TAB_ID, 'retentionDays', e.target.value)}
            className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:ring-1 focus:ring-primary-500"
          >
            {RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-200">Auto-Purge Old Events</p>
            <p className="text-xs text-neutral-500">
              Automatically delete events and snapshots older than retention period
            </p>
          </div>
          <button
            onClick={() => updateDraft(TAB_ID, 'autoPurgeEnabled', !settings.autoPurgeEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.autoPurgeEnabled ? 'bg-primary-600' : 'bg-neutral-700'
            }`}
            role="switch"
            aria-checked={settings.autoPurgeEnabled}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.autoPurgeEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
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
            disabled={isSaving}
            data-settings-save="privacy"
            className="flex items-center gap-1.5 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>

        <div className="border-t border-neutral-800" />

        <div className="space-y-3">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Manual Actions</p>

          <button
            onClick={handlePurgeOldEvents}
            disabled={isPurgingEvents || settings.retentionDays === '0'}
            className="flex w-full items-center gap-2 rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPurgingEvents ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Purge Events Older Than {settings.retentionDays === '0' ? '(set retention first)' : `${settings.retentionDays} Days`}
          </button>

          {!showPurgeConfirm ? (
            <button
              onClick={() => setShowPurgeConfirm(true)}
              disabled={isPurgingFaces}
              className="flex w-full items-center gap-2 rounded border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-950/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AlertTriangle size={14} />
              Purge All Face Data
            </button>
          ) : (
            <div className="rounded border border-red-800/50 bg-red-950/30 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-xs text-red-300">
                  This will permanently delete <strong>ALL</strong> enrolled persons and their face data.
                  Type <strong>DELETE</strong> to confirm.
                </p>
              </div>
              <input
                type="text"
                value={purgeConfirmText}
                onChange={(e) => setPurgeConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm text-red-300 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-red-500"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowPurgeConfirm(false);
                    setPurgeConfirmText('');
                  }}
                  className="rounded px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePurgeAllFaces}
                  disabled={purgeConfirmText !== 'DELETE' || isPurgingFaces}
                  className="flex items-center gap-1 rounded bg-red-700 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPurgingFaces ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Confirm Delete All
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
