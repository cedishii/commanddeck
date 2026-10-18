import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PAGES } from '../app/pages';
import { useTheme, type ThemePreference } from '../app/theme';
import { PageHeader } from '../components/PageHeader';

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: `Ctrl+${PAGES.home.shortcutKey}`, action: 'Go to Home' },
  { keys: `Ctrl+${PAGES.cmd.shortcutKey}`, action: 'Go to CMD' },
  { keys: `Ctrl+${PAGES.powershell.shortcutKey}`, action: 'Go to PowerShell' },
  { keys: `Ctrl+${PAGES.settings.shortcutKey}`, action: 'Open Settings' },
  { keys: 'Esc', action: 'Close the details panel' },
];

export function SettingsPage() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-5">
      <PageHeader
        title="Settings"
        description="More settings (quick-action count, execution, security) arrive with their features."
      />

      <Card title="Appearance" description={`Currently showing the ${resolved} theme.`}>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Theme</legend>
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <label
                key={value}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--cd-focus)] ${
                  preference === value ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={preference === value}
                  onChange={() => { setPreference(value); }}
                  className="sr-only"
                />
                <Icon aria-hidden size={15} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card title="Keyboard shortcuts" description="Customizable shortcuts arrive in Phase 5.">
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr><th>Keys</th><th>Action</th></tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-t border-border first:border-t-0">
                <td className="py-1.5 pr-4"><kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd></td>
                <td className="py-1.5 text-muted">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="About">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Version</dt><dd>0.1.0 (Phase 1 foundation)</dd>
          <dt className="text-muted">Author</dt><dd>Cedrick Kaneko</dd>
          <dt className="text-muted">Privacy</dt><dd>Runs entirely on this PC. No accounts, telemetry or network access.</dd>
        </dl>
      </Card>
    </div>
  );
}
