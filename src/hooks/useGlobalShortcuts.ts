import { useEffect } from 'react';

export type ShortcutMap = Readonly<Record<string, () => void>>;

/**
 * App-level Ctrl+<key> shortcuts. Keys are matched on `event.key`.
 *
 * Phase 3 note: when a terminal has focus, shell input takes priority. This
 * hook will then skip events originating inside a terminal, except for the
 * documented app shortcuts (docs/SECURITY.md §6.1).
 */
export function useGlobalShortcuts(shortcuts: ShortcutMap): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing) return;
      const action = shortcuts[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [shortcuts]);
}
