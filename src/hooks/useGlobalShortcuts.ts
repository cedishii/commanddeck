import { useEffect } from 'react';

export type ShortcutMap = Readonly<Record<string, () => void>>;

/**
 * App-level Ctrl+<key> shortcuts, matched on `event.key`.
 *
 * Ignored while a terminal has focus: keys typed there belong to the shell
 * (docs/SECURITY.md §6.1). Terminals offer Ctrl+Shift alternatives instead.
 */
export function useGlobalShortcuts(shortcuts: ShortcutMap): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('[data-terminal]')) return;
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
