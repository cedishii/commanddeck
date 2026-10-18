/** Typed wrappers for every backend command (src-tauri/src/commands.rs). */
import { Channel } from '@tauri-apps/api/core';
import { call } from './client';
import type {
  CommandView,
  CustomDraft,
  HistoryEntry,
  HomeView,
  ImportReport,
  PtyEvent,
  SearchResult,
  SessionInfo,
  Settings,
  SettingsPatch,
  Shell,
  ShellInfo,
  ShellKind,
  StartupInfo,
} from './types';

function eventChannel(onEvent: (event: PtyEvent) => void): Channel<PtyEvent> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return channel;
}

export const api = {
  startup: () => call<StartupInfo>('app_startup'),

  listCommands: (shell?: Shell) => call<CommandView[]>('catalog_list', { shell: shell ?? null }),
  getCommand: (id: string) => call<CommandView>('catalog_get', { id }),
  search: (query: string, shell?: Shell, limit = 20) => call<SearchResult[]>('catalog_search', { query, shell: shell ?? null, limit }),
  openSource: (id: string, index: number) => call<null>('catalog_open_source', { id, index }),

  home: () => call<HomeView>('home_get'),
  homeAdd: (id: string) => call<HomeView>('home_add', { id }),
  homeRemove: (id: string) => call<HomeView>('home_remove', { id }),
  homeMove: (id: string, toIndex: number) => call<HomeView>('home_move', { id, toIndex }),
  homeUpdate: (id: string, label: string | null, note: string | null) => call<HomeView>('home_update', { id, label, note }),

  settings: () => call<Settings>('settings_get'),
  updateSettings: (patch: SettingsPatch) => call<Settings>('settings_update', { patch }),
  resetSettings: () => call<Settings>('settings_reset'),

  setFavorite: (id: string, favorite: boolean) => call<CommandView>('favorite_set', { id, favorite }),
  recordRecent: (id: string) => call<null>('recent_record', { id }),
  recents: () => call<CommandView[]>('recents_get'),
  clearRecents: () => call<null>('recents_clear'),
  setAliases: (id: string, aliases: readonly string[]) => call<CommandView>('aliases_set', { id, aliases }),

  createCustom: (draft: CustomDraft) => call<CommandView>('custom_create', { draft }),
  updateCustom: (id: string, draft: CustomDraft) => call<CommandView>('custom_update', { id, draft }),
  deleteCustom: (id: string) => call<null>('custom_delete', { id }),
  exportCustom: () => call<string>('custom_export'),
  importCustom: (json: string) => call<ImportReport>('custom_import', { json }),

  history: (limit = 50) => call<HistoryEntry[]>('history_get', { limit }),
  clearHistory: () => call<null>('history_clear'),

  shells: () => call<ShellInfo[]>('shells_list'),
  /** Starts an interactive shell session. Events arrive in order; `exit` is last. */
  openSession: (shell: ShellKind, cols: number, rows: number, onEvent: (e: PtyEvent) => void) =>
    call<SessionInfo>('pty_open', { shell, cols, rows, onEvent: eventChannel(onEvent) }),
  /** Runs a catalog command by id (backend decides if one-click running is allowed). */
  runCommand: (id: string, cols: number, rows: number, onEvent: (e: PtyEvent) => void) =>
    call<SessionInfo>('run_start', { id, cols, rows, onEvent: eventChannel(onEvent) }),
  writeSession: (sessionId: number, data: string) => call<null>('pty_write', { sessionId, data }),
  resizeSession: (sessionId: number, cols: number, rows: number) => call<null>('pty_resize', { sessionId, cols, rows }),
  closeSession: (sessionId: number) => call<null>('pty_close', { sessionId }),
};

/** Decodes a base64 output chunk to raw bytes for the terminal. */
export function decodeOutput(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
