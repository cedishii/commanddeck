import { CircleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomCommandEditor } from '../components/CustomCommandEditor';
import { DetailPanel } from '../components/DetailPanel';
import { NavBar } from '../components/NavBar';
import { RestartAdminDialog } from '../components/RestartAdminDialog';
import { SearchPalette } from '../components/SearchPalette';
import { Toasts, type Toast } from '../components/ui/Toasts';
import { useAsync } from '../hooks/useAsync';
import { useGlobalShortcuts, type ShortcutMap } from '../hooks/useGlobalShortcuts';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { CommandView, Prepared, SecurityStatus, Shell } from '../ipc/types';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { ShellPage } from '../pages/ShellPage';
import { RunDialog } from '../terminal/RunDialog';
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
  // One-click runs: the dialog (values, confirmation), then the output panel.
  const [runFlow, setRunFlow] = useState<{ command: CommandView; nonce: number } | null>(null);
  const [running, setRunning] = useState<{ command: CommandView; prepared: Prepared; grant: string | null } | null>(null);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [pending, setPending] = useState<Pending>({ cmd: null, powershell: null });
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [restart, setRestart] = useState<{ reason: string | undefined } | null>(null);
  const toastId = useRef(0);
  const { state: startup } = useAsync(api.startup);
  const { settings } = useSettings();

  useEffect(() => {
    api.security().then(setSecurity, () => { /* unavailable: treated as unknown */ });
  }, [revision]);

  useEffect(() => {
    api.privilege().then(
      (p) => {
        setElevated(p.elevated);
        // After a restart as administrator, reopen the page the user was on. Nothing runs automatically.
        if (p.launchPage) setPage(p.launchPage);
      },
      () => { /* Backend unavailable: the badge stays "checking". */ },
    );
  }, []);
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
        setRunning(null);
        setRunFlow({ command, nonce: Date.now() });
      },
      elevated,
      security,
      restartAsAdmin: (reason) => {
        setDetailId(null);
        setRestart({ reason });
      },
    }),
    [revision, notify, elevated, security],
  );

  const consumeCmd = useCallback(() => { setPending((p) => ({ ...p, cmd: null })); }, []);
  const consumePs = useCallback(() => { setPending((p) => ({ ...p, powershell: null })); }, []);

  const overlayOpen = detailId !== null || search !== null || editor !== null || running !== null || runFlow !== null || restart !== null;

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
        <NavBar current={page} onNavigate={setPage} onSearch={() => { setSearch('browse'); }} elevated={elevated} advancedMode={security?.advancedMode ?? false} onRestartAdmin={() => { setRestart({ reason: undefined }); }} />
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
      {runFlow ? (
        <RunDialog
          key={runFlow.nonce}
          command={runFlow.command}
          onClose={() => { setRunFlow(null); }}
          onReady={(prepared, grant) => {
            setRunFlow(null);
            setRunning({ command: runFlow.command, prepared, grant });
          }}
        />
      ) : null}
      {running ? (
        <RunPanel
          key={running.prepared.prepareId}
          command={running.command}
          prepared={running.prepared}
          grant={running.grant}
          onClose={() => { setRunning(null); }}
          onRunAgain={() => { context.runCommand(running.command); }}
        />
      ) : null}
      {restart ? <RestartAdminDialog page={page} reason={restart.reason} needsPassword={!!security?.passwordSet && security.policy.restartAsAdmin} onClose={() => { setRestart(null); }} /> : null}
      <Toasts toasts={toasts} onDismiss={(id) => { setToasts((t) => t.filter((x) => x.id !== id)); }} />
    </AppContext.Provider>
  );
}
