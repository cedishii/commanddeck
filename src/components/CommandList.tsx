import type { CommandEntry } from '../domain/command';
import { CommandRow } from './CommandRow';

interface CommandListProps {
  readonly entries: readonly CommandEntry[];
  readonly label: string;
  readonly showShell?: boolean;
  readonly onOpenDetails: (entry: CommandEntry) => void;
}

export function CommandList({ entries, label, showShell = false, onOpenDetails }: CommandListProps) {
  return (
    <ol aria-label={label} className="space-y-2">
      {entries.map((entry, i) => (
        <CommandRow key={entry.id} entry={entry} index={i + 1} showShell={showShell} onOpenDetails={onOpenDetails} />
      ))}
    </ol>
  );
}
