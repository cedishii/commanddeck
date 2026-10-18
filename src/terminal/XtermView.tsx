import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { copyText } from '../lib/clipboard';

export interface TerminalHandle {
  write: (data: Uint8Array | string) => void;
  focus: () => void;
  clear: () => void;
  reset: () => void;
  size: () => { cols: number; rows: number };
}

interface XtermViewProps {
  readonly handleRef: Ref<TerminalHandle | null>;
  readonly ariaLabel: string;
  /** Keystrokes and pastes, forwarded verbatim to the shell. */
  readonly onData?: (data: string) => void;
  readonly onResize?: (cols: number, rows: number) => void;
  /** Return true to consume an app-reserved key combination (it then never reaches the shell). */
  readonly onAppShortcut?: (event: KeyboardEvent) => boolean;
  readonly fontSize?: number;
  /** xterm.js accessibility tree for screen readers (costs some performance). */
  readonly screenReaderMode?: boolean;
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

function readTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const theme: Record<string, string> = {
    background: v('--cd-term-bg'),
    foreground: v('--cd-term-fg'),
    cursor: v('--cd-term-cursor'),
    selectionBackground: v('--cd-term-selection'),
  };
  v('--cd-ansi').split(/\s+/).forEach((color, i) => {
    const key = ANSI_KEYS[i];
    if (key && color) theme[key] = color;
  });
  return theme;
}

/**
 * xterm.js terminal. Keys go to the shell unmodified except:
 * Ctrl+C with a selection (copy), Ctrl+Shift+C (copy), Ctrl+V / Ctrl+Shift+V (paste),
 * and the documented app shortcuts passed via `onAppShortcut`.
 */
export function XtermView({ handleRef, ariaLabel, onData, onResize, onAppShortcut, fontSize = 13, screenReaderMode = false }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initial = useRef({ fontSize, screenReaderMode });
  const callbacks = useRef({ onData, onResize, onAppShortcut });
  useEffect(() => {
    callbacks.current = { onData, onResize, onAppShortcut };
  }, [onData, onResize, onAppShortcut]);

  useImperativeHandle(handleRef, () => ({
    write: (data) => { termRef.current?.write(data); },
    focus: () => { termRef.current?.focus(); },
    clear: () => { termRef.current?.clear(); },
    reset: () => { termRef.current?.reset(); },
    size: () => ({ cols: termRef.current?.cols ?? 80, rows: termRef.current?.rows ?? 24 }),
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: initial.current.fontSize,
      screenReaderMode: initial.current.screenReaderMode,
      cursorBlink: true,
      scrollback: 5000,
      theme: readTheme(),
      // Programs pick ANSI colors without knowing our background (e.g. PSReadLine prints
      // members in "white", invisible on a light theme). Lift any color below WCAG AA.
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (callbacks.current.onAppShortcut?.(event)) return false;
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === 'c' && (event.shiftKey || term.hasSelection())) {
        const text = term.getSelection();
        if (text) void copyText(text).catch(() => undefined);
        term.clearSelection();
        return false;
      }
      // Let the browser's paste event deliver clipboard text instead of sending ^V.
      if (ctrl && key === 'v') return false;
      return true;
    });
    const dataSub = term.onData((d) => { callbacks.current.onData?.(d); });
    const resizeSub = term.onResize(({ cols, rows }) => { callbacks.current.onResize?.(cols, rows); });

    const refit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(container);
    const themeObserver = new MutationObserver(() => { term.options.theme = readTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Preference changes apply live; the session keeps running.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.screenReaderMode = screenReaderMode;
    const container = containerRef.current;
    if (container && container.clientWidth > 0 && container.clientHeight > 0) fitRef.current?.fit();
  }, [fontSize, screenReaderMode]);

  return <div ref={containerRef} data-terminal="" role="group" aria-label={ariaLabel} className="h-full w-full overflow-hidden bg-[var(--cd-term-bg)] p-1" />;
}
