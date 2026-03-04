import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

interface SettingsContextValue {
  draftSettings: Record<string, any>;
  savedSettings: Record<string, any>;
  dirtyTabs: Set<string>;
  updateDraft: (tabId: string, key: string, value: any) => void;
  updateDraftBulk: (tabId: string, updates: Record<string, any>) => void;
  initDraftBulk: (tabId: string, updates: Record<string, any>) => void;
  saveDraft: (tabId: string, saveCallback: () => Promise<void>) => Promise<void>;
  discardDraft: (tabId: string) => void;
  loadSettings: (tabId: string, keys: string[]) => Promise<Record<string, any>>;
  markClean: (tabId: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [draftSettings, setDraftSettings] = useState<Record<string, any>>({});
  const [savedSettings, setSavedSettings] = useState<Record<string, any>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  const updateDraft = useCallback((tabId: string, key: string, value: any) => {
    setDraftSettings((prev) => ({
      ...prev,
      [tabId]: {
        ...(prev[tabId] || {}),
        [key]: value,
      },
    }));

    setDirtyTabs((prev) => {
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  }, []);

  const updateDraftBulk = useCallback((tabId: string, updates: Record<string, any>) => {
    setDraftSettings((prev) => ({
      ...prev,
      [tabId]: {
        ...(prev[tabId] || {}),
        ...updates,
      },
    }));

    setDirtyTabs((prev) => {
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  }, []);

  const initDraftBulk = useCallback((tabId: string, updates: Record<string, any>) => {
    setDraftSettings((prev) => ({
      ...prev,
      [tabId]: { ...(prev[tabId] || {}), ...updates },
    }));
    setSavedSettings((prev) => ({
      ...prev,
      [tabId]: { ...updates },
    }));
  }, []);

  const saveDraft = useCallback(async (tabId: string, saveCallback: () => Promise<void>) => {
    await saveCallback();
    
    setSavedSettings((prev) => ({
      ...prev,
      [tabId]: { ...(draftSettings[tabId] || {}) },
    }));

    setDirtyTabs((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, [draftSettings]);

  const discardDraft = useCallback((tabId: string) => {
    setDraftSettings((prev) => ({
      ...prev,
      [tabId]: { ...(savedSettings[tabId] || {}) },
    }));

    setDirtyTabs((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, [savedSettings]);

  const loadSettings = useCallback(async (tabId: string, keys: string[]): Promise<Record<string, any>> => {
    if (!window.electronAPI?.settings?.get) {
      return {};
    }

    try {
      const values = await Promise.all(keys.map((key) => window.electronAPI.settings.get(key)));
      const loaded: Record<string, any> = {};
      
      keys.forEach((key, index) => {
        if (values[index] != null) {
          loaded[key] = values[index];
        }
      });

      setSavedSettings((prev) => ({
        ...prev,
        [tabId]: loaded,
      }));

      setDraftSettings((prev) => ({
        ...prev,
        [tabId]: { ...loaded },
      }));

      return loaded;
    } catch (error) {
      console.error(`[SettingsContext] Failed to load settings for ${tabId}:`, error);
      return {};
    }
  }, []);

  const markClean = useCallback((tabId: string) => {
    setDirtyTabs((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  const value: SettingsContextValue = {
    draftSettings,
    savedSettings,
    dirtyTabs,
    updateDraft,
    updateDraftBulk,
    initDraftBulk,
    saveDraft,
    discardDraft,
    loadSettings,
    markClean,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
