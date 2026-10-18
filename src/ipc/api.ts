/** Typed wrappers for every backend command (src-tauri/src/commands.rs). */
import { call } from './client';
import type {
  CommandView,
  CustomDraft,
  HomeView,
  ImportReport,
  SearchResult,
  Settings,
  SettingsPatch,
  Shell,
  StartupInfo,
} from './types';

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
};
