import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../ipc/types';
import { installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';
import { mediaState } from '../test/setup';

async function openSettings() {
  const r = renderApp();
  await r.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  return r;
}

describe('theme', () => {
  it('follows the system theme by default', async () => {
    mediaState.dark = true;
    installFakeBackend();
    await openSettings();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the theme stored in the backend on startup', async () => {
    installFakeBackend({ settings: { theme: 'dark' } });
    renderApp();
    await waitFor(() => { expect(document.documentElement.dataset.theme).toBe('dark'); });
  });

  it('applies a choice immediately and saves it to the backend', async () => {
    const backend = installFakeBackend();
    const { user } = await openSettings();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await waitFor(() => { expect(backend.state.settings.theme).toBe('dark'); });
    expect(window.localStorage.getItem('commanddeck.theme')).toBe('dark');
  });

  it('ignores a corrupted cached value', async () => {
    window.localStorage.setItem('commanddeck.theme', '{not-a-theme');
    installFakeBackend();
    await openSettings();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });
});

describe('SettingsPage', () => {
  it('changes the quick-action limit', async () => {
    const backend = installFakeBackend();
    const { user } = await openSettings();
    await user.click(await screen.findByRole('radio', { name: '15' }));
    await waitFor(() => { expect(backend.state.settings.quickActionLimit).toBe(15); });
    expect(await screen.findByText('Home now holds up to 15 quick actions')).toBeInTheDocument();
  });

  it('reports a refused limit change', async () => {
    const backend = installFakeBackend({ settings: { quickActionLimit: 15 } });
    const { user } = await openSettings();
    backend.failNext('settings_update', { kind: 'limit', message: 'Home has 12 quick actions. Remove 2 before lowering the limit to 10.' });
    await user.click(await screen.findByRole('radio', { name: '10' }));
    expect(await screen.findByText(/Remove 2 before lowering/)).toBeInTheDocument();
  });

  it('exports custom commands as text', async () => {
    installFakeBackend();
    const { user } = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Export custom commands' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export custom commands' });
    expect(within(dialog).getByLabelText('Exported commands')).toHaveValue(
      JSON.stringify({ format: 'commanddeck.custom-commands', version: 1, commands: [] }, null, 2),
    );
  });

  it('shows per-field import errors', async () => {
    const backend = installFakeBackend();
    const { user } = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Import custom commands' }));
    const dialog = screen.getByRole('dialog', { name: 'Import custom commands' });
    backend.failNext('custom_import', {
      kind: 'validation',
      message: 'Some fields are invalid',
      fields: [{ field: 'commands[0].name', message: 'is required' }],
    });
    await user.type(within(dialog).getByLabelText('Commands to import'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await within(dialog).findByText('commands[0].name: is required')).toBeInTheDocument();
  });

  it('clears recents and resets preferences after confirmation', async () => {
    const backend = installFakeBackend({ settings: { theme: 'dark', quickActionLimit: 15 } });
    backend.state.recents = ['cmd.ping'];
    const { user } = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Clear recent commands' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Clear recent commands?' })).getByRole('button', { name: 'Clear' }));
    await waitFor(() => { expect(backend.state.recents).toEqual([]); });

    await user.click(screen.getByRole('button', { name: 'Reset preferences' }));
    const confirm = screen.getByRole('dialog', { name: 'Reset preferences?' });
    expect(confirm).toHaveTextContent('Your custom commands, favorites, aliases, run history, app password and Advanced Mode are kept.');
    await user.click(within(confirm).getByRole('button', { name: 'Reset' }));
    await waitFor(() => { expect(backend.state.settings).toEqual(DEFAULT_SETTINGS); });
    expect(await screen.findByText('Preferences reset')).toBeInTheDocument();
  });
});
