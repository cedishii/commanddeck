import { Copy, Play, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useAppContext } from '../app/context';
import { Field, fieldInputClass } from '../components/ui/Field';
import { Modal, buttonStyles } from '../components/ui/Modal';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { CommandView, Prepared } from '../ipc/types';
import { copyText } from '../lib/clipboard';

const RISK_TEXT = {
  L1: 'Routine',
  L2: 'Changes your system',
  L3: 'High impact',
} as const;

interface RunDialogProps {
  readonly command: CommandView;
  /** The run may start: prepared, and authorized when that was needed. */
  readonly onReady: (prepared: Prepared, grant: string | null) => void;
  readonly onClose: () => void;
}

function asBackendError(e: unknown): BackendError {
  return e instanceof BackendError ? e : new BackendError('internal', e instanceof Error ? e.message : String(e));
}

const codeBlock = 'block break-all rounded-md bg-code-bg p-2 font-mono text-xs text-code-fg';

/**
 * One-click run flow (SECURITY.md §5): fill values → backend prepares and
 * analyzes → admin-needed choice, or confirmation (typed phrase and password
 * for high-impact runs) → run. Routine runs without values skip every step.
 */
export function RunDialog({ command, onReady, onClose }: RunDialogProps) {
  const { notify, restartAsAdmin } = useAppContext();
  const hasValues = command.placeholders.length > 0;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(command.placeholders.map((p) => [p.name, ''])));
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<BackendError | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const started = useRef(false);

  const prepare = (params: Record<string, string>) => {
    setError(null);
    setBusy(true);
    api.prepareRun(command.id, params).then(
      (p) => {
        setBusy(false);
        if (!p.needsElevation && !p.needsConfirmation) onReady(p, null);
        else setPrepared(p);
      },
      (e: unknown) => {
        setBusy(false);
        const err = asBackendError(e);
        if (hasValues && err.kind === 'validation') {
          setError(err);
        } else {
          notify(err.message, 'error');
          onClose();
        }
      },
    );
  };

  // No values to ask for: prepare right away (once, even under StrictMode).
  useEffect(() => {
    if (hasValues || started.current) return;
    started.current = true;
    prepare({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on open
  }, []);

  const authorize = (p: Prepared) => {
    setBusy(true);
    setError(null);
    api.authorizeRun(p.prepareId, p.confirmPhrase ? phrase : undefined, p.needsPassword ? password : undefined).then(
      (grant) => { onReady(p, grant); },
      (e: unknown) => {
        setBusy(false);
        const err = asBackendError(e);
        if (err.kind === 'conflict') {
          // Expired or already used: start over rather than retrying a stale run.
          notify(err.message, 'error');
          onClose();
        } else {
          setError(err);
        }
      },
    );
  };

  if (!prepared) {
    if (!hasValues) return null; // preparing a routine run: nothing to show
    return (
      <Modal
        title={`Run: ${command.name}`}
        onClose={onClose}
        footer={
          <>
            <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
            <button type="submit" form={formId} className={buttonStyles.primary} disabled={busy}>Continue</button>
          </>
        }
      >
        <form
          id={formId}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            prepare(values);
          }}
        >
          <code className={codeBlock}>{command.syntax}</code>
          {command.placeholders.map((p, i) => (
            <Field key={p.name} label={p.name} hint={p.description} error={error?.fieldMessage(`params.${p.name}`)}>
              {(control) => (
                <input
                  {...control}
                  className={`${fieldInputClass} font-mono`}
                  value={values[p.name] ?? ''}
                  onChange={(e) => { setValues((v) => ({ ...v, [p.name]: e.target.value })); }}
                  spellCheck={false}
                  autoFocus={i === 0}
                />
              )}
            </Field>
          ))}
        </form>
      </Modal>
    );
  }

  if (prepared.needsElevation) {
    return (
      <Modal
        title="Administrator rights needed"
        onClose={onClose}
        width="sm"
        footer={
          <>
            <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => {
                copyText(prepared.text).then(() => { notify('Command copied. Paste it into a terminal opened as administrator.'); onClose(); }, () => { notify('Copy failed', 'error'); });
              }}
            >
              <Copy aria-hidden size={14} />
              Copy command
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              onClick={() => { onClose(); restartAsAdmin(`“${prepared.name}” needs administrator rights. After the restart, run it again yourself: nothing runs automatically.`); }}
            >
              <ShieldAlert aria-hidden size={14} />
              Restart as administrator
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p>“{prepared.name}” only works with administrator rights, and CommandDeck is running as a standard user.</p>
          <code className={codeBlock}>{prepared.text}</code>
          <p className="text-muted">Restart CommandDeck as administrator, or copy the command and run it in your own administrator terminal.</p>
        </div>
      </Modal>
    );
  }

  const high = prepared.risk === 'L3';
  const phraseMessage = error?.fieldMessage('confirmation');
  const passwordMessage = error?.fieldMessage('password') ?? (error?.kind === 'limit' ? error.message : undefined);
  const otherMessage = error && !phraseMessage && !passwordMessage ? error.message : undefined;
  const canRun = !busy && (!prepared.confirmPhrase || phrase.trim() !== '') && (!prepared.needsPassword || password !== '');

  return (
    <Modal
      title={high ? 'Confirm a high-impact run' : 'Confirm this change'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className={high ? buttonStyles.danger : buttonStyles.primary} disabled={!canRun}>
            <Play aria-hidden size={13} />
            Run
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRun) authorize(prepared);
        }}
      >
        <p>
          <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${high ? 'bg-risk3-bg text-risk3-fg' : 'bg-risk2-bg text-risk2-fg'}`}>{RISK_TEXT[prepared.risk]}</span>
          {prepared.name}
        </p>
        {prepared.findings.length > 0 ? (
          <ul className="space-y-2">
            {prepared.findings.map((f) => (
              <li key={`${f.operation}|${f.target}`} className="flex gap-2">
                <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-danger" />
                <div>
                  <p className="font-medium">{f.operation}: <span className="break-all">{f.target}</span></p>
                  <p className="text-muted">{f.consequence}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <code className={codeBlock}>{prepared.text}</code>
        {prepared.confirmPhrase ? (
          <Field label={<>Type <kbd className="rounded border border-border bg-surface-2 px-1 font-mono">{prepared.confirmPhrase}</kbd> to confirm</>} error={phraseMessage}>
            {(control) => (
              <input {...control} className={`${fieldInputClass} font-mono`} value={phrase} onChange={(e) => { setPhrase(e.target.value); }} spellCheck={false} autoFocus />
            )}
          </Field>
        ) : null}
        {prepared.needsPassword ? (
          <Field label="App password" error={passwordMessage}>
            {(control) => (
              <input {...control} type="password" className={fieldInputClass} value={password} onChange={(e) => { setPassword(e.target.value); }} autoFocus={!prepared.confirmPhrase} />
            )}
          </Field>
        ) : null}
        {otherMessage ? <p role="alert" className="text-danger">{otherMessage}</p> : null}
      </form>
    </Modal>
  );
}
