/* eslint-disable @typescript-eslint/only-throw-error, @typescript-eslint/prefer-promise-reject-errors --
   Tauri rejects invoke() with the plain serialized error object ({ kind, message, fields }),
   not an Error instance, so the fake must reject the same way to test the real client mapping. */
/**
 * In-memory stand-in for the Rust backend, installed through Tauri's mockIPC so
 * tests exercise the real `src/ipc` layer. It mirrors the backend's contract
 * (shapes and error kinds), not its full logic. The real rules are tested in Rust.
 */
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import type { Command, CommandView, CustomDraft, HomeView, Settings, Shell } from '../ipc/types';

type Payload = Record<string, unknown>;
type ErrorPayload = { kind: string; message: string; fields?: { field: string; message: string }[] };

export function command(partial: Partial<Command> & Pick<Command, 'id' | 'name'>): Command {
  return {
    source: 'builtin',
    shell: 'cmd',
    summary: `${partial.name} summary.`,
    category: 'networking',
    syntax: partial.id,
    aliases: [],
    keywords: [],
    tasks: [],
    requiresAdmin: false,
    risk: 'L1',
    modifies: false,
    placeholders: [],
    details: {},
    sources: [],
    ...partial,
  };
}

export const FIXTURE_COMMANDS: readonly Command[] = [
  command({
    id: 'cmd.ping',
    name: 'Check network connectivity',
    syntax: 'ping google.com',
    keywords: ['connectivity'],
    tasks: ['fix internet'],
    sources: ['https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ping'],
  }),
  command({
    id: 'cmd.ipconfig.all',
    name: 'View network configuration',
    syntax: 'ipconfig /all',
    details: { syntaxParts: [{ part: '/all', meaning: 'Full details.' }], expectedOutput: 'Adapters.' },
  }),
  command({ id: 'cmd.ipconfig.flushdns', name: 'Flush the DNS cache', syntax: 'ipconfig /flushdns', modifies: true, keywords: ['dns'] }),
  command({ id: 'cmd.tasklist', name: 'List running processes', category: 'processes', syntax: 'tasklist' }),
  command({ id: 'cmd.format.quick', name: 'Format a drive', category: 'disk', syntax: 'format <Drive>: /FS:NTFS /Q', risk: 'L3', modifies: true, requiresAdmin: true, placeholders: [{ name: 'Drive', description: 'Drive letter' }] }),
  command({ id: 'ps.get-process', name: 'View running processes', shell: 'powershell', category: 'services', syntax: 'Get-Process' }),
  command({ id: 'ps.clear-dns-cache', name: 'Flush the DNS cache', shell: 'powershell', syntax: 'Clear-DnsClientCache', modifies: true, keywords: ['dns'] }),
];

export interface FakeBackendOptions {
  readonly commands?: readonly Command[];
  readonly home?: readonly string[];
  readonly settings?: Partial<Settings>;
  readonly notice?: string | null;
}

export interface FakeBackend {
  readonly calls: { cmd: string; args: Payload }[];
  /** Makes the next call to `cmd` fail with the given error payload. */
  failNext: (cmd: string, error: ErrorPayload) => void;
  readonly state: {
    commands: Command[];
    home: { id: string; label: string | null; note: string | null }[];
    settings: Settings;
    favorites: Set<string>;
    recents: string[];
    aliases: Map<string, string[]>;
  };
  callsTo: (cmd: string) => Payload[];
}

function multiStep(shell: Shell, syntax: string): boolean {
  return syntax.includes('\n') || syntax.includes('|') || (shell === 'cmd' ? syntax.includes('&') : syntax.includes(';'));
}

