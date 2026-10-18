import { createContext, useContext } from 'react';
import type { CommandView, Shell } from '../ipc/types';

export type SearchMode = 'browse' | 'addToHome';

export type EditorTarget = { readonly mode: 'create'; readonly shell: Shell } | { readonly mode: 'edit'; readonly command: CommandView };

export type ToastTone = 'info' | 'error';

export interface AppContextValue {
  /** Increments whenever stored data changes; loaders depend on it to refetch. */
  readonly revision: number;
  readonly invalidate: () => void;
  readonly notify: (message: string, tone?: ToastTone) => void;
  readonly openDetails: (id: string) => void;
  readonly openSearch: (mode?: SearchMode) => void;
  readonly openEditor: (target: EditorTarget) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext must be used inside the App');
  return value;
}
