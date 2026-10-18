import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../app/theme';

/** Renders inside the app providers and returns a user-event instance (which also stubs the clipboard). */
export function renderApp(ui: ReactElement): RenderResult & { user: UserEvent } {
  const user = userEvent.setup();
  return { user, ...render(<ThemeProvider>{ui}</ThemeProvider>) };
}
