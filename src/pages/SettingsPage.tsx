import { Copy, Download, History, Monitor, Moon, RotateCcw, Sun, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useAppContext } from '../app/context';
import { PAGES } from '../app/pages';
import { searchKeyLabel, useSettings } from '../app/settings';
import { useTheme, type ThemePreference } from '../app/theme';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Toggle } from '../components/ui/Field';
import { ConfirmDialog, Modal, buttonStyles } from '../components/ui/Modal';
import { useAsync } from '../hooks/useAsync';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import { SHELL_LABEL } from '../domain/command';
import type { Density, HistoryEntry, QuickActionLimit, RetentionDays, SearchKey, SettingsPatch } from '../ipc/types';
import { copyText } from '../lib/clipboard';
import { SecuritySettings } from './SecuritySettings';

function Segmented<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
        {options.map(({ value: v, label, icon: Icon }) => (
          <label
            key={String(v)}
            className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--cd-focus)] ${
              value === v ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'
            }`}
          >
            <input type="radio" name={name} value={String(v)} checked={value === v} onChange={() => { onChange(v); }} className="sr-only" />
            {Icon ? <Icon aria-hidden size={15} /> : null}
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: LucideIcon }[];

const LIMIT_OPTIONS = [
  { value: 10, label: '10' },
  { value: 15, label: '15' },
] as const satisfies readonly { value: QuickActionLimit; label: string }[];

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const satisfies readonly { value: Density; label: string }[];

// Only keys no other app shortcut or terminal shortcut (Ctrl+Shift+C/E/V) uses. The backend allows the same set.
const SEARCH_KEY_OPTIONS = (['k', 'p', 'j'] as const satisfies readonly SearchKey[]).map((k) => ({ value: k, label: searchKeyLabel(k) }));

const RETENTION_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: -1, label: 'Forever' },
] as const satisfies readonly { value: RetentionDays; label: string }[];

/** Mirrors store::FONT_SIZES (11..=20). */
const FONT_SIZES = Array.from({ length: 10 }, (_, i) => 11 + i);

function shortcuts(search: SearchKey): readonly { keys: string; action: string }[] {
  return [
    { keys: searchKeyLabel(search), action: 'Search commands' },
    { keys: `Ctrl+${PAGES.home.shortcutKey}`, action: 'Go to Home' },
    { keys: `Ctrl+${PAGES.cmd.shortcutKey}`, action: 'Go to CMD' },
    { keys: `Ctrl+${PAGES.powershell.shortcutKey}`, action: 'Go to PowerShell' },
    { keys: `Ctrl+${PAGES.settings.shortcutKey}`, action: 'Open Settings' },
    { keys: 'Esc', action: 'Close a panel or dialog' },
    { keys: `Ctrl+Shift+${search.toUpperCase()}`, action: 'Search, from inside a terminal' },
    { keys: 'Ctrl+Shift+E', action: 'Move from a terminal to its command bar' },
  ];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function HistoryList({ entries }: { entries: readonly HistoryEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted">No runs recorded yet. One-click runs appear here after they finish.</p>;
  return (
    <ul aria-label="Run history" className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
      {entries.map((h) => (
        <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm">
          <span className={`min-w-0 flex-1 truncate font-medium ${h.exists ? '' : 'text-muted line-through'}`} title={h.exists ? h.name : `${h.name} (deleted)`}>
            {h.name}
          </span>
          {h.shell ? <span className="text-xs text-muted">{SHELL_LABEL[h.shell]}</span> : null}
          <span className={`text-xs tabular-nums ${h.exitCode === 0 ? 'text-muted' : 'text-danger'}`}>
            {h.exitCode === null ? 'stopped' : `exit ${h.exitCode}`}
          </span>
          <span className="text-xs text-muted tabular-nums">{formatDuration(h.durationMs)}</span>
          <time className="text-xs text-muted tabular-nums" dateTime={new Date(h.startedAt).toISOString()}>
            {new Date(h.startedAt).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  );
}

function ExportDialog({ json, onClose }: { json: string; onClose: () => void }) {
  const { notify } = useAppContext();
  return (
    <Modal
      title="Export custom commands"
      onClose={onClose}
      width="lg"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Close</button>
          <button
            type="button"
            className={buttonStyles.primary}
            onClick={() => { copyText(json).then(() => { notify('Export copied to clipboard'); }, () => { notify('Copy failed', 'error'); }); }}
          >
            <Copy aria-hidden size={14} />
            Copy
          </button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">Save this text somewhere safe, or paste it into Import on another PC.</p>
      <textarea aria-label="Exported commands" readOnly value={json} className="h-72 w-full rounded-md border border-border bg-code-bg p-2 font-mono text-xs text-code-fg" />
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { invalidate, notify } = useAppContext();
  const [text, setText] = useState('');
  const [error, setError] = useState<BackendError | null>(null);

  const doImport = async () => {
    setError(null);
    try {
      const report = await api.importCustom(text);
      invalidate();
      notify(`Imported ${report.imported} custom command${report.imported === 1 ? '' : 's'}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof BackendError ? e : new BackendError('internal', String(e)));
    }
  };

  return (
    <Modal
      title="Import custom commands"
      onClose={onClose}
      width="lg"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonStyles.primary} disabled={!text.trim()} onClick={() => { void doImport(); }}>Import</button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">
        Paste text exported from CommandDeck. Every command is checked first. If any is invalid, nothing is imported.
      </p>
      <textarea
        aria-label="Commands to import"
        value={text}
        onChange={(e) => { setText(e.target.value); }}
        spellCheck={false}
        className="h-56 w-full rounded-md border border-border bg-surface p-2 font-mono text-xs"
      />
      {error ? (
        <div role="alert" className="mt-2 max-h-32 overflow-y-auto rounded-md bg-risk3-bg px-3 py-2 text-sm text-risk3-fg">
          {error.fields.length > 0 ? (
            <ul className="list-disc pl-5">{error.fields.slice(0, 20).map((f) => <li key={`${f.field}-${f.message}`}>{f.field}: {f.message}</li>)}</ul>
          ) : (
            error.message
          )}
        </div>
      ) : null}
    </Modal>
  );
}

