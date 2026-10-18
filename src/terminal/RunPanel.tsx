import { Play, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useAppContext } from '../app/context';
import { useSettings } from '../app/settings';
import { ShellBadge } from '../components/ui/Badge';
import { buttonStyles } from '../components/ui/Modal';
import { useDialog } from '../hooks/useDialog';
import { api } from '../ipc/api';
import type { CommandView, Prepared } from '../ipc/types';
import { useTerminalSession } from './useTerminalSession';
import { XtermView, type TerminalHandle } from './XtermView';

interface RunPanelProps {
  readonly command: CommandView;
  /** A prepared (and, if needed, authorized) run. Single use: it starts once. */
  readonly prepared: Prepared;
  readonly grant: string | null;
  readonly onClose: () => void;
  /** Starts the whole flow again (values, confirmation) for a fresh run. */
  readonly onRunAgain: () => void;
}

/**
 * One-off run of a catalog command with live output. Input is forwarded, so
 * Ctrl+C interrupts like in a normal console. Closing the panel stops the run.
 */
export function RunPanel({ command, prepared, grant, onClose, onRunAgain }: RunPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<TerminalHandle | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onKeyDown = useDialog(panelRef, onClose, closeRef);
  const starter = useCallback(
    (cols: number, rows: number, onEvent: Parameters<typeof api.startRun>[4]) => api.startRun(prepared.prepareId, grant, cols, rows, onEvent),
    [prepared.prepareId, grant],
  );
  const run = useTerminalSession(terminal, starter);
  const { settings } = useSettings();
  const { invalidate } = useAppContext();
  const finished = run.status.kind === 'exited';
  // The backend records the run when it ends; refresh views that show history.
  // `invalidate` changes identity on every revision, so read it through a ref to refresh once per finish.
  const invalidateRef = useRef(invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
  }, [invalidate]);
  useEffect(() => {
    if (finished) invalidateRef.current();
  }, [finished]);
  const { start } = run;

  useEffect(() => {
    // Let the terminal measure itself before starting, so output wraps at the real width.
    const t = window.setTimeout(() => { void start(); }, 50);
    return () => { window.clearTimeout(t); };
  }, [start]);

  const status = run.status;
  const statusLine =
    status.kind === 'running'
      ? 'Running…'
      : status.kind === 'starting'
        ? 'Starting…'
        : status.kind === 'exited'
          ? status.code === 0
            ? 'Finished · exit code 0'
            : `Finished · exit code ${status.code}`
          : status.kind === 'failed'
            ? `Couldn't run: ${status.message}`
            : '';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[var(--cd-overlay)]" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Run: ${command.name}`}
        onKeyDown={onKeyDown}
        className="relative flex h-full w-[min(760px,94vw)] flex-col border-l border-border bg-surface shadow-[var(--cd-shadow)]"
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold">{command.name}</h2>
              <ShellBadge shell={command.shell} />
            </div>
            <code className="mt-0.5 block truncate font-mono text-xs text-muted" title={prepared.text}>{prepared.text}</code>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close output" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <XtermView handleRef={terminal} ariaLabel={`Output of ${command.name}`} onData={(d) => { run.write(d); }} onResize={run.resize} fontSize={settings.terminalFontSize} screenReaderMode={settings.terminalScreenReader} />
        </div>
        <footer className="flex items-center gap-2 border-t border-border px-5 py-2.5">
          <p
            role="status"
            className={`flex-1 text-sm ${status.kind === 'failed' || (status.kind === 'exited' && status.code !== 0) ? 'text-danger' : 'text-muted'}`}
          >
            {statusLine}
          </p>
          {status.kind === 'running' ? (
            <button type="button" className={buttonStyles.danger} onClick={() => { void run.end(); }}>
              <Square aria-hidden size={13} />
              Stop
            </button>
          ) : (
            <button type="button" className={buttonStyles.secondary} disabled={status.kind === 'starting'} onClick={onRunAgain}>
              <Play aria-hidden size={13} />
              Run again
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
