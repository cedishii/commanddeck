import { Info, Play } from 'lucide-react';
import type { CommandEntry } from '../domain/command';
import { AdminBadge, RiskBadge, ShellBadge } from './ui/Badge';
import { SyntaxPreview } from './SyntaxPreview';

interface CommandRowProps {
  readonly entry: CommandEntry;
  readonly index: number;
  readonly showShell?: boolean;
  readonly onOpenDetails: (entry: CommandEntry) => void;
}

/**
 * [#] [Description] [Risk/Admin] [Syntax] [Actions]
 *
 * Wide windows (≥1024px) use one line. Narrower windows move the syntax to a
 * second line so the description stays readable. Routine (L1) commands show
 * no risk badge, keeping Home free of noise. The details panel always shows
 * the risk level.
 */
export function CommandRow({ entry, index, showShell = false, onOpenDetails }: CommandRowProps) {
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
          onClick={() => { onOpenDetails(entry); }}
        >
          {entry.name}
        </button>
        <p className="line-clamp-2 text-[13px] text-muted">{entry.summary}</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1 pt-0.5 lg:justify-start">
        {showShell ? <ShellBadge shell={entry.shell} /> : null}
        {entry.risk !== 'L1' ? <RiskBadge risk={entry.risk} /> : null}
        {entry.requiresAdmin ? <AdminBadge /> : null}
      </div>

      <div className="max-lg:col-start-2 max-lg:col-end-5 max-lg:row-start-2 min-w-0">
        <SyntaxPreview syntax={entry.syntax} label={entry.name} />
      </div>

      <div className="flex items-center gap-1 max-lg:col-start-4 max-lg:row-start-1">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          aria-label={`Details for ${entry.name}`}
          title="Details"
          onClick={() => { onOpenDetails(entry); }}
        >
          <Info aria-hidden size={16} />
        </button>
        <button
          type="button"
          aria-disabled="true"
          className="inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted"
          aria-label={`Run ${entry.name} (not available yet)`}
          title="Running commands arrives in Phase 3"
        >
          <Play aria-hidden size={13} />
          Run
        </button>
      </div>
    </li>
  );
}
