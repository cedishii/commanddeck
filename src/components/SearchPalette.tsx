import { Search } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAppContext, type SearchMode } from '../app/context';
import { SHELL_LABEL, type Shell } from '../domain/command';
import { useAsync } from '../hooks/useAsync';
import { useCommandActions } from '../hooks/useCommandActions';
import { useDialog } from '../hooks/useDialog';
import { api } from '../ipc/api';
import type { CommandView } from '../ipc/types';
import { copyText } from '../lib/clipboard';
import { AdminBadge, CustomBadge, MultiStepBadge, RiskBadge, ShellBadge } from './ui/Badge';

interface SearchPaletteProps {
  readonly mode: SearchMode;
  readonly onClose: () => void;
}

type ShellFilter = 'all' | Shell;

const DEBOUNCE_MS = 120;

interface Group {
  readonly title: string;
  readonly items: readonly CommandView[];
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(value); }, ms);
    return () => { window.clearTimeout(t); };
  }, [value, ms]);
  return debounced;
}

/**
 * Ctrl+K command search. Enter opens details (or adds to Home in "add" mode),
 * Ctrl+Enter copies the command, Alt+Enter adds it to Home.
 */
export function SearchPalette({ mode, onClose }: SearchPaletteProps) {
  const { openDetails, revision, notify } = useAppContext();
  const actions = useCommandActions();
  const [query, setQuery] = useState('');
  const [shell, setShell] = useState<ShellFilter>('all');
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const onDialogKeyDown = useDialog(dialogRef, onClose, inputRef);
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);

  const load = useCallback(async (): Promise<Group[]> => {
    const filter = shell === 'all' ? undefined : shell;
    if (debounced) {
      const results = await api.search(debounced, filter, 25);
      return [{ title: 'Results', items: results.map((r) => r.command) }];
    }
    const [recents, all] = await Promise.all([api.recents(), api.listCommands(filter)]);
    const keep = (c: CommandView) => filter === undefined || c.shell === filter;
    return [
      { title: 'Recent', items: recents.filter(keep).slice(0, 6) },
      { title: 'Favorites', items: all.filter((c) => c.favorite) },
    ].filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision refreshes favorites/on-Home state
  }, [debounced, shell, revision]);
  const { state } = useAsync(load);

  const groups = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  /** Index of each group's first option in `flat`. */
  const offsets = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    for (const g of groups) {
      out.push(n);
      n += g.items.length;
    }
    return out;
  }, [groups]);
  const activeIndex = Math.min(active, Math.max(flat.length - 1, 0));
  const activeItem = flat[activeIndex];

  const choose = (c: CommandView) => {
    if (mode === 'addToHome') {
      void actions.addToHome(c).then((ok) => { if (ok) onClose(); });
    } else {
      onClose();
      openDetails(c.id);
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      if (event.ctrlKey) {
        copyText(activeItem.syntax).then(
          () => {
            actions.recordUse(activeItem);
            notify('Command copied');
          },
          () => { notify('Copy failed', 'error'); },
        );
      } else if (event.altKey) {
        void actions.addToHome(activeItem);
      } else {
        choose(activeItem);
      }
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-[var(--cd-overlay)]" aria-hidden onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'addToHome' ? 'Add a command to Home' : 'Search commands'}
        onKeyDown={onDialogKeyDown}
        className="relative flex max-h-[70vh] w-[min(680px,94vw)] flex-col rounded-xl border border-border bg-surface shadow-[var(--cd-shadow)]"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search aria-hidden size={18} className="text-muted" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeItem ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-label="Search commands"
            placeholder={mode === 'addToHome' ? 'Find a command to add to Home…' : 'Search by name, alias or what you want to do…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          <div role="group" aria-label="Shell filter" className="flex rounded-md border border-border p-0.5 text-xs">
            {(['all', 'cmd', 'powershell'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={shell === s}
                onClick={() => {
                  setShell(s);
                  setActive(0);
                  inputRef.current?.focus();
                }}
                className={`rounded px-2 py-1 ${shell === s ? 'bg-accent-soft font-medium text-fg' : 'text-muted hover:text-fg'}`}
              >
                {s === 'all' ? 'All' : SHELL_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div id={listId} role="listbox" aria-label="Commands">
            {groups.map((g, gi) => (
              <div key={g.title} role="group" aria-label={g.title} className="mb-2">
                <div className="px-2 py-1 text-xs font-semibold tracking-wide text-muted uppercase" aria-hidden>{g.title}</div>
                {g.items.map((c, ci) => {
                  const i = (offsets[gi] ?? 0) + ci;
                  const selected = i === activeIndex;
                  return (
                    <div
                      key={`${g.title}-${c.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => { if (!selected) setActive(i); }}
                      onClick={() => { choose(c); }}
                      className={`cursor-pointer rounded-lg px-3 py-2 ${selected ? 'bg-accent-soft' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                        <ShellBadge shell={c.shell} />
                        {c.source === 'custom' ? <CustomBadge /> : null}
                        {c.multiStep ? <MultiStepBadge /> : null}
                        {c.risk !== 'L1' ? <RiskBadge risk={c.risk} /> : null}
                        {c.requiresAdmin ? <AdminBadge /> : null}
                        {mode === 'addToHome' && c.onHome ? <span className="text-xs text-muted">On Home</span> : null}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[12px] text-muted">{c.syntax}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {state.status === 'ready' && flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              {debounced ? `No commands match "${debounced}". Try describing the task, e.g. "flush dns".` : 'Type to search. Recent and favorite commands appear here.'}
            </p>
          ) : null}
          {state.status === 'error' ? <p role="alert" className="px-3 py-6 text-center text-sm text-danger">{state.error.message}</p> : null}
        </div>

        <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted">
          <span><kbd className="font-mono">↑↓</kbd> move</span>
          <span><kbd className="font-mono">Enter</kbd> {mode === 'addToHome' ? 'add to Home' : 'details'}</span>
          <span><kbd className="font-mono">Ctrl+Enter</kbd> copy</span>
          {mode === 'browse' ? <span><kbd className="font-mono">Alt+Enter</kbd> add to Home</span> : null}
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
