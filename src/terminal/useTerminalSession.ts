import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api, decodeOutput } from '../ipc/api';
import type { PtyEvent, SessionInfo } from '../ipc/types';
import type { TerminalHandle } from './XtermView';

export type SessionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running'; readonly pid: number }
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'failed'; readonly message: string };

type Starter = (cols: number, rows: number, onEvent: (e: PtyEvent) => void) => Promise<SessionInfo>;

/**
 * Connects an xterm view to one backend process (an interactive shell or a
 * one-off run). Restarting starts a fresh process; events from an old one are
 * ignored. Unmounting kills the process.
 */
export function useTerminalSession(terminal: RefObject<TerminalHandle | null>, starter: Starter) {
  const [status, setStatus] = useState<SessionStatus>({ kind: 'idle' });
  const session = useRef<number | null>(null);
  const generation = useRef(0);
  const starterRef = useRef(starter);
  useEffect(() => {
    starterRef.current = starter;
  }, [starter]);

  const stop = useCallback(async () => {
    const id = session.current;
    session.current = null;
    if (id !== null) await api.closeSession(id).catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    await stop();
    generation.current += 1;
    const gen = generation.current;
    // Mutated by the event callback, possibly before `starter` resolves.
    const run = { exited: false };
    terminal.current?.reset();
    setStatus({ kind: 'starting' });
    const { cols, rows } = terminal.current?.size() ?? { cols: 80, rows: 24 };
    try {
      const info = await starterRef.current(cols, rows, (event) => {
        if (gen !== generation.current) return;
        if (event.kind === 'output') {
          terminal.current?.write(decodeOutput(event.data));
        } else {
          run.exited = true;
          session.current = null;
          setStatus({ kind: 'exited', code: event.code });
        }
      });
      if (gen !== generation.current) {
        await api.closeSession(info.sessionId).catch(() => undefined);
        return;
      }
      if (!run.exited) {
        session.current = info.sessionId;
        setStatus({ kind: 'running', pid: info.pid });
      }
    } catch (error: unknown) {
      if (gen === generation.current) setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, [stop, terminal]);

  /** Sends input exactly as given. Returns false if there's no running session. */
  const write = useCallback((data: string): boolean => {
    const id = session.current;
    if (id === null) return false;
    api.writeSession(id, data).catch(() => undefined);
    return true;
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const id = session.current;
    if (id !== null) api.resizeSession(id, cols, rows).catch(() => undefined);
  }, []);

  /** Kills the process tree. The exit event updates the status. */
  const end = useCallback(async () => {
    const id = session.current;
    if (id !== null) await api.closeSession(id).catch(() => undefined);
  }, []);

  useEffect(() => () => {
    generation.current += 1;
    void stop();
  }, [stop]);

  return { status, start, write, resize, end };
}

/** Bytes the command bar sends: the text as if typed, each line ended with Enter (CR). */
export function commandBarInput(text: string): string {
  return `${text.replace(/\r?\n/g, '\r')}\r`;
}
