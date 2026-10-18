import { SquareTerminal } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { CommandList } from '../components/CommandList';
import { DetailPanel } from '../components/DetailPanel';
import { PageHeader } from '../components/PageHeader';
import { SampleBadge } from '../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StatusMessage';
import { loadSampleLibrary, type LibraryLoader } from '../data/sampleSource';
import { categoriesFor } from '../domain/categories';
import { SHELL_LABEL, type CategoryId, type CommandEntry, type Shell } from '../domain/command';
import { useAsync } from '../hooks/useAsync';

interface ShellPageProps {
  readonly shell: Shell;
  readonly load?: LibraryLoader;
}

const DESCRIPTION: Record<Shell, string> = {
  cmd: 'Command Prompt library and session.',
  powershell: 'PowerShell library and session. Cmdlets, not CMD commands.',
};

const EXECUTABLE: Record<Shell, string> = {
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
};

type Filter = 'all' | CategoryId;

export function ShellPage({ shell, load = loadSampleLibrary }: ShellPageProps) {
  const loadForShell = useCallback(() => load(shell), [load, shell]);
  const { state, retry } = useAsync(loadForShell);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<CommandEntry | null>(null);
  const label = SHELL_LABEL[shell];
  const categories = categoriesFor(shell);

  const entries = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const counts = useMemo(() => {
    const map = new Map<CategoryId, number>();
    for (const e of entries) map.set(e.category, (map.get(e.category) ?? 0) + 1);
    return map;
  }, [entries]);
  const visible = filter === 'all' ? entries : entries.filter((e) => e.category === filter);
  const filterLabel = filter === 'all' ? 'All commands' : categories.find((c) => c.id === filter)?.label ?? filter;

  const filterButton = (id: Filter, text: string, count: number) => (
    <li key={id}>
      <button
        type="button"
        aria-current={filter === id ? 'true' : undefined}
        onClick={() => { setFilter(id); }}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
          filter === id ? 'bg-accent-soft font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
        }`}
      >
        <span className="min-w-0 truncate">{text}</span>
        <span className="text-xs tabular-nums">{count}</span>
      </button>
    </li>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface px-2 py-4">
        <nav aria-label={`${label} categories`}>
          <ul className="space-y-0.5">
            {filterButton('all', 'All commands', entries.length)}
            {categories.map((c) => filterButton(c.id, c.label, counts.get(c.id) ?? 0))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-5">
          <div>
            <PageHeader title={label} description={DESCRIPTION[shell]} aside={<SampleBadge />} />
            <h2 className="mb-2 text-sm font-semibold text-muted">{filterLabel}</h2>

            {state.status === 'loading' ? <LoadingState label={`Loading ${label} commands…`} /> : null}
            {state.status === 'error' ? (
              <ErrorState title={`Couldn't load the ${label} library`} message={state.error.message} onRetry={retry} />
            ) : null}
            {state.status === 'ready' && visible.length === 0 ? (
              <EmptyState title="Nothing in this category yet">The verified catalog arrives in Phase 2.</EmptyState>
            ) : null}
            {state.status === 'ready' && visible.length > 0 ? (
              <CommandList entries={visible} label={`${label} commands`} onOpenDetails={setSelected} />
            ) : null}
          </div>

          <section aria-labelledby={`${shell}-session-title`} className="rounded-lg border border-dashed border-border p-4">
            <div className="flex items-start gap-3">
              <SquareTerminal aria-hidden size={20} className="mt-0.5 text-muted" />
              <div>
                <h2 id={`${shell}-session-title`} className="font-medium">{label} session</h2>
                <p className="text-sm text-muted">
                  A live, persistent {EXECUTABLE[shell]} session runs here from Phase 3, through Windows ConPTY. Not available yet.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {selected ? <DetailPanel entry={selected} onClose={() => { setSelected(null); }} /> : null}
    </div>
  );
}
