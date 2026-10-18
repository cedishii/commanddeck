import { createContext, useContext } from 'react';
import type { CommandView, SecurityStatus, Shell } from '../ipc/types';
import type { PageId } from './pages';

export type SearchMode = 'browse' | 'addToHome';

export type EditorTarget = { readonly mode: 'create'; readonly shell: Shell } | { readonly mode: 'edit'; readonly command: CommandView };

export type ToastTone = 'info' | 'error';

export interface AppContextValue {
  /** Increments whenever stored data changes; loaders depend on it to refetch. */
  readonly revision: number;
  readonly invalidate: () => void;
  readonly notify: (message: string, tone?: ToastTone) => void;
  readonly navigate: (page: PageId) => void;
  readonly openDetails: (id: string) => void;
  readonly openSearch: (mode?: SearchMode) => void;
  readonly openEditor: (target: EditorTarget) => void;
  /** Puts the command in its shell's command bar for the user to review and send. */
  readonly openInTerminal: (command: CommandView) => void;
  /** One-click run: asks for values and confirmations as needed, then runs. */
  readonly runCommand: (command: CommandView) => void;
  /** Password and Advanced Mode state; null until known. */
  readonly security: SecurityStatus | null;
  /** Token state from the backend; null until known. */
  readonly elevated: boolean | null;
  /** Opens the "Restart as administrator" confirmation. */
  readonly restartAsAdmin: (reason?: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext must be used inside the App');
  return value;
}
