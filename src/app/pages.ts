export type PageId = 'home' | 'cmd' | 'powershell' | 'settings';

export interface PageMeta {
  readonly id: PageId;
  readonly label: string;
  /** Ctrl+<key> shortcut. */
  readonly shortcutKey: string;
}

export const PAGES: Record<PageId, PageMeta> = {
  home: { id: 'home', label: 'Home', shortcutKey: '1' },
  cmd: { id: 'cmd', label: 'CMD', shortcutKey: '2' },
  powershell: { id: 'powershell', label: 'PowerShell', shortcutKey: '3' },
  settings: { id: 'settings', label: 'Settings', shortcutKey: ',' },
};

/**
 * All pages stay mounted (terminal sessions and scroll positions survive
 * navigation). Inactive ones are `hidden`, so this finds the visible title.
 */
export function focusPageTitle(): void {
  document.querySelector<HTMLElement>('[data-page]:not([hidden]) h1')?.focus();
}
