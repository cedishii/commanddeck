import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../ipc/api';
import type { ThemePreference } from '../ipc/types';

export type { ThemePreference };
export type ResolvedTheme = 'light' | 'dark';

// The backend settings store is the source of truth. localStorage only caches
// the last value so the first paint uses the right theme (no flash). Every
// access is wrapped: storage may be unavailable.
const CACHE_KEY = 'commanddeck.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readCache(): ThemePreference {
  try {
    const value = window.localStorage.getItem(CACHE_KEY);
    return isPreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function writeCache(value: ThemePreference) {
  try {
    window.localStorage.setItem(CACHE_KEY, value);
  } catch {
    // Cache only; the backend keeps the real value.
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  /** Applies immediately; resolves when saved, rejects if the backend refused. */
  readonly setPreference: (preference: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readCache);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    let cancelled = false;
    api.settings().then(
      (s) => {
        if (cancelled || !isPreference(s.theme)) return;
        setPreferenceState(s.theme);
        writeCache(s.theme);
      },
      () => { /* Backend unavailable: keep the cached preference. */ },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => { setSystem(query.matches ? 'dark' : 'light'); };
    query.addEventListener('change', onChange);
    return () => { query.removeEventListener('change', onChange); };
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: async (next) => {
        setPreferenceState(next);
        writeCache(next);
        await api.updateSettings({ theme: next });
      },
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
