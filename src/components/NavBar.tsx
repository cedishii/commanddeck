import { House, Search, Settings, SquareTerminal, Terminal, type LucideIcon } from 'lucide-react';
import logoUrl from '../assets/logo-64.png';
import { PAGES, type PageId } from '../app/pages';
import { searchKeyLabel, useSettings } from '../app/settings';

interface NavBarProps {
  readonly current: PageId;
  readonly onNavigate: (page: PageId) => void;
  readonly onSearch?: () => void;
}

const ICONS: Record<PageId, LucideIcon> = {
  home: House,
  cmd: Terminal,
  powershell: SquareTerminal,
  settings: Settings,
};

function NavButton({ page, current, onNavigate }: { page: PageId; current: PageId; onNavigate: (page: PageId) => void }) {
  const meta = PAGES[page];
  const Icon = ICONS[page];
  const active = page === current;
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-keyshortcuts={`Control+${meta.shortcutKey}`}
      title={`${meta.label} (Ctrl+${meta.shortcutKey})`}
      onClick={() => { onNavigate(page); }}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors ${
        active ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <Icon aria-hidden size={16} className={active ? 'text-accent' : undefined} />
      {meta.label}
    </button>
  );
}

/**
 * Placeholder for the privilege indicator. Real detection via the Windows
 * token arrives in Phase 4. Until then it says so instead of guessing.
 */
function PrivilegeBadge() {
  return (
    <span
      className="inline-flex h-6 items-center rounded-md border border-dashed border-border px-2 text-xs text-muted"
      title="Administrator detection arrives in Phase 4"
      data-testid="privilege-badge"
    >
      Privilege: not checked yet
    </span>
  );
}

export function NavBar({ current, onNavigate, onSearch }: NavBarProps) {
  const searchKey = useSettings().settings.searchShortcut;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2 pr-2">
        <img src={logoUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-md" />
        <span className="text-sm font-semibold tracking-tight">CommandDeck</span>
      </div>
      <nav aria-label="Primary" className="flex flex-1 items-center gap-1">
        <NavButton page="home" current={current} onNavigate={onNavigate} />
        <NavButton page="cmd" current={current} onNavigate={onNavigate} />
        <NavButton page="powershell" current={current} onNavigate={onNavigate} />
        <div className="ml-auto flex items-center gap-2">
          {onSearch ? (
            <button
              type="button"
              onClick={onSearch}
              aria-keyshortcuts={`Control+${searchKey.toUpperCase()}`}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-sm text-muted hover:text-fg"
            >
              <Search aria-hidden size={14} />
              Search
              <kbd className="font-mono text-xs">{searchKeyLabel(searchKey)}</kbd>
            </button>
          ) : null}
          {/* Advanced Mode badge slot (Phase 4) */}
          <PrivilegeBadge />
          <NavButton page="settings" current={current} onNavigate={onNavigate} />
        </div>
      </nav>
    </header>
  );
}