export function installFakeBackend(options: FakeBackendOptions = {}): FakeBackend {
  const state: FakeBackend['state'] = {
    commands: [...(options.commands ?? FIXTURE_COMMANDS)],
    home: (options.home ?? ['cmd.ping', 'cmd.ipconfig.all', 'ps.get-process']).map((id) => ({ id, label: null, note: null })),
    settings: { theme: 'system', quickActionLimit: 10, ...options.settings },
    favorites: new Set(),
    recents: [],
    aliases: new Map(),
  };
  const calls: FakeBackend['calls'] = [];
  const failures = new Map<string, ErrorPayload>();
  let nextCustom = 1;

  const find = (id: string): Command => {
    const c = state.commands.find((x) => x.id === id);
    if (!c) throw { kind: 'notFound', message: `Unknown command '${id}'.` } satisfies ErrorPayload;
    return c;
  };
  const view = (c: Command): CommandView => ({
    ...c,
    favorite: state.favorites.has(c.id),
    onHome: state.home.some((h) => h.id === c.id),
    userAliases: state.aliases.get(c.id) ?? [],
    multiStep: c.source === 'custom' && multiStep(c.shell, c.syntax),
  });
  const home = (): HomeView => ({
    limit: state.settings.quickActionLimit,
    items: state.home.map((h) => ({ command: view(find(h.id)), label: h.label, note: h.note })),
  });
  const fromDraft = (id: string, d: CustomDraft): Command => {
    const fields: { field: string; message: string }[] = [];
    if (!d.name.trim()) fields.push({ field: 'name', message: 'is required' });
    if (!d.summary.trim()) fields.push({ field: 'summary', message: 'is required' });
    if (!d.syntax.trim()) fields.push({ field: 'syntax', message: 'is required' });
    if (fields.length > 0) throw { kind: 'validation', message: 'Some fields are invalid', fields } satisfies ErrorPayload;
    return command({ ...d, id, source: 'custom', notes: d.notes ?? undefined, tasks: [], details: {}, sources: [] } as Command);
  };

  const handlers: Record<string, (a: Payload) => unknown> = {
    app_startup: () => ({ notice: options.notice ?? null, builtinCount: state.commands.filter((c) => c.source === 'builtin').length }),
    catalog_list: (a) => state.commands.filter((c) => !a.shell || c.shell === a.shell).map(view),
    catalog_get: (a) => view(find(a.id as string)),
    catalog_search: (a) => {
      const words = String(a.query).toLowerCase().split(/\s+/).filter(Boolean);
      return state.commands
        .filter((c) => !a.shell || c.shell === a.shell)
        .filter((c) => {
          const hay = [c.name, c.syntax, ...c.keywords, ...c.tasks, ...c.aliases, ...(state.aliases.get(c.id) ?? [])].join(' ').toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .map((c) => ({ command: view(c), score: 1 }));
    },
    catalog_open_source: (a) => {
      if (!find(a.id as string).sources[a.index as number]) throw { kind: 'notFound', message: 'No such source.' };
      return null;
    },
    home_get: home,
    home_add: (a) => {
      const id = a.id as string;
      find(id);
      if (state.home.some((h) => h.id === id)) throw { kind: 'conflict', message: 'This command is already on Home.' };
      if (state.home.length >= state.settings.quickActionLimit) throw { kind: 'limit', message: 'Home is full.' };
      state.home.push({ id, label: null, note: null });
      return home();
    },
    home_remove: (a) => {
      state.home = state.home.filter((h) => h.id !== a.id);
      return home();
    },
    home_move: (a) => {
      const i = state.home.findIndex((h) => h.id === a.id);
      const [item] = state.home.splice(i, 1);
      if (item) state.home.splice(Math.min(a.toIndex as number, state.home.length), 0, item);
      return home();
    },
    home_update: (a) => {
      const item = state.home.find((h) => h.id === a.id);
      if (!item) throw { kind: 'notFound', message: 'That command is not on Home.' };
      item.label = (a.label as string | null) ?? null;
      item.note = (a.note as string | null) ?? null;
      return home();
    },
    settings_get: () => state.settings,
    settings_update: (a) => {
      const patch = a.patch as Partial<Settings>;
      if (patch.quickActionLimit !== undefined && state.home.length > patch.quickActionLimit) {
        throw { kind: 'limit', message: `Home has ${state.home.length} quick actions. Remove some first.` };
      }
      state.settings = { ...state.settings, ...patch };
      return state.settings;
    },
    settings_reset: () => {
      state.settings = { theme: 'system', quickActionLimit: 10 };
      return state.settings;
    },
    favorite_set: (a) => {
      const id = a.id as string;
      find(id);
      if (a.favorite) state.favorites.add(id);
      else state.favorites.delete(id);
      return view(find(id));
    },
    recent_record: (a) => {
      find(a.id as string);
      state.recents = [a.id as string, ...state.recents.filter((r) => r !== a.id)];
      return null;
    },
    recents_get: () => state.recents.map((id) => view(find(id))),
    recents_clear: () => {
      state.recents = [];
      return null;
    },
    aliases_set: (a) => {
      const aliases = (a.aliases as string[]).map((x) => x.trim().toLowerCase());
      const bad = aliases.find((x) => !/^[a-z0-9][a-z0-9 ._-]*$/.test(x));
      if (bad) throw { kind: 'validation', message: 'Some fields are invalid', fields: [{ field: 'aliases', message: `'${bad}' is not allowed` }] };
      state.aliases.set(a.id as string, aliases);
      return view(find(a.id as string));
    },
    custom_create: (a) => {
      const c = fromDraft(`custom.${nextCustom++}`, a.draft as CustomDraft);
      state.commands.push(c);
      return view(c);
    },
    custom_update: (a) => {
      const id = a.id as string;
      find(id);
      const c = fromDraft(id, a.draft as CustomDraft);
      state.commands = state.commands.map((x) => (x.id === id ? c : x));
      return view(c);
    },
    custom_delete: (a) => {
      find(a.id as string);
      state.commands = state.commands.filter((c) => c.id !== a.id);
      state.home = state.home.filter((h) => h.id !== a.id);
      return null;
    },
    custom_export: () =>
      JSON.stringify({ format: 'commanddeck.custom-commands', version: 1, commands: state.commands.filter((c) => c.source === 'custom') }, null, 2),
    custom_import: (a) => {
      let parsed: { commands?: CustomDraft[] };
      try {
        parsed = JSON.parse(a.json as string) as { commands?: CustomDraft[] };
      } catch {
        throw { kind: 'validation', message: 'Some fields are invalid', fields: [{ field: 'file', message: 'is not a CommandDeck export' }] };
      }
      const drafts = parsed.commands ?? [];
      const created = drafts.map((d) => fromDraft(`custom.${nextCustom++}`, d));
      state.commands.push(...created);
      return { imported: created.length };
    },
  };

  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Payload;
    calls.push({ cmd, args });
    const failure = failures.get(cmd);
    if (failure) {
      failures.delete(cmd);
      return Promise.reject(failure);
    }
    const handler = handlers[cmd];
    if (!handler) return Promise.reject({ kind: 'internal', message: `fake backend: unhandled ${cmd}` });
    try {
      return Promise.resolve(handler(args));
    } catch (e: unknown) {
      return Promise.reject(e);
    }
  });

  return {
    calls,
    state,
    failNext: (cmd, error) => { failures.set(cmd, error); },
    callsTo: (cmd) => calls.filter((c) => c.cmd === cmd).map((c) => c.args),
  };
}

export { clearMocks };
