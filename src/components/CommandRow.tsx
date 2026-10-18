import { House, Info, Play, Star } from 'lucide-react';
import { useAppContext } from '../app/context';
import type { CommandEntry } from '../domain/command';
import { useCommandActions } from '../hooks/useCommandActions';
import { AdminBadge, CustomBadge, MultiStepBadge, RiskBadge, ShellBadge } from './ui/Badge';
import { Menu, type MenuItem } from './ui/Menu';
import { SyntaxPreview } from './SyntaxPreview';

interface CommandRowProps {
  readonly entry: CommandEntry;
  readonly index: number;
  readonly showShell?: boolean;
  /** Personal display label (Home). Never changes what the command does. */
  readonly label?: string | null;
  readonly note?: string | null;
  /** Extra menu entries shown before the defaults (e.g. reorder on Home). */
  readonly menuItems?: readonly MenuItem[];
}

const iconButton = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg';

/**
 * [#] [Description] [Risk/Admin] [Syntax] [Actions]
 *
 * Wide windows (≥1024px) use one line. Narrower windows move the syntax to a
 * second line. Routine (L1) commands show no risk badge, keeping lists free
 * of noise. The details panel always shows the risk.
 */
export function CommandRow({ entry, index, showShell = false, label, note, menuItems = [] }: CommandRowProps) {
  const { openDetails } = useAppContext();
  const actions = useCommandActions();
  const title = label ?? entry.name;

  const items: MenuItem[] = [
    ...menuItems,
    entry.onHome
      ? { label: 'Remove from Home', icon: <House size={15} />, onSelect: () => { void actions.removeFromHome(entry); } }
      : { label: 'Add to Home', icon: <House size={15} />, onSelect: () => { void actions.addToHome(entry); } },
    { label: 'Details', icon: <Info size={15} />, onSelect: () => { openDetails(entry.id); } },
  ];

  return (
    <li
      className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2.5 lg:grid-cols-[2rem_minmax(12rem,1fr)_auto_minmax(0,1.5fr)_auto]"
      data-testid="command-row"
    >
      <span className="pt-0.5 text-right font-mono text-sm text-muted tabular-nums">{index}</span>

      <div className="min-w-0">
        <button
          type="button"
          className="text-left font-medium text-fg hover:underline"
          onClick={() => { openDetails(entry.id); }}
          title={label ? `Your label. Catalog name: ${entry.name}` : undefined}
        >
          {title}
        </button>
        <p className="line-clamp-2 text-[13px] text-muted">{note ?? entry.summary}</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1 pt-0.5 lg:justify-start">
        {showShell ? <ShellBadge shell={entry.shell} /> : null}
        {entry.source === 'custom' ? <CustomBadge /> : null}
        {entry.multiStep ? <MultiStepBadge /> : null}
        {entry.risk !== 'L1' ? <RiskBadge risk={entry.risk} /> : null}
        {entry.requiresAdmin ? <AdminBadge /> : null}
      </div>

      <div className="max-lg:col-start-2 max-lg:col-end-5 max-lg:row-start-2 min-w-0">
        <SyntaxPreview syntax={entry.syntax} label={title} onCopied={() => { actions.recordUse(entry); }} />
      </div>

      <div className="flex items-center gap-0.5 max-lg:col-start-4 max-lg:row-start-1">
        <button
          type="button"
          className={iconButton}
          aria-label={`Favorite ${title}`}
          aria-pressed={entry.favorite}
          title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => { void actions.toggleFavorite(entry); }}
        >
          <Star aria-hidden size={15} className={entry.favorite ? 'fill-current text-risk2-fg' : undefined} />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={`Details for ${title}`}
          title="Details"
          onClick={() => { openDetails(entry.id); }}
        >
          <Info aria-hidden size={16} />
        </button>
        <Menu label={`More actions for ${title}`} items={items} />
        <button
          type="button"
          aria-disabled="true"
          className="ml-1 inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted"
          aria-label={`Run ${title} (not available yet)`}
          title="Running commands arrives in Phase 3"
        >
          <Play aria-hidden size={13} />
          Run
        </button>
      </div>
    </li>
  );
}
