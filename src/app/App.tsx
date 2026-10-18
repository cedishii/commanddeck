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
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { ShellPage } from '../pages/ShellPage';
import { AppContext, type AppContextValue, type EditorTarget, type SearchMode, type ToastTone } from './context';
import { PAGES, PAGE_TITLE_ID, type PageId } from './pages';

const TOAST_MS = 4000;

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
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const toastId = useRef(0);
  const { state: startup } = useAsync(api.startup);

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
      openDetails: (id) => { setDetailId(id); },
      openSearch: (mode = 'browse') => { setSearch(mode); },
      openEditor: (target) => {
        setDetailId(null);
        setEditor(target);
      },
    }),
    [revision, notify],
  );

  const overlayOpen = detailId !== null || search !== null || editor !== null;

  const shortcuts = useMemo<ShortcutMap>(() => {
    if (overlayOpen) return {};
    const map: Record<string, () => void> = Object.fromEntries(Object.values(PAGES).map((p) => [p.shortcutKey, () => { setPage(p.id); }]));
    map.k = () => { setSearch('browse'); };
    return map;
  }, [overlayOpen]);
  useGlobalShortcuts(shortcuts);

  // Move focus to the new page's title so keyboard and screen-reader users land in the content.
  // Compares against the previous page (not a first-render flag) so StrictMode's double effect run doesn't steal focus on startup.
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    document.getElementById(PAGE_TITLE_ID)?.focus();
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
        <main className="min-h-0 flex-1 overflow-y-auto" aria-label={PAGES[page].label}>
          {fatal ? <StartupFailure message={fatal.message} /> : null}
          {!fatal && page === 'home' ? <HomePage /> : null}
          {!fatal && page === 'cmd' ? <ShellPage key="cmd" shell="cmd" /> : null}
          {!fatal && page === 'powershell' ? <ShellPage key="powershell" shell="powershell" /> : null}
          {!fatal && page === 'settings' ? <SettingsPage /> : null}
        </main>
      </div>

      {search ? <SearchPalette mode={search} onClose={() => { setSearch(null); }} /> : null}
      {detailId ? <DetailPanel key={detailId} id={detailId} onClose={() => { setDetailId(null); }} /> : null}
      {editor ? <CustomCommandEditor target={editor} onClose={() => { setEditor(null); }} /> : null}
      <Toasts toasts={toasts} onDismiss={(id) => { setToasts((t) => t.filter((x) => x.id !== id)); }} />
    </AppContext.Provider>
  );
}
