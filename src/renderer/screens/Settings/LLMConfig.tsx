import { useState, useEffect, useCallback, useMemo } from 'react';
import { Brain, Save, Loader2, Wifi, WifiOff, CircleHelp, ExternalLink } from 'lucide-react';

interface LLMSettings {
  ollamaEndpoint: string;
  model: string;
  summaryEnabled: boolean;
  summaryScheduleCron: string;
  maxTokens: number;
  temperature: number;
}

interface SettingResponse {
  value?: unknown;
}

const DEFAULT_SETTINGS: LLMSettings = {
  ollamaEndpoint: 'http://127.0.0.1:11434',
  model: 'llama3.2',
  summaryEnabled: true,
  summaryScheduleCron: '0 8 * * *',
  maxTokens: 2048,
  temperature: 0.7,
};

const CRON_FIELD_REGEX = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

const unwrapSettingValue = (input: unknown): unknown => {
  if (input && typeof input === 'object' && 'value' in (input as SettingResponse)) {
    return (input as SettingResponse).value;
  }
  return input;
};

export default function LLMConfig() {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ status: string; modelLoaded: boolean; modelName: string; lastError: string | null } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const validationErrors = useMemo(() => {
    const errors: Partial<Record<keyof LLMSettings, string>> = {};

    try {
      new URL(settings.ollamaEndpoint);
    } catch {
      errors.ollamaEndpoint = 'Enter a valid URL (e.g., http://localhost:11434).';
    }

    if (!settings.model.trim()) {
      errors.model = 'Model name is required (e.g., llama3.2 or mistral).';
    }

    if (!CRON_FIELD_REGEX.test(settings.summaryScheduleCron.trim())) {
      errors.summaryScheduleCron = 'Cron must have 5 fields (minute hour day month weekday). Example: 0 8 * * *';
    }

    if (!Number.isFinite(settings.maxTokens) || settings.maxTokens < 256 || settings.maxTokens > 8192) {
      errors.maxTokens = 'Max tokens must be between 256 and 8192.';
    }

    if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 1) {
      errors.temperature = 'Temperature must be between 0.0 and 1.0.';
    }

    return errors;
  }, [settings]);

  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  const fetchOllamaStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.llm?.status) {
        const result = await window.electronAPI.llm.status();
        setOllamaStatus(result);
        return result;
      }
      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const fallback = { status: 'error', modelLoaded: false, modelName: settings.model, lastError: errorMessage || 'Failed to check status' };
      setOllamaStatus(fallback);
      return fallback;
    }
  }, [settings.model]);

  useEffect(() => {
    if (window.electronAPI?.settings?.get) {
      Promise.all([
        window.electronAPI.settings.get('ollama.endpoint'),
        window.electronAPI.settings.get('ollama.model'),
        window.electronAPI.settings.get('ollama.summaryEnabled'),
        window.electronAPI.settings.get('ollama.summaryScheduleCron'),
        window.electronAPI.settings.get('ollama.maxTokens'),
        window.electronAPI.settings.get('ollama.temperature'),
      ])
        .then(([endpoint, model, enabled, cron, tokens, temp]) => {
          const normalized: LLMSettings = {
            ollamaEndpoint: String(unwrapSettingValue(endpoint) ?? DEFAULT_SETTINGS.ollamaEndpoint),
            model: String(unwrapSettingValue(model) ?? DEFAULT_SETTINGS.model),
            summaryEnabled: String(unwrapSettingValue(enabled) ?? DEFAULT_SETTINGS.summaryEnabled) === 'true',
            summaryScheduleCron: String(unwrapSettingValue(cron) ?? DEFAULT_SETTINGS.summaryScheduleCron),
            maxTokens: Number(unwrapSettingValue(tokens) ?? DEFAULT_SETTINGS.maxTokens),
            temperature: Number(unwrapSettingValue(temp) ?? DEFAULT_SETTINGS.temperature),
          };

          setSettings(normalized);
          setSavedSettings(normalized);
        })
        .catch(() => {
          setSettings(DEFAULT_SETTINGS);
          setSavedSettings(DEFAULT_SETTINGS);
        });
    }
    fetchOllamaStatus();
  }, [fetchOllamaStatus]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setStatusMessage(null);

    if (hasValidationErrors) {
      setStatusMessage({ type: 'error', text: 'Please fix validation errors before saving.' });
      setIsSaving(false);
      return;
    }

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
      setStatusMessage({ type: 'success', text: 'LLM settings saved successfully.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: `Save failed: ${msg}` });
    } finally {
      setIsSaving(false);
    }
  }, [hasValidationErrors, settings]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setStatusMessage(null);
    const result = await fetchOllamaStatus();
    setIsTesting(false);

    if (!result) {
      setStatusMessage({ type: 'error', text: 'Connection test unavailable: electronAPI.llm.status is missing.' });
      return;
    }

    if (result.status === 'running') {
      const modelMessage = result.modelLoaded
        ? `Connected. Model "${result.modelName}" is available.`
        : `Connected to Ollama, but model "${result.modelName}" is not loaded yet.`;
      setStatusMessage({ type: result.modelLoaded ? 'success' : 'error', text: modelMessage });
      return;
    }

    const details = result.lastError ? ` Details: ${result.lastError}` : '';
    setStatusMessage({ type: 'error', text: `Connection failed: status is "${result.status}".${details}` });
  }, [fetchOllamaStatus]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Brain size={18} className="text-indigo-400" />
        <h2 className="text-lg font-medium text-neutral-100">LLM / Ollama Configuration</h2>
      </div>

      {ollamaStatus && (
        <div className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-800/50 px-3 py-2 text-xs">
          {ollamaStatus.status === 'running' ? <Wifi size={14} className="text-emerald-400" /> : <WifiOff size={14} className="text-red-400" />}
          <span className="text-neutral-300">
            Status:{' '}
            <span className={ollamaStatus.status === 'running' ? 'text-emerald-400' : 'text-red-400'}>
              {ollamaStatus.status === 'running' ? 'Running' : ollamaStatus.status}
            </span>
          </span>
          {ollamaStatus.modelLoaded && (
            <>
              <span className="text-neutral-500">|</span>
              <span className="text-neutral-300">
                Model: <span className="text-emerald-400">{ollamaStatus.modelName}</span>
              </span>
            </>
          )}
          {ollamaStatus.lastError && <span className="text-red-400">{ollamaStatus.lastError}</span>}
        </div>
      )}

      <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-400">
        <div className="flex items-center gap-2">
          <CircleHelp size={13} className="text-neutral-500" />
          <span>{hasUnsavedChanges ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-neutral-300">Ollama Endpoint</label>
          <p className="mb-1 text-xs text-neutral-500">API URL (e.g., http://localhost:11434)</p>
          <input
            type="text"
            value={settings.ollamaEndpoint}
            onChange={(e) => setSettings((s) => ({ ...s, ollamaEndpoint: e.target.value }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="http://localhost:11434"
            title="Base URL for your Ollama server"
          />
          {validationErrors.ollamaEndpoint && <p className="mt-1 text-xs text-red-400">{validationErrors.ollamaEndpoint}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-300">Model</label>
          <p className="mb-1 text-xs text-neutral-500">Model name (e.g., llama3.2, mistral)</p>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="llama3.2"
            title="Installed Ollama model name"
          />
          {validationErrors.model && <p className="mt-1 text-xs text-red-400">{validationErrors.model}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-300">Summary Schedule (cron)</label>
          <p className="mb-1 text-xs text-neutral-500">Cron expression (e.g., 0 8 * * * for daily 8 AM)</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={settings.summaryScheduleCron}
              onChange={(e) => setSettings((s) => ({ ...s, summaryScheduleCron: e.target.value }))}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
              placeholder="0 8 * * *"
              title="Cron format: minute hour day month weekday"
            />
            <a
              href="https://crontab.guru/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              title="Open cron syntax helper"
            >
              Helper <ExternalLink size={11} />
            </a>
          </div>
          {validationErrors.summaryScheduleCron && <p className="mt-1 text-xs text-red-400">{validationErrors.summaryScheduleCron}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-300">Max Tokens</label>
          <p className="mb-1 text-xs text-neutral-500">Maximum response length (default: 2048)</p>
          <input
            type="number"
            min={256}
            max={8192}
            step={256}
            value={settings.maxTokens}
            onChange={(e) => setSettings((s) => ({ ...s, maxTokens: parseInt(e.target.value, 10) || 0 }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="2048"
            title="Higher values allow longer outputs but use more memory"
          />
          {validationErrors.maxTokens && <p className="mt-1 text-xs text-red-400">{validationErrors.maxTokens}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-300">Temperature</label>
          <p className="mb-1 text-xs text-neutral-500">Creativity level (0.0-1.0, default: 0.7)</p>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => setSettings((s) => ({ ...s, temperature: parseFloat(e.target.value) || 0 }))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 focus:border-primary-500 focus:outline-none"
            placeholder="0.7"
            title="Lower is more deterministic, higher is more creative"
          />
          {validationErrors.temperature && <p className="mt-1 text-xs text-red-400">{validationErrors.temperature}</p>}
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
        <button
          onClick={handleSave}
          disabled={isSaving || hasValidationErrors || !hasUnsavedChanges}
          className="flex items-center gap-1.5 rounded bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleTestConnection}
          disabled={isTesting}
          className="flex items-center gap-1.5 rounded border border-neutral-600 px-4 py-1.5 text-sm font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
        {statusMessage && (
          <span className={`text-xs ${statusMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{statusMessage.text}</span>
        )}
      </div>
    </div>
  );
}
