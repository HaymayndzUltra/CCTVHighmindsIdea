import { useState, useEffect, useCallback } from 'react';
import { Save, Send, Loader2, MessageSquare, Eye, EyeOff } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

const TAB_ID = 'telegram';

interface TelegramSettings {
  botToken: string;
  chatId: string;
  isEnabled: boolean;
}

const DEFAULT_SETTINGS: TelegramSettings = {
  botToken: '',
  chatId: '',
  isEnabled: false,
};

export default function TelegramConfig() {
  const { draftSettings, initDraftBulk, updateDraft, saveDraft } = useSettings();
  const settings = (draftSettings[TAB_ID] as TelegramSettings) || DEFAULT_SETTINGS;

  const [showToken, setShowToken] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadTabSettings = useCallback(async () => {
    try {
      if (!window.electronAPI?.settings?.get) return;

      const [tokenRes, chatIdRes, enabledRes] = await Promise.all([
        window.electronAPI.settings.get('telegram_bot_token'),
        window.electronAPI.settings.get('telegram_chat_id'),
        window.electronAPI.settings.get('telegram_enabled'),
      ]);

      initDraftBulk(TAB_ID, {
        botToken: String(tokenRes || ''),
        chatId: String(chatIdRes || ''),
        isEnabled: String(enabledRes) === 'true',
      });
    } catch (error) {
      console.error('[TelegramConfig] Failed to load settings:', error);
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
          window.electronAPI.settings.set('telegram_bot_token', settings.botToken),
          window.electronAPI.settings.set('telegram_chat_id', settings.chatId),
          window.electronAPI.settings.set('telegram_enabled', String(settings.isEnabled)),
        ]);
      });
      setStatusMessage({ type: 'success', text: 'Settings saved. Telegram service reinitialized.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[TelegramConfig] Save failed:', message);
      setStatusMessage({ type: 'error', text: `Save failed: ${message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!settings.botToken || !settings.chatId) {
      setTestResult({ type: 'error', text: 'Bot Token and Chat ID are required to send a test.' });
      return;
    }

    if (!window.electronAPI?.telegram?.test) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await window.electronAPI.telegram.test(settings.botToken, settings.chatId);
      if (result.success) {
        setTestResult({ type: 'success', text: result.message });
      } else {
        setTestResult({ type: 'error', text: result.message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[TelegramConfig] Test failed:', message);
      setTestResult({ type: 'error', text: `Test failed: ${message}` });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading Telegram settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare size={18} className="text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-200">Telegram Notifications</h3>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-200">Enable Telegram Alerts</p>
            <p className="text-xs text-neutral-500">
              Send alerts to Telegram when unknown persons are detected
            </p>
          </div>
          <button
            onClick={() => updateDraft(TAB_ID, 'isEnabled', !settings.isEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.isEnabled ? 'bg-primary-600' : 'bg-neutral-700'
            }`}
            role="switch"
            aria-checked={settings.isEnabled}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs text-neutral-500">Bot Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={settings.botToken}
              onChange={(e) => updateDraft(TAB_ID, 'botToken', e.target.value)}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              className="w-full rounded bg-neutral-800 px-2.5 py-1.5 pr-9 text-sm font-mono text-neutral-200 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-primary-500"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-neutral-500">Chat ID</label>
          <input
            type="text"
            value={settings.chatId}
            onChange={(e) => updateDraft(TAB_ID, 'chatId', e.target.value)}
            placeholder="-1001234567890"
            className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm font-mono text-neutral-200 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {testResult && (
          <div
            className={`rounded px-3 py-2 text-xs ${
              testResult.type === 'success'
                ? 'bg-emerald-900/30 text-emerald-400'
                : 'bg-red-900/30 text-red-400'
            }`}
          >
            {testResult.text}
          </div>
        )}

        {statusMessage && (
          <div
            className={`rounded px-3 py-2 text-xs ${
              statusMessage.type === 'success'
                ? 'bg-emerald-900/30 text-emerald-400'
                : 'bg-red-900/30 text-red-400'
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleTest}
            disabled={isTesting || !settings.botToken || !settings.chatId}
            className="flex items-center gap-1.5 rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isTesting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Send size={12} />
            )}
            Send Test Notification
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            data-settings-save="telegram"
            className="flex items-center gap-1.5 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
