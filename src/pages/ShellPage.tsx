import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useAppContext } from '../app/context';
import { CommandList } from '../components/CommandList';
import { PageHeader } from '../components/PageHeader';
import { buttonStyles } from '../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StatusMessage';
import { categoriesFor } from '../domain/categories';
import { SHELL_LABEL, type CategoryId, type Shell } from '../domain/command';
import { useAsync } from '../hooks/useAsync';
import { api } from '../ipc/api';
import { TerminalPanel, type PanelSize } from '../terminal/TerminalPanel';

interface ShellPageProps {
  readonly shell: Shell;
  readonly active: boolean;
  readonly pending: { readonly text: string; readonly nonce: number } | null;
  readonly onPendingConsumed: () => void;
}

const DESCRIPTION: Record<Shell, string> = {
  cmd: 'Command Prompt library and session.',
  powershell: 'PowerShell library and session. Cmdlets, not CMD commands.',
};

type Filter = 'all' | 'favorites' | 'custom' | CategoryId;

export function ShellPage({ shell, active, pending, onPendingConsumed }: ShellPageProps) {
  const [terminalSize, setTerminalSize] = useState<PanelSize>('normal');
  const { revision, openEditor, openSearch } = useAppContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers a refetch after changes
  const load = useCallback(() => api.listCommands(shell), [shell, revision]);
  const { state, retry } = useAsync(load);
  const [filter, setFilter] = useState<Filter>('all');
  const label = SHELL_LABEL[shell];
  const categories = categoriesFor(shell);

  const entries = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.category, (map.get(e.category) ?? 0) + 1);
      if (e.favorite) map.set('favorites', (map.get('favorites') ?? 0) + 1);
      if (e.source === 'custom') map.set('custom', (map.get('custom') ?? 0) + 1);
    }
    return map;
  }, [entries]);
  const visible = entries.filter((e) =>
    filter === 'all' ? true : filter === 'favorites' ? e.favorite : filter === 'custom' ? e.source === 'custom' : e.category === filter,
  );
  const filterLabel =
    filter === 'all'
      ? 'All commands'
      : filter === 'favorites'
        ? 'Favorites'
        : filter === 'custom'
          ? 'My commands'
          : (categories.find((c) => c.id === filter)?.label ?? filter);

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
        <span className="min-w-0 truncate" title={text}>{text}</span>
        <span className="text-xs tabular-nums">{count}</span>
      </button>
    </li>
  );

  const emptyMessage =
    filter === 'favorites'
      ? 'Star a command to add it to your favorites.'
      : filter === 'custom'
        ? 'Create your own shortcuts for commands you use often.'
        : 'No commands in this category yet.';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1" hidden={terminalSize === 'maximized'}>
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface px-2 py-4">
        <nav aria-label={`${label} categories`}>
          <ul className="space-y-0.5">
            {filterButton('all', 'All commands', entries.length)}
            {filterButton('favorites', 'Favorites', counts.get('favorites') ?? 0)}
            {filterButton('custom', 'My commands', counts.get('custom') ?? 0)}
          </ul>
          <div className="mx-2.5 my-2 border-t border-border" />
          <ul className="space-y-0.5">{categories.map((c) => filterButton(c.id, c.label, counts.get(c.id) ?? 0))}</ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-5">
          <div>
            <PageHeader
              title={label}
              description={DESCRIPTION[shell]}
              aside={
                <>
                  <button type="button" className={buttonStyles.secondary} onClick={() => { openSearch('browse'); }} title="Search all commands (Ctrl+K)">
                    Search
                    <kbd className="font-mono text-xs text-muted">Ctrl+K</kbd>
                  </button>
                  <button type="button" className={buttonStyles.secondary} onClick={() => { openEditor({ mode: 'create', shell }); }}>
                    <Plus aria-hidden size={15} />
                    New command
                  </button>
                </>
              }
            />
            <h2 className="mb-2 text-sm font-semibold text-muted">{filterLabel}</h2>

            {state.status === 'loading' ? <LoadingState label={`Loading ${label} commands…`} /> : null}
            {state.status === 'error' ? (
              <ErrorState title={`Couldn't load the ${label} library`} message={state.error.message} onRetry={retry} />
            ) : null}
            {state.status === 'ready' && visible.length === 0 ? <EmptyState title="Nothing here yet">{emptyMessage}</EmptyState> : null}
            {state.status === 'ready' && visible.length > 0 ? <CommandList entries={visible} label={`${label} commands`} /> : null}
          </div>

        </div>
      </div>
      </div>

      <TerminalPanel
        shell={shell}
        active={active}
        size={terminalSize}
        onSizeChange={setTerminalSize}
        pending={pending}
        onPendingConsumed={onPendingConsumed}
      />
    </div>
  );
}
