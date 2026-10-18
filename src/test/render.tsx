import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { App } from '../app/App';
import { AppContext, type AppContextValue } from '../app/context';
import { SettingsProvider } from '../app/settings';
import { ThemeProvider } from '../app/theme';

type Rendered = RenderResult & { user: UserEvent };

/** Renders the whole app (all overlays and providers). Install a fake backend first. */
export function renderApp(): Rendered {
  const user = userEvent.setup();
  return { user, ...render(<ThemeProvider><SettingsProvider><App /></SettingsProvider></ThemeProvider>) };
}

/** Renders a component with a stub app context. Returns the context's spies. */
export function renderWithContext(ui: ReactElement, overrides: Partial<AppContextValue> = {}): Rendered & { context: AppContextValue } {
  const user = userEvent.setup();
  const context: AppContextValue = {
    revision: 0,
    invalidate: vi.fn(),
    notify: vi.fn(),
    navigate: vi.fn(),
    openDetails: vi.fn(),
    openSearch: vi.fn(),
    openEditor: vi.fn(),
    openInTerminal: vi.fn(),
    runCommand: vi.fn(),
    elevated: false,
    security: { passwordSet: false, policy: { highImpact: true, restartAsAdmin: true, advancedMode: true }, advancedMode: false },
    restartAsAdmin: vi.fn(),
    ...overrides,
  };
  return {
    user,
    context,
    ...render(
      <ThemeProvider>
        <SettingsProvider>
          <AppContext.Provider value={context}>{ui}</AppContext.Provider>
        </SettingsProvider>
      </ThemeProvider>,
    ),
  };
}
