import { Copy, Download, Monitor, Moon, RotateCcw, Sun, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { useAppContext } from '../app/context';
import { PAGES } from '../app/pages';
import { useTheme, type ThemePreference } from '../app/theme';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog, Modal, buttonStyles } from '../components/ui/Modal';
import { useAsync } from '../hooks/useAsync';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { QuickActionLimit } from '../ipc/types';
import { copyText } from '../lib/clipboard';

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

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
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--cd-focus)] ${
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

const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Ctrl+K', action: 'Search commands' },
  { keys: `Ctrl+${PAGES.home.shortcutKey}`, action: 'Go to Home' },
  { keys: `Ctrl+${PAGES.cmd.shortcutKey}`, action: 'Go to CMD' },
  { keys: `Ctrl+${PAGES.powershell.shortcutKey}`, action: 'Go to PowerShell' },
  { keys: `Ctrl+${PAGES.settings.shortcutKey}`, action: 'Open Settings' },
  { keys: 'Esc', action: 'Close a panel or dialog' },
];

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

type DialogState = null | { kind: 'export'; json: string } | { kind: 'import' } | { kind: 'clearRecents' } | { kind: 'reset' };

export function SettingsPage() {
  const { revision, invalidate, notify } = useAppContext();
  const { preference, resolved, setPreference } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers a refetch after changes
  const loadSettings = useCallback(() => Promise.all([api.settings(), api.startup()]), [revision]);
  const { state } = useAsync(loadSettings);
  const [dialog, setDialog] = useState<DialogState>(null);
  const settings = state.status === 'ready' ? state.data[0] : null;
  const startup = state.status === 'ready' ? state.data[1] : null;

  const fail = (e: unknown) => { notify(e instanceof Error ? e.message : String(e), 'error'); };

  const setLimit = (limit: QuickActionLimit) => {
    api.updateSettings({ quickActionLimit: limit }).then(() => {
      invalidate();
      notify(`Home now holds up to ${limit} quick actions`);
    }, fail);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-5">
      <PageHeader title="Settings" description="Saved on this PC only." />

      <Card title="Appearance" description={`Currently showing the ${resolved} theme.`}>
        <Segmented legend="Theme" name="theme" value={preference} options={THEME_OPTIONS} onChange={(v) => { setPreference(v).catch(fail); }} />
      </Card>

      <Card title="Home" description="How many quick actions Home can hold.">
        {settings ? (
          <Segmented legend="Quick actions" name="quickActionLimit" value={settings.quickActionLimit} options={LIMIT_OPTIONS} onChange={setLimit} />
        ) : (
          <p className="text-sm text-muted">{state.status === 'error' ? state.error.message : 'Loading…'}</p>
        )}
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

      <Card title="Keyboard shortcuts" description="Customizable shortcuts arrive in Phase 5.">
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr><th>Keys</th><th>Action</th></tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((s) => (
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
          <dt className="text-muted">Version</dt><dd>0.3.0 (Phase 3: terminal and running commands)</dd>
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
              invalidate();
              notify('Preferences reset');
            }, fail);
          }}
        >
          <p>Theme and quick-action count go back to defaults, and Home gets the default quick actions again.</p>
          <p className="mt-2 text-muted">Your custom commands, favorites and aliases are kept.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
