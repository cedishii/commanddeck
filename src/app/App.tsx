import { useEffect, useMemo, useRef, useState } from 'react';
import { NavBar } from '../components/NavBar';
import { useGlobalShortcuts, type ShortcutMap } from '../hooks/useGlobalShortcuts';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { ShellPage } from '../pages/ShellPage';
import { PAGES, PAGE_TITLE_ID, type PageId } from './pages';

export function App() {
  const [page, setPage] = useState<PageId>('home');
  const previousPage = useRef(page);

  const shortcuts = useMemo<ShortcutMap>(
    () => Object.fromEntries(Object.values(PAGES).map((p) => [p.shortcutKey, () => { setPage(p.id); }])),
    [],
  );
  useGlobalShortcuts(shortcuts);

  // Move focus to the new page's title so keyboard and screen-reader users land in the content.
  // Compares against the previous page (not a first-render flag) so StrictMode's double effect run doesn't steal focus on startup.
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    document.getElementById(PAGE_TITLE_ID)?.focus();
  }, [page]);

  return (
    <div className="flex h-full flex-col">
      <NavBar current={page} onNavigate={setPage} />
      <main className="min-h-0 flex-1 overflow-y-auto" aria-label={PAGES[page].label}>
        {page === 'home' ? <HomePage /> : null}
        {page === 'cmd' ? <ShellPage key="cmd" shell="cmd" /> : null}
        {page === 'powershell' ? <ShellPage key="powershell" shell="powershell" /> : null}
        {page === 'settings' ? <SettingsPage /> : null}
      </main>
    </div>
  );
}
