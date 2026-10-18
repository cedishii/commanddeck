import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';
import { App } from './App';
import { SettingsProvider } from './settings';
import { ThemeProvider } from './theme';

function nav() {
  return screen.getByRole('navigation', { name: 'Primary' });
}

function pageButtons() {
  return within(nav())
    .getAllByRole('button')
    .filter((b) => ['Home', 'CMD', 'PowerShell', 'Settings'].includes(b.textContent));
}

describe('App navigation', () => {
  it('shows Home, CMD, PowerShell then Settings, with Home active by default', async () => {
    installFakeBackend();
    renderApp();
    expect(pageButtons().map((b) => b.textContent)).toEqual(['Home', 'CMD', 'PowerShell', 'Settings']);
    expect(within(nav()).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('list', { name: 'Quick actions' })).toBeInTheDocument();
  });

  it('switches pages on click and moves aria-current', async () => {
    installFakeBackend();
    const { user } = renderApp();
    await user.click(within(nav()).getByRole('button', { name: 'CMD' }));
    expect(screen.getByRole('heading', { level: 1, name: 'CMD' })).toBeInTheDocument();
    expect(within(nav()).getByRole('button', { name: 'CMD' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('supports Ctrl+1/2/3, Ctrl+, and Ctrl+K', async () => {
    installFakeBackend();
    const { user } = renderApp();
    await user.keyboard('{Control>}2{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'CMD' })).toBeInTheDocument();
    await user.keyboard('{Control>}3{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'PowerShell' })).toBeInTheDocument();
    await user.keyboard('{Control>},{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    await user.keyboard('{Control>}1{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Search commands' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveFocus();
  });

  it('ignores page shortcuts while a dialog is open', async () => {
    installFakeBackend();
    const { user } = renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Control>}2{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves focus to the new page title after navigating', async () => {
    installFakeBackend();
    const { user } = renderApp();
    await user.keyboard('{Control>}3{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'PowerShell' })).toHaveFocus();
  });

  it('does not move focus on startup, even under StrictMode double effects (regression)', () => {
    installFakeBackend();
    userEvent.setup();
    render(
      <StrictMode>
        <ThemeProvider>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </ThemeProvider>
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

});

describe('Privilege', () => {
  it('shows the token state reported by the backend', async () => {
    installFakeBackend({ elevated: true });
    renderApp();
    await waitFor(() => { expect(screen.getByTestId('privilege-badge')).toHaveTextContent('Administrator'); });
  });

  it('restarts as administrator only after a plain-language confirmation, keeping the current page', async () => {
    const backend = installFakeBackend();
    const { user } = renderApp();
    await user.keyboard('{Control>}2{/Control}');
    await user.click(await screen.findByRole('button', { name: 'Standard user' }));
    const dialog = screen.getByRole('dialog', { name: 'Restart as administrator?' });
    expect(dialog).toHaveTextContent('The whole app will run with administrator rights until you close it');
    expect(dialog).toHaveTextContent('Open terminal sessions end');
    expect(backend.callsTo('restart_elevated')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Restart as administrator' }));
    await waitFor(() => { expect(backend.callsTo('restart_elevated')).toEqual([{ page: 'cmd', password: null }]); });
    expect(await screen.findByText('Restarting as administrator…')).toBeInTheDocument();
  });

  it('keeps running and says so when UAC is declined', async () => {
    installFakeBackend({ declineUac: true });
    const { user } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'Standard user' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restart as administrator' }));
    expect(await screen.findByText('Restart cancelled. CommandDeck is still running as a standard user.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('App startup', () => {
  it('shows the recovery notice when the database had to be replaced', async () => {
    installFakeBackend({ notice: 'Your saved data could not be read, so CommandDeck started fresh.' });
    const { user } = renderApp();
    expect(await screen.findByText(/started fresh/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText(/started fresh/)).not.toBeInTheDocument();
  });

  it('shows a clear error screen when the backend could not start', async () => {
    const backend = installFakeBackend();
    backend.failAlways('app_startup', { kind: 'internal', message: 'CommandDeck could not start: newer schema' });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'CommandDeck couldn’t start' })).toBeInTheDocument();
    expect(screen.getByText(/newer schema/)).toBeInTheDocument();
  });
});
