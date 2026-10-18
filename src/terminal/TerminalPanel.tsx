import { ChevronDown, ChevronUp, Eraser, Maximize2, Minimize2, Play, Power, RotateCcw, SquareTerminal } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAppContext } from '../app/context';
import { useSettings } from '../app/settings';
import { buttonStyles } from '../components/ui/Modal';
import { SHELL_LABEL, type Shell } from '../domain/command';
import { api } from '../ipc/api';
import type { ShellKind } from '../ipc/types';
import { commandBarInput, useTerminalSession, type SessionStatus } from './useTerminalSession';
import { XtermView, type TerminalHandle } from './XtermView';

export type PanelSize = 'collapsed' | 'normal' | 'maximized';

interface TerminalPanelProps {
  readonly shell: Shell;
  /** The page is visible; the session starts the first time this is true. */
  readonly active: boolean;
  readonly size: PanelSize;
  readonly onSizeChange: (size: PanelSize) => void;
  /** Text placed into the command bar by "Open in terminal". */
  readonly pending: { readonly text: string; readonly nonce: number } | null;
  readonly onPendingConsumed: () => void;
}

const EXECUTABLE: Record<ShellKind, string> = { cmd: 'cmd.exe', powershell: 'powershell.exe', pwsh: 'pwsh.exe' };

function statusText(status: SessionStatus): string {
  switch (status.kind) {
    case 'idle':
      return 'Not started';
    case 'starting':
      return 'Starting…';
    case 'running':
      return `Running · PID ${status.pid}`;
    case 'exited':
      return `Ended · exit code ${status.code}`;
    case 'failed':
      return `Couldn't start: ${status.message}`;
  }
}

const iconButton = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40';

