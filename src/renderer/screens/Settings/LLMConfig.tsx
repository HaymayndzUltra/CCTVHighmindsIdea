import { useState, useEffect, useCallback } from 'react';
import { Brain, Save, Loader2, Wifi, WifiOff, CircleHelp } from 'lucide-react';

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

export default function LLMConfig() {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [errors, setErrors] = useState<Partial<Record<keyof LLMSettings, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ status: string; modelLoaded: boolean; modelName: string; lastError: string | null } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const readSetting = useCallback((result: unknown): string => {
    if (typeof result === 'object' && result !== null && 'value' in result) {
      const value = (result as { value: unknown }).value;
      if (typeof value === 'string') return value;
      if (value == null) return '';
      return String(value);
    }
    if (typeof result === 'string') return result;
    if (result == null) return '';
    return String(result);
  }, []);

  const validate = useCallback((value: LLMSettings) => {
    const nextErrors: Partial<Record<keyof LLMSettings, string>> = {};
    try {
      // eslint-disable-next-line no-new
      new URL(value.ollamaEndpoint);
    } catch {
      nextErrors.ollamaEndpoint = 'Please enter a valid URL (example: http://localhost:11434).';
    }

    if (!value.model.trim()) {
      nextErrors.model = 'Model name is required (example: llama3.2).';
    }

    const cronParts = value.summaryScheduleCron.trim().split(/\s+/);
    if (cronParts.length !== 5) {
      nextErrors.summaryScheduleCron = 'Cron must have exactly 5 fields (minute hour day month weekday).';
    }

    if (value.maxTokens < 256 || value.maxTokens > 8192) {
      nextErrors.maxTokens = 'Max tokens must be between 256 and 8192.';
    }

    if (value.temperature < 0 || value.temperature > 1) {
      nextErrors.temperature = 'Temperature must be between 0.0 and 1.0.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, []);

  const fetchOllamaStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.llm?.status) {
        const result = await window.electronAPI.llm.status();
        setOllamaStatus(result);
        return result;
      }
    } catch {
      const fallback = { status: 'error', modelLoaded: false, modelName: '', lastError: 'Failed to check status' };
      setOllamaStatus(fallback);
      return fallback;
    }

    const unavailable = { status: 'error', modelLoaded: false, modelName: '', lastError: 'LLM IPC not available' };
    setOllamaStatus(unavailable);
    return unavailable;
  }, []);

  useEffect(() => {
    if (window.electronAPI?.settings?.get) {
      Promise.all([
        window.electronAPI.settings.get('ollama.endpoint'),
        window.electronAPI.settings.get('ollama.model'),
        window.electronAPI.settings.get('ollama.summaryEnabled'),
        window.electronAPI.settings.get('ollama.summaryScheduleCron'),
        window.electronAPI.settings.get('ollama.maxTokens'),
        window.electronAPI.settings.get('ollama.temperature'),
      ]).then(([endpoint, model, enabled, cron, tokens, temp]) => {
        const loadedSettings: LLMSettings = {
          ollamaEndpoint: readSetting(endpoint) || DEFAULT_SETTINGS.ollamaEndpoint,
          model: readSetting(model) || DEFAULT_SETTINGS.model,
          summaryEnabled: readSetting(enabled) ? readSetting(enabled) === 'true' : DEFAULT_SETTINGS.summaryEnabled,
          summaryScheduleCron: readSetting(cron) || DEFAULT_SETTINGS.summaryScheduleCron,
          maxTokens: Number(readSetting(tokens)) || DEFAULT_SETTINGS.maxTokens,
          temperature: Number(readSetting(temp)) || DEFAULT_SETTINGS.temperature,
        };
        setSettings(loadedSettings);
        setSavedSettings(loadedSettings);
      }).catch(() => {});
    }
    fetchOllamaStatus();
  }, [fetchOllamaStatus, readSetting]);

  useEffect(() => {
    validate(settings);
  }, [settings, validate]);

  const handleSave = useCallback(async () => {
    if (!validate(settings)) {
      setStatusMessage({ type: 'error', text: 'Please resolve validation errors before saving.' });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    try {
      if (window.electronAPI?.settings?.set) {
        await window.electronAPI.settings.set('ollama.endpoint', settings.ollamaEndpoint);
        await window.electronAPI.settings.set('ollama.model', settings.model);
        await window.electronAPI.settings.set('ollama.summaryEnabled', String(settings.summaryEnabled));
        await window.electronAPI.settings.set('ollama.summaryScheduleCron', settings.summaryScheduleCron);
        await window.electronAPI.settings.set('ollama.maxTokens', String(settings.maxTokens));
        await window.electronAPI.settings.set('ollama.temperature', String(settings.temperature));
      }
      setSavedSettings(settings);
      setStatusMessage({ type: 'success', text: 'LLM settings saved.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: `Save failed: ${msg}` });
    } finally {
      setIsSaving(false);
    }
  }, [settings, validate]);

  const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);

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
          <p className="mb-1 text-[11px] text-neutral-500">API URL (e.g., http://localhost:11434)</p>
          <input
            type="text"
            value={settings.ollamaEndpoint}
            onChange={(e) => setSettings((s) => ({ ...s, ollamaEndpoint: e.target.value }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="http://localhost:11434"
          />
          {errors.ollamaEndpoint && <p className="mt-1 text-xs text-red-400">{errors.ollamaEndpoint}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Model</label>
          <p className="mb-1 text-[11px] text-neutral-500">Model name (e.g., llama3.2, mistral)</p>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="llama3.2"
          />
          {errors.model && <p className="mt-1 text-xs text-red-400">{errors.model}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Summary Schedule (cron)</label>
          <p className="mb-1 text-[11px] text-neutral-500">
            Cron expression (e.g., 0 8 * * * for daily 8 AM).{' '}
            <a
              href="https://crontab.guru/#0_8_*_*_*"
              target="_blank"
              rel="noreferrer"
              className="text-primary-400 underline"
            >
              Cron syntax helper
            </a>
          </p>
          <input
            type="text"
            value={settings.summaryScheduleCron}
            onChange={(e) => setSettings((s) => ({ ...s, summaryScheduleCron: e.target.value }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="0 8 * * *"
          />
          {errors.summaryScheduleCron && <p className="mt-1 text-xs text-red-400">{errors.summaryScheduleCron}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Max Tokens</label>
          <p className="mb-1 text-[11px] text-neutral-500">Maximum response length (default: 2048)</p>
          <input
            type="number"
            min={256}
            max={8192}
            step={256}
            value={settings.maxTokens}
            onChange={(e) => setSettings((s) => ({ ...s, maxTokens: parseInt(e.target.value) || 2048 }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="2048"
          />
          {errors.maxTokens && <p className="mt-1 text-xs text-red-400">{errors.maxTokens}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Temperature</label>
          <p className="mb-1 text-[11px] text-neutral-500">Creativity level (0.0-1.0, default: 0.7)</p>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => setSettings((s) => ({ ...s, temperature: parseFloat(e.target.value) || 0.7 }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="0.7"
          />
          {errors.temperature && <p className="mt-1 text-xs text-red-400">{errors.temperature}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={settings.summaryEnabled}
          onChange={(e) => setSettings((s) => ({ ...s, summaryEnabled: e.target.checked }))}
          className="rounded border-neutral-600"
        />
        Enable daily event summaries via Ollama
      </label>

      <div className="flex items-center gap-3">
        {hasUnsavedChanges && <span className="text-xs text-amber-400">Unsaved changes</span>}
        <button
          onClick={handleSave}
          disabled={isSaving || Object.keys(errors).length > 0}
          className="flex items-center gap-1.5 rounded bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={async () => {
            setIsTesting(true);
            setTestMessage(null);
            const status = await fetchOllamaStatus();
            if (status?.status === 'running') {
              setTestMessage({
                type: 'success',
                text: status.modelLoaded
                  ? `Connected. Model ${status.modelName} is available.`
                  : `Connected to Ollama, but model ${settings.model} is not loaded.`,
              });
            } else {
              setTestMessage({
                type: 'error',
                text: `Connection failed: ${status?.lastError || 'Ollama is not running or unreachable.'}`,
              });
            }
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
        {testMessage && (
          <span className={`text-xs ${testMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
            {testMessage.text}
          </span>
        )}
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-400">
        <p className="mb-1 flex items-center gap-1.5 text-neutral-300"><CircleHelp size={13} /> Parameter guide</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>Endpoint must point to your Ollama HTTP server.</li>
          <li>Model should match an installed model tag in Ollama.</li>
          <li>Cron controls when daily summaries are generated.</li>
          <li>Max tokens increases summary length but may slow responses.</li>
          <li>Lower temperature gives more deterministic summaries.</li>
        </ul>
      </div>
    </div>
  );
}
