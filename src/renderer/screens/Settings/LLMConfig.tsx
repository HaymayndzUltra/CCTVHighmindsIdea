import { useState, useEffect, useCallback } from 'react';
import { Brain, Save, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';

interface LLMSettings {
  ollamaEndpoint: string;
  model: string;
  summaryEnabled: boolean;
  summaryScheduleCron: string;
  maxTokens: number;
  temperature: number;
}

const DEFAULT_SETTINGS: LLMSettings = {
  ollamaEndpoint: 'http://127.0.0.1:11434',
  model: 'llama3',
  summaryEnabled: true,
  summaryScheduleCron: '0 0 * * *',
  maxTokens: 2048,
  temperature: 0.7,
};

const TAB_ID = 'llm';

export default function LLMConfig() {
  const { draftSettings, loadSettings, updateDraftBulk, initDraftBulk, saveDraft, markClean } = useSettings();
  const settings = (draftSettings[TAB_ID] as LLMSettings) || DEFAULT_SETTINGS;
  
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ status: string; modelLoaded: boolean; modelName: string; lastError: string | null } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const fetchOllamaStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.llm?.status) {
        const result = await window.electronAPI.llm.status();
        setOllamaStatus(result);
      }
    } catch {
      setOllamaStatus({ status: 'error', modelLoaded: false, modelName: '', lastError: 'Failed to check status' });
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      const loaded = await loadSettings(TAB_ID, [
        'ollama.endpoint',
        'ollama.model',
        'ollama.summaryEnabled',
        'ollama.summaryScheduleCron',
        'ollama.maxTokens',
        'ollama.temperature',
      ]);

      const mapped: LLMSettings = {
        ollamaEndpoint: String(loaded['ollama.endpoint'] || DEFAULT_SETTINGS.ollamaEndpoint),
        model: String(loaded['ollama.model'] || DEFAULT_SETTINGS.model),
        summaryEnabled: String(loaded['ollama.summaryEnabled']) === 'true',
        summaryScheduleCron: String(loaded['ollama.summaryScheduleCron'] || DEFAULT_SETTINGS.summaryScheduleCron),
        maxTokens: Number(loaded['ollama.maxTokens'] || DEFAULT_SETTINGS.maxTokens),
        temperature: Number(loaded['ollama.temperature'] || DEFAULT_SETTINGS.temperature),
      };

      initDraftBulk(TAB_ID, mapped);
      await fetchOllamaStatus();
    };

    loadData();
  }, [loadSettings, initDraftBulk, fetchOllamaStatus]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      await saveDraft(TAB_ID, async () => {
        if (window.electronAPI?.settings?.set) {
          await window.electronAPI.settings.set('ollama.endpoint', settings.ollamaEndpoint);
          await window.electronAPI.settings.set('ollama.model', settings.model);
          await window.electronAPI.settings.set('ollama.summaryEnabled', String(settings.summaryEnabled));
          await window.electronAPI.settings.set('ollama.summaryScheduleCron', settings.summaryScheduleCron);
          await window.electronAPI.settings.set('ollama.maxTokens', String(settings.maxTokens));
          await window.electronAPI.settings.set('ollama.temperature', String(settings.temperature));
        }
      });
      setStatusMessage({ type: 'success', text: 'LLM settings saved.' });
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
        <Brain size={18} className="text-indigo-400" />
        <h2 className="text-lg font-medium text-neutral-100">LLM / Ollama Configuration</h2>
      </div>

      {ollamaStatus && (
        <div className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-800/50 px-3 py-2 text-xs">
          {ollamaStatus.status === 'running' ? (
            <Wifi size={14} className="text-emerald-400" />
          ) : (
            <WifiOff size={14} className="text-red-400" />
          )}
          <span className="text-neutral-300">
            Status: <span className={ollamaStatus.status === 'running' ? 'text-emerald-400' : 'text-red-400'}>{ollamaStatus.status === 'running' ? 'Running' : ollamaStatus.status}</span>
          </span>
          {ollamaStatus.modelLoaded && (
            <>
              <span className="text-neutral-500">|</span>
              <span className="text-neutral-300">Model: <span className="text-emerald-400">{ollamaStatus.modelName}</span></span>
            </>
          )}
          {ollamaStatus.lastError && (
            <span className="text-red-400">{ollamaStatus.lastError}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-neutral-400">Ollama Endpoint</label>
          <input
            type="text"
            value={settings.ollamaEndpoint}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, ollamaEndpoint: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="http://127.0.0.1:11434"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Model</label>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, model: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="llama3"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Summary Schedule (cron)</label>
          <input
            type="text"
            value={settings.summaryScheduleCron}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, summaryScheduleCron: e.target.value })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="0 0 * * *"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Max Tokens</label>
          <input
            type="number"
            min={256}
            max={8192}
            step={256}
            value={settings.maxTokens}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, maxTokens: parseInt(e.target.value) || 2048 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Temperature</label>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, temperature: parseFloat(e.target.value) || 0.7 })}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={settings.summaryEnabled}
          onChange={(e) => updateDraftBulk(TAB_ID, { ...settings, summaryEnabled: e.target.checked })}
          className="rounded border-neutral-600"
        />
        Enable daily event summaries via Ollama
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          data-settings-save="llm"
          className="flex items-center gap-1.5 rounded bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={async () => {
            setIsTesting(true);
            await fetchOllamaStatus();
            setIsTesting(false);
          }}
          disabled={isTesting}
          className="flex items-center gap-1.5 rounded border border-neutral-600 px-4 py-1.5 text-sm font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
          {isTesting ? 'Testing...' : 'Test Connection'}
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