/** A live shell session (ConPTY) with a command bar. */
export function TerminalPanel({ shell, active, size, onSizeChange, pending, onPendingConsumed }: TerminalPanelProps) {
  const { openSearch, navigate } = useAppContext();
  const { settings, loaded } = useSettings();
  const searchCode = `Key${settings.searchShortcut.toUpperCase()}`;
  const terminal = useRef<TerminalHandle | null>(null);
  const barRef = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<ShellKind>(shell === 'cmd' ? 'cmd' : 'powershell');
  const [pwshAvailable, setPwshAvailable] = useState(false);
  const [bar, setBar] = useState('');
  const started = useRef(false);
  const barId = useId();
  const label = SHELL_LABEL[shell];

  const starter = useCallback(
    (cols: number, rows: number, onEvent: Parameters<typeof api.openSession>[3]) => api.openSession(kind, cols, rows, onEvent),
    [kind],
  );
  const session = useTerminalSession(terminal, starter);
  const running = session.status.kind === 'running';

  useEffect(() => {
    if (shell !== 'powershell') return;
    api.shells().then((s) => { setPwshAvailable(s.some((x) => x.id === 'pwsh' && x.available)); }, () => undefined);
  }, [shell]);

  useEffect(() => {
    // Waits for stored settings so "start sessions automatically: off" is respected on launch.
    if (!loaded || !settings.autoStartSessions) return;
    if (active && size !== 'collapsed' && !started.current) {
      started.current = true;
      void session.start();
    }
  }, [active, size, session, loaded, settings.autoStartSessions]);

  // Adopt "Open in terminal" text once per request (state adjusted during render, per React guidance).
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (pending && pending.nonce !== appliedNonce) {
    setAppliedNonce(pending.nonce);
    setBar(pending.text);
  }
  useEffect(() => {
    if (!pending) return;
    if (size === 'collapsed') onSizeChange('normal');
    onPendingConsumed();
    window.setTimeout(() => {
      const el = barRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  }, [pending, onPendingConsumed, onSizeChange, size]);

  // App shortcuts that work while the terminal has focus. Everything else goes to the shell.
  const onAppShortcut = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!(e.ctrlKey && e.shiftKey) || e.altKey) return false;
      if (e.code === searchCode) {
        openSearch('browse');
        return true;
      }
      if (e.code === 'KeyE') {
        barRef.current?.focus();
        return true;
      }
      const pages = { Digit1: 'home', Digit2: 'cmd', Digit3: 'powershell' } as const;
      const page = pages[e.code as keyof typeof pages] as (typeof pages)[keyof typeof pages] | undefined;
      if (page) {
        navigate(page);
        return true;
      }
      return false;
    },
    [openSearch, navigate, searchCode],
  );

  const send = () => {
    if (!bar.trim() || !running) return;
    if (session.write(commandBarInput(bar))) setBar('');
  };

  const onBarKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const heightClass = size === 'maximized' ? 'flex-1 min-h-0' : size === 'normal' ? 'h-[45%] min-h-[220px]' : '';

  return (
    <section aria-labelledby={`${barId}-title`} className={`flex shrink-0 flex-col border-t border-border bg-surface ${heightClass}`}>
      <header className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <SquareTerminal aria-hidden size={16} className="text-muted" />
        <h2 id={`${barId}-title`} className="text-sm font-semibold">{label} session</h2>
        <span role="status" className={`text-xs ${session.status.kind === 'failed' ? 'text-danger' : 'text-muted'}`}>
          {statusText(session.status)}
        </span>
        {shell === 'powershell' && pwshAvailable ? (
          <label className="ml-2 flex items-center gap-1 text-xs text-muted">
            Shell
            <select
              className="rounded border border-border bg-surface px-1 py-0.5 text-xs"
              value={kind}
              onChange={(e) => { setKind(e.target.value as ShellKind); }}
              title="Applies to the next session (Restart)"
            >
              <option value="powershell">Windows PowerShell 5.1</option>
              <option value="pwsh">PowerShell 7</option>
            </select>
          </label>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {session.status.kind === 'idle' ? (
            <button type="button" className={iconButton} aria-label="Start session" title="Start session" onClick={() => { started.current = true; void session.start(); }}>
              <Play aria-hidden size={15} />
            </button>
          ) : (
            <button type="button" className={iconButton} aria-label="Restart session" title="Restart session" onClick={() => { void session.start(); }}>
              <RotateCcw aria-hidden size={15} />
            </button>
          )}
          <button type="button" className={iconButton} aria-label="End session" title="End session (stops everything it started)" disabled={!running} onClick={() => { void session.end(); }}>
            <Power aria-hidden size={15} />
          </button>
          <button type="button" className={iconButton} aria-label="Clear screen" title="Clear screen" onClick={() => { terminal.current?.clear(); }}>
            <Eraser aria-hidden size={15} />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={size === 'maximized' ? 'Restore terminal size' : 'Maximize terminal'}
            onClick={() => { onSizeChange(size === 'maximized' ? 'normal' : 'maximized'); }}
          >
            {size === 'maximized' ? <Minimize2 aria-hidden size={15} /> : <Maximize2 aria-hidden size={15} />}
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={size === 'collapsed' ? 'Show terminal' : 'Hide terminal'}
            aria-expanded={size !== 'collapsed'}
            onClick={() => { onSizeChange(size === 'collapsed' ? 'normal' : 'collapsed'); }}
          >
            {size === 'collapsed' ? <ChevronUp aria-hidden size={15} /> : <ChevronDown aria-hidden size={15} />}
          </button>
        </div>
      </header>

      <div className={size === 'collapsed' ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        <div className="min-h-0 flex-1 border-y border-border">
          <XtermView
            handleRef={terminal}
            ariaLabel={`${label} terminal`}
            onData={(d) => { session.write(d); }}
            onResize={session.resize}
            onAppShortcut={onAppShortcut}
            fontSize={settings.terminalFontSize}
            screenReaderMode={settings.terminalScreenReader}
          />
        </div>
        <div className="flex items-start gap-2 px-3 py-2">
          <label htmlFor={barId} className="sr-only">Command bar</label>
          <textarea
            ref={barRef}
            id={barId}
            rows={Math.min(6, Math.max(1, bar.split('\n').length))}
            value={bar}
            onChange={(e) => { setBar(e.target.value); }}
            onKeyDown={onBarKeyDown}
            spellCheck={false}
            disabled={!running}
            placeholder={running ? `Type a command for ${EXECUTABLE[kind]} and press Enter (Shift+Enter: new line)` : 'Start the session to type commands'}
            className="min-h-8 flex-1 resize-none rounded-md border border-border bg-code-bg px-2 py-1.5 font-mono text-[13px] text-code-fg disabled:opacity-60"
          />
          <button type="button" className={buttonStyles.primary} disabled={!running || !bar.trim()} onClick={send}>Run</button>
        </div>
        <p className="px-3 pb-2 text-xs text-muted">
          This is the real {EXECUTABLE[kind]}. CommandDeck doesn’t check or change what you type here. In the terminal: Ctrl+Shift+E moves to the command bar, Ctrl+Shift+{settings.searchShortcut.toUpperCase()} searches.
        </p>
      </div>
    </section>
  );
}
