import { CircleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomCommandEditor } from '../components/CustomCommandEditor';
import { DetailPanel } from '../components/DetailPanel';
import { NavBar } from '../components/NavBar';
import { SearchPalette } from '../components/SearchPalette';
import { Toasts, type Toast } from '../components/ui/Toasts';
import { useAsync } from '../hooks/useAsync';
import { useGlobalShortcuts, type ShortcutMap } from '../hooks/useGlobalShortcuts';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { CommandView, Shell } from '../ipc/types';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { ShellPage } from '../pages/ShellPage';
import { RunPanel } from '../terminal/RunPanel';
import { AppContext, type AppContextValue, type EditorTarget, type SearchMode, type ToastTone } from './context';
import { PAGES, focusPageTitle, type PageId } from './pages';
import { useSettings } from './settings';

const TOAST_MS = 4000;

type Pending = Record<Shell, { readonly text: string; readonly nonce: number } | null>;

function StartupFailure({ message }: { message: string }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-lg border border-border bg-surface p-6">
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden className="mt-0.5 text-danger" size={20} />
        <div>
          <h1 className="font-semibold">CommandDeck couldn’t start</h1>
          <p className="mt-1 text-sm">{message}</p>
          <p className="mt-3 text-sm text-muted">Nothing was deleted. Close and reopen the app after fixing the problem.</p>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<PageId>('home');
  const previousPage = useRef(page);
  const [revision, setRevision] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchMode | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [running, setRunning] = useState<CommandView | null>(null);
  const [pending, setPending] = useState<Pending>({ cmd: null, powershell: null });
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const toastId = useRef(0);
  const { state: startup } = useAsync(api.startup);
  const { settings } = useSettings();
  const searchKey = settings.searchShortcut;

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    window.setTimeout(() => { setToasts((t) => t.filter((x) => x.id !== id)); }, TOAST_MS);
  }, []);

  const context = useMemo<AppContextValue>(
    () => ({
      revision,
      invalidate: () => { setRevision((r) => r + 1); },
      notify,
      navigate: (p) => { setPage(p); },
      openDetails: (id) => { setDetailId(id); },
      openSearch: (mode = 'browse') => { setSearch(mode); },
      openEditor: (target) => {
        setDetailId(null);
        setEditor(target);
      },
      openInTerminal: (command) => {
        setDetailId(null);
        setSearch(null);
        setPending((p) => ({ ...p, [command.shell]: { text: command.syntax, nonce: Date.now() } }));
        setPage(command.shell);
      },
      runCommand: (command) => {
        setDetailId(null);
        setSearch(null);
        setRunning(command);
      },
    }),
    [revision, notify],
  );

  const consumeCmd = useCallback(() => { setPending((p) => ({ ...p, cmd: null })); }, []);
  const consumePs = useCallback(() => { setPending((p) => ({ ...p, powershell: null })); }, []);

  const overlayOpen = detailId !== null || search !== null || editor !== null || running !== null;

  const shortcuts = useMemo<ShortcutMap>(() => {
    if (overlayOpen) return {};
    const map: Record<string, () => void> = Object.fromEntries(Object.values(PAGES).map((p) => [p.shortcutKey, () => { setPage(p.id); }]));
    map[searchKey] = () => { setSearch('browse'); };
    return map;
  }, [overlayOpen, searchKey]);
  useGlobalShortcuts(shortcuts);

  // Move focus to the new page's title so keyboard and screen-reader users land in the content.
  // Compares against the previous page (not a first-render flag) so StrictMode's double effect run doesn't steal focus on startup.
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    focusPageTitle();
  }, [page]);

  const fatal = startup.status === 'error' && startup.error instanceof BackendError && startup.error.kind !== 'unavailable' ? startup.error : null;
  const notice = startup.status === 'ready' && !noticeDismissed ? startup.data.notice : null;

  return (
    <AppContext.Provider value={context}>
      <div className="flex h-full flex-col">
        <NavBar current={page} onNavigate={setPage} onSearch={() => { setSearch('browse'); }} />
        {notice ? (
          <div role="status" className="flex items-start gap-2 border-b border-border bg-risk2-bg px-4 py-2 text-sm text-risk2-fg">
            <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0" />
            <p className="flex-1">{notice}</p>
            <button type="button" aria-label="Dismiss notice" onClick={() => { setNoticeDismissed(true); }}>
              <X aria-hidden size={16} />
            </button>
          </div>
        ) : null}
        <main className="min-h-0 flex-1" aria-label={PAGES[page].label}>
          {fatal ? (
            <StartupFailure message={fatal.message} />
          ) : (
            <>
              {/* Pages stay mounted so terminal sessions and scroll positions survive navigation. */}
              <section data-page="home" hidden={page !== 'home'} className="h-full overflow-y-auto">
                <HomePage />
              </section>
              <section data-page="cmd" hidden={page !== 'cmd'} className="h-full">
                <ShellPage shell="cmd" active={page === 'cmd'} pending={pending.cmd} onPendingConsumed={consumeCmd} />
              </section>
              <section data-page="powershell" hidden={page !== 'powershell'} className="h-full">
                <ShellPage shell="powershell" active={page === 'powershell'} pending={pending.powershell} onPendingConsumed={consumePs} />
              </section>
              <section data-page="settings" hidden={page !== 'settings'} className="h-full overflow-y-auto">
                <SettingsPage />
              </section>
            </>
          )}
        </main>
      </div>

      {search ? <SearchPalette mode={search} onClose={() => { setSearch(null); }} /> : null}
      {detailId ? <DetailPanel key={detailId} id={detailId} onClose={() => { setDetailId(null); }} /> : null}
      {editor ? <CustomCommandEditor target={editor} onClose={() => { setEditor(null); }} /> : null}
      {running ? <RunPanel key={running.id} command={running} onClose={() => { setRunning(null); }} /> : null}
      <Toasts toasts={toasts} onDismiss={(id) => { setToasts((t) => t.filter((x) => x.id !== id)); }} />
    </AppContext.Provider>
  );
}
