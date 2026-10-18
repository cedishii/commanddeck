import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../ipc/api';
import { DEFAULT_SETTINGS, type SearchKey, type Settings, type SettingsPatch } from '../ipc/types';

/** Display text for the configurable search shortcut, e.g. "Ctrl+K". */
export function searchKeyLabel(key: SearchKey): string {
  return `Ctrl+${key.toUpperCase()}`;
}

interface SettingsContextValue {
  /** Stored settings, or defaults until they've loaded (or if the backend is unavailable). */
  readonly settings: Settings;
  readonly loaded: boolean;
  /** Saves to the backend and applies the backend's validated result. Rejects on refusal. */
  readonly update: (patch: SettingsPatch) => Promise<Settings>;
  readonly reload: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.settings().then(
      (s) => {
        if (!cancelled) {
          setSettings(s);
          setLoaded(true);
        }
      },
      () => { /* keep defaults */ },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    document.documentElement.dataset.density = settings.density;
  }, [settings.density]);

  const update = useCallback(async (patch: SettingsPatch) => {
    const next = await api.updateSettings(patch);
    setSettings(next);
    return next;
  }, []);

  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);

  const value = useMemo(() => ({ settings, loaded, update, reload }), [settings, loaded, update, reload]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
