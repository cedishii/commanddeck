/**
 * Test stand-in for XtermView (jsdom can't render xterm.js). It records what
 * the app writes to the "screen" and lets tests type into it.
 */
import { useEffect, useImperativeHandle, type Ref } from 'react';
import type { TerminalHandle } from '../terminal/XtermView';

export const terminals: { label: string; screen: string; type: (data: string) => void }[] = [];

export function XtermView({
  handleRef,
  ariaLabel,
  onData,
  onAppShortcut,
}: {
  handleRef: Ref<TerminalHandle | null>;
  ariaLabel: string;
  onData?: (data: string) => void;
  onAppShortcut?: (event: KeyboardEvent) => boolean;
}) {
  const entry = { label: ariaLabel, screen: '', type: (data: string) => { onData?.(data); } };
  useImperativeHandle(handleRef, () => ({
    write: (data) => {
      const found = terminals.find((t) => t.label === ariaLabel);
      if (found) found.screen += typeof data === 'string' ? data : new TextDecoder().decode(data);
    },
    focus: () => undefined,
    clear: () => { const found = terminals.find((t) => t.label === ariaLabel); if (found) found.screen = ''; },
    reset: () => { const found = terminals.find((t) => t.label === ariaLabel); if (found) found.screen = ''; },
    size: () => ({ cols: 100, rows: 30 }),
  }));
  useEffect(() => {
    terminals.push(entry);
    return () => {
      const i = terminals.indexOf(entry);
      if (i >= 0) terminals.splice(i, 1);
    };
    // Register once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Like the real view: app shortcuts are offered first; nothing else is handled here.
  return <div data-terminal="" role="group" aria-label={ariaLabel} data-testid="xterm" onKeyDown={(e) => { onAppShortcut?.(e.nativeEvent); }} />;
}

export function screenOf(label: string): string {
  return terminals.find((t) => t.label === label)?.screen ?? '';
}

export function typeInto(label: string, data: string): void {
  terminals.find((t) => t.label === label)?.type(data);
}