type DialogState = null | { kind: 'export'; json: string } | { kind: 'import' } | { kind: 'clearRecents' } | { kind: 'clearHistory' } | { kind: 'reset' };

export function SettingsPage() {
  const { revision, invalidate, notify } = useAppContext();
  const { preference, resolved, setPreference } = useTheme();
  const { settings, loaded, update, reload } = useSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers a refetch after changes
  const loadPage = useCallback(() => Promise.all([api.startup(), api.history()]), [revision]);
  const { state } = useAsync(loadPage);
  const [dialog, setDialog] = useState<DialogState>(null);
  const startup = state.status === 'ready' ? state.data[0] : null;
  const history = state.status === 'ready' ? state.data[1] : null;

  const fail = (e: unknown) => { notify(e instanceof Error ? e.message : String(e), 'error'); };
  const save = (patch: SettingsPatch, message?: string) => {
    update(patch).then(() => {
      invalidate();
      if (message) notify(message);
    }, fail);
  };

  const setLimit = (limit: QuickActionLimit) => { save({ quickActionLimit: limit }, `Home now holds up to ${limit} quick actions`); };
  const setRetention = (days: RetentionDays) => {
    save(
      { historyRetentionDays: days },
      days === 0 ? 'Run history is off and was cleared' : days === -1 ? 'Run history is kept until you clear it' : `Runs older than ${days} days are removed`,
    );
  };

  return (
    // `relative` keeps sr-only (absolute) helpers inside the scroll area instead of stretching the document.
    <div className="relative mx-auto max-w-3xl space-y-4 px-6 py-5">
      <PageHeader title="Settings" description="Saved on this PC only." />

      {loaded ? null : <p role="status" className="text-sm text-muted">Loading saved preferences…</p>}

      <Card title="Appearance" description={`Currently showing the ${resolved} theme.`}>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <Segmented legend="Theme" name="theme" value={preference} options={THEME_OPTIONS} onChange={(v) => { setPreference(v).catch(fail); }} />
          <Segmented legend="Density" name="density" value={settings.density} options={DENSITY_OPTIONS} onChange={(v) => { save({ density: v }); }} />
        </div>
      </Card>

      <Card title="Home" description="How many quick actions Home can hold.">
        <Segmented legend="Quick actions" name="quickActionLimit" value={settings.quickActionLimit} options={LIMIT_OPTIONS} onChange={setLimit} />
      </Card>

      <Card title="Terminal" description="Font and screen reader changes apply right away, without restarting sessions.">
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            Font size
            <select
              value={settings.terminalFontSize}
              onChange={(e) => { save({ terminalFontSize: Number(e.target.value) }); }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm font-normal"
            >
              {FONT_SIZES.map((n) => <option key={n} value={n}>{n} px</option>)}
            </select>
          </label>
          <Toggle
            label="Screen reader support"
            description="Lets screen readers read terminal output. Slightly slower with very large output."
            checked={settings.terminalScreenReader}
            onChange={(v) => { save({ terminalScreenReader: v }); }}
          />
          <Toggle
            label="Start sessions automatically"
            description="Starts a CMD or PowerShell session the first time you open its page. When off, press Start session."
            checked={settings.autoStartSessions}
            onChange={(v) => { save({ autoStartSessions: v }); }}
          />
        </div>
      </Card>

      <SecuritySettings />

      <Card title="Run history" description="Which commands you ran with one click, when, and their exit code. Output is never saved.">
        <div className="space-y-4">
          <Segmented legend="Keep history" name="historyRetentionDays" value={settings.historyRetentionDays} options={RETENTION_OPTIONS} onChange={setRetention} />
          {history ? <HistoryList entries={history} /> : <p className="text-sm text-muted">{state.status === 'error' ? state.error.message : 'Loading…'}</p>}
          {history && history.length > 0 ? (
            <button type="button" className={buttonStyles.secondary} onClick={() => { setDialog({ kind: 'clearHistory' }); }}>
              <History aria-hidden size={14} />
              Clear run history
            </button>
          ) : null}
        </div>
      </Card>

      <Card title="Your data" description="Custom commands, recent history and preferences are stored locally in CommandDeck's database.">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonStyles.secondary} onClick={() => { api.exportCustom().then((json) => { setDialog({ kind: 'export', json }); }, fail); }}>
            <Download aria-hidden size={14} />
            Export custom commands
          </button>
          <button type="button" className={buttonStyles.secondary} onClick={() => { setDialog({ kind: 'import' }); }}>
            <Upload aria-hidden size={14} />
            Import custom commands
          </button>
          <button type="button" className={buttonStyles.secondary} onClick={() => { setDialog({ kind: 'clearRecents' }); }}>
            <Trash2 aria-hidden size={14} />
            Clear recent commands
          </button>
          <button type="button" className={buttonStyles.danger} onClick={() => { setDialog({ kind: 'reset' }); }}>
            <RotateCcw aria-hidden size={14} />
            Reset preferences
          </button>
        </div>
      </Card>

      <Card title="Keyboard shortcuts" description="While a terminal has focus, only the Ctrl+Shift shortcuts work. Every other key goes to the shell.">
        <Segmented legend="Search shortcut" name="searchShortcut" value={settings.searchShortcut} options={SEARCH_KEY_OPTIONS} onChange={(v) => { save({ searchShortcut: v }, `Search is now ${searchKeyLabel(v)}`); }} />
        <table className="mt-4 w-full text-sm">
          <thead className="sr-only">
            <tr><th>Keys</th><th>Action</th></tr>
          </thead>
          <tbody>
            {shortcuts(settings.searchShortcut).map((s) => (
              <tr key={s.keys} className="border-t border-border first:border-t-0">
                <td className="py-1.5 pr-4"><kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd></td>
                <td className="py-1.5 text-muted">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="About">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Version</dt><dd>0.5.0 (safety checks, administrator mode and settings)</dd>
          <dt className="text-muted">Built-in commands</dt><dd>{startup ? `${startup.builtinCount}, each verified against Windows and Microsoft docs` : '…'}</dd>
          <dt className="text-muted">Author</dt><dd>Cedrick Kaneko</dd>
          <dt className="text-muted">Privacy</dt><dd>Runs entirely on this PC. No accounts, telemetry or network access.</dd>
        </dl>
      </Card>

      {dialog?.kind === 'export' ? <ExportDialog json={dialog.json} onClose={() => { setDialog(null); }} /> : null}
      {dialog?.kind === 'import' ? <ImportDialog onClose={() => { setDialog(null); }} /> : null}
      {dialog?.kind === 'clearRecents' ? (
        <ConfirmDialog
          title="Clear recent commands?"
          confirmLabel="Clear"
          onCancel={() => { setDialog(null); }}
          onConfirm={() => {
            setDialog(null);
            api.clearRecents().then(() => { invalidate(); notify('Recent commands cleared'); }, fail);
          }}
        >
          The list of recently used commands is deleted. Nothing else changes.
        </ConfirmDialog>
      ) : null}
      {dialog?.kind === 'clearHistory' ? (
        <ConfirmDialog
          title="Clear run history?"
          confirmLabel="Clear"
          onCancel={() => { setDialog(null); }}
          onConfirm={() => {
            setDialog(null);
            api.clearHistory().then(() => { invalidate(); notify('Run history cleared'); }, fail);
          }}
        >
          Every recorded run is deleted. Your commands and preferences don’t change.
        </ConfirmDialog>
      ) : null}
      {dialog?.kind === 'reset' ? (
        <ConfirmDialog
          title="Reset preferences?"
          confirmLabel="Reset"
          danger
          onCancel={() => { setDialog(null); }}
          onConfirm={() => {
            setDialog(null);
            api.resetSettings().then((s) => {
              void setPreference(s.theme);
              reload();
              invalidate();
              notify('Preferences reset');
            }, fail);
          }}
        >
          <p>Theme, density, terminal, shortcut, confirmation and history settings go back to defaults, and Home gets the default quick actions again.</p>
          <p className="mt-2 text-muted">Your custom commands, favorites, aliases, run history, app password and Advanced Mode are kept.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
