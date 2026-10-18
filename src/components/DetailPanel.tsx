import { ExternalLink, House, Pencil, Star, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useAppContext } from '../app/context';
import { categoryLabel } from '../domain/categories';
import { RISK_DESCRIPTION, SHELL_LABEL, type CommandEntry } from '../domain/command';
import { useAsync } from '../hooks/useAsync';
import { useCommandActions } from '../hooks/useCommandActions';
import { useDialog } from '../hooks/useDialog';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import { AdminBadge, CustomBadge, MultiStepBadge, RiskBadge, ShellBadge } from './ui/Badge';
import { ConfirmDialog, buttonStyles } from './ui/Modal';
import { ErrorState, LoadingState } from './ui/StatusMessage';
import { SyntaxPreview } from './SyntaxPreview';

interface DetailPanelProps {
  readonly id: string;
  readonly onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function AliasEditor({ entry }: { entry: CommandEntry }) {
  const { run } = useCommandActions();
  const [value, setValue] = useState(entry.userAliases.join(', '));
  const [error, setError] = useState<string | null>(null);
  const inputId = `aliases-${entry.id}`;

  const save = async () => {
    setError(null);
    const aliases = value.split(',').map((a) => a.trim()).filter(Boolean);
    try {
      await api.setAliases(entry.id, aliases);
    } catch (e: unknown) {
      setError(e instanceof BackendError ? (e.fieldMessage('aliases') ?? e.message) : String(e));
      return;
    }
    await run(() => Promise.resolve(), 'Aliases saved');
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-muted">
        Extra words that find this command in search, comma-separated.
        {entry.aliases.length > 0 ? ` Built-in: ${entry.aliases.join(', ')}.` : ''}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => { setValue(e.target.value); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
          placeholder="e.g. myip, netinfo"
        />
        <button type="button" className={buttonStyles.secondary} onClick={() => { void save(); }}>Save</button>
      </div>
      {error ? <p id={`${inputId}-error`} className="text-danger">{error}</p> : null}
    </div>
  );
}

/** "learn.microsoft.com · ipconfig" from a documentation URL. */
export function docLabel(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? `${u.hostname} · ${decodeURIComponent(last)}` : u.hostname;
  } catch {
    return url;
  }
}

function Content({ entry, onClose }: { entry: CommandEntry; onClose: () => void }) {
  const { openEditor, notify } = useAppContext();
  const actions = useCommandActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const d = entry.details;
  const custom = entry.source === 'custom';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonStyles.secondary} aria-pressed={entry.favorite} onClick={() => { void actions.toggleFavorite(entry); }}>
          <Star aria-hidden size={14} className={entry.favorite ? 'fill-current text-risk2-fg' : undefined} />
          {entry.favorite ? 'Favorited' : 'Favorite'}
        </button>
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => { void (entry.onHome ? actions.removeFromHome(entry) : actions.addToHome(entry)); }}
        >
          <House aria-hidden size={14} />
          {entry.onHome ? 'Remove from Home' : 'Add to Home'}
        </button>
        {custom ? (
          <>
            <button type="button" className={buttonStyles.secondary} onClick={() => { openEditor({ mode: 'edit', command: entry }); }}>
              <Pencil aria-hidden size={14} />
              Edit
            </button>
            <button type="button" className={buttonStyles.danger} onClick={() => { setConfirmDelete(true); }}>
              <Trash2 aria-hidden size={14} />
              Delete
            </button>
          </>
        ) : null}
      </div>

      <p className="text-sm">{entry.summary}</p>

      <Section title="Command">
        <SyntaxPreview syntax={entry.syntax} label={entry.name} variant="full" onCopied={() => { actions.recordUse(entry); }} />
      </Section>

      {entry.placeholders.length > 0 ? (
        <Section title="Fill in before running">
          <dl className="space-y-1">
            {entry.placeholders.map((p) => (
              <div key={p.name} className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-3">
                <dt><code className="rounded bg-code-bg px-1 font-mono text-[13px] text-code-fg">{`<${p.name}>`}</code></dt>
                <dd className="text-muted">{p.description}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {d.whenToUse ? <Section title="When to use it">{d.whenToUse}</Section> : null}

      {d.syntaxParts && d.syntaxParts.length > 0 ? (
        <Section title="What the syntax means">
          <dl className="space-y-1.5">
            {d.syntaxParts.map((p) => (
              <div key={p.part} className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-3">
                <dt><code className="rounded bg-code-bg px-1 font-mono text-[13px] text-code-fg">{p.part}</code></dt>
                <dd className="text-muted">{p.meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <Section title="Effect on your system">
        <p>{entry.modifies ? `Changes system state. ${RISK_DESCRIPTION[entry.risk]}` : 'Read-only. It does not change anything.'}</p>
        {custom ? (
          <p className="mt-1.5 text-muted">
            This risk level is your own description. Before running custom commands, CommandDeck will analyze them itself and won't rely on this label.
          </p>
        ) : null}
        {d.sideEffects && d.sideEffects.length > 0 ? (
          <ul className="mt-1.5 list-disc space-y-1 pl-5">{d.sideEffects.map((s) => <li key={s}>{s}</li>)}</ul>
        ) : null}
      </Section>

      <Section title="Permissions">
        {entry.requiresAdmin
          ? 'Requires administrator rights. In a standard-user context Windows will refuse it.'
          : 'Works as a standard user.'}
      </Section>

      {d.expectedOutput ? <Section title="Expected output">{d.expectedOutput}</Section> : null}

      {d.cautions && d.cautions.length > 0 ? (
        <Section title="Watch out for">
          <ul className="list-disc space-y-1 pl-5">{d.cautions.map((c) => <li key={c}>{c}</li>)}</ul>
        </Section>
      ) : null}

      {entry.notes ? <Section title="Your notes"><p className="whitespace-pre-wrap">{entry.notes}</p></Section> : null}

      <Section title="Personal aliases">
        <AliasEditor key={entry.userAliases.join(',')} entry={entry} />
      </Section>

      {entry.sources.length > 0 ? (
        <Section title="Documentation">
          <ul className="space-y-1">
            {entry.sources.map((url, i) => (
              <li key={url}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-left text-accent hover:underline"
                  title={url}
                  onClick={() => {
                    api.openSource(entry.id, i).catch((e: unknown) => { notify(e instanceof Error ? e.message : String(e), 'error'); });
                  }}
                >
                  {docLabel(url)}
                  <ExternalLink aria-hidden size={13} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="border-t border-border pt-3 text-xs text-muted">
        {SHELL_LABEL[entry.shell]} · {categoryLabel(entry.category)} · {custom ? 'Custom command' : 'Built-in, verified against Windows and Microsoft docs'}
      </p>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete custom command?"
          confirmLabel="Delete"
          danger
          onCancel={() => { setConfirmDelete(false); }}
          onConfirm={() => {
            setConfirmDelete(false);
            void actions.run(() => api.deleteCustom(entry.id), `"${entry.name}" deleted`).then((ok) => { if (ok) onClose(); });
          }}
        >
          “{entry.name}” will be removed from your library, Home and favorites. This can't be undone.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/**
 * Modal side panel with full command information. Loads the command by id so
 * it always reflects the latest state after favorites/Home/alias changes.
 */
export function DetailPanel({ id, onClose }: DetailPanelProps) {
  const { revision } = useAppContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers a refetch after changes
  const load = useCallback(() => api.getCommand(id), [id, revision]);
  const { state, retry } = useAsync(load);
  const onKeyDown = useDialog(panelRef, onClose, closeRef);
  const titleId = `detail-title-${id}`;
  const entry = state.status === 'ready' ? state.data : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[var(--cd-overlay)]" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="relative flex h-full w-[min(560px,92vw)] flex-col border-l border-border bg-surface shadow-[var(--cd-shadow)]"
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <h2 id={titleId} className="text-lg leading-snug font-semibold">{entry?.name ?? 'Command details'}</h2>
            {entry ? (
              <div className="flex flex-wrap gap-1">
                <ShellBadge shell={entry.shell} />
                {entry.source === 'custom' ? <CustomBadge /> : null}
                {entry.multiStep ? <MultiStepBadge /> : null}
                <RiskBadge risk={entry.risk} />
                {entry.requiresAdmin ? <AdminBadge /> : null}
              </div>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X aria-hidden size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {state.status === 'loading' ? <LoadingState label="Loading details…" /> : null}
          {state.status === 'error' ? <ErrorState title="Couldn't load this command" message={state.error.message} onRetry={retry} /> : null}
          {entry ? <Content entry={entry} onClose={onClose} /> : null}
        </div>
      </div>
    </div>
  );
}
