import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FIXTURE_COMMANDS, command, installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';

async function quickActions() {
  return screen.findByRole('list', { name: 'Quick actions' });
}

function names(list: HTMLElement) {
  return within(list).getAllByTestId('command-row').map((r) => within(r).getAllByRole('button')[0]?.textContent);
}

describe('HomePage', () => {
  it('loads quick actions from the backend and shows the count', async () => {
    installFakeBackend();
    renderApp();
    const list = await quickActions();
    expect(within(list).getAllByTestId('command-row')).toHaveLength(3);
    expect(screen.getByText('3 of 10')).toBeInTheDocument();
  });

  it('shows an empty state with an Add button when Home is empty', async () => {
    installFakeBackend({ home: [] });
    const { user } = renderApp();
    expect(await screen.findByText('No quick actions yet')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add command' })[1] as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Add a command to Home' })).toBeInTheDocument();
  });

  it('shows an error state and recovers on retry', async () => {
    const backend = installFakeBackend();
    backend.failNext('home_get', { kind: 'storage', message: 'Storage error: disk full' });
    const { user } = renderApp();
    const heading = await screen.findByText("Couldn't load your quick actions");
    const alert = heading.closest('[role="alert"]') as HTMLElement;
    expect(alert).toHaveTextContent('disk full');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await quickActions()).toBeInTheDocument();
  });

  it('reorders with the row menu', async () => {
    installFakeBackend();
    const { user } = renderApp();
    const list = await quickActions();
    expect(names(list)).toEqual(['Check network connectivity', 'View network configuration', 'View running processes']);
    await user.click(within(list).getByRole('button', { name: 'More actions for Check network connectivity' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => { expect(names(list)[0]).toBe('View network configuration'); });
    await user.click(within(list).getByRole('button', { name: 'More actions for View running processes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move to top' }));
    await waitFor(() => { expect(names(list)).toEqual(['View running processes', 'View network configuration', 'Check network connectivity']); });
  });

  it('disables impossible moves', async () => {
    installFakeBackend();
    const { user } = renderApp();
    const list = await quickActions();
    await user.click(within(list).getByRole('button', { name: 'More actions for Check network connectivity' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
  });

  it('renames a quick action without changing the command', async () => {
    const backend = installFakeBackend();
    const { user } = renderApp();
    const list = await quickActions();
    await user.click(within(list).getByRole('button', { name: 'More actions for Check network connectivity' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename quick action' });
    await user.type(within(dialog).getByLabelText('Display name'), 'Is Google up?');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(list).findByRole('button', { name: 'Is Google up?' })).toBeInTheDocument();
    expect(within(list).getByText('ping google.com')).toBeInTheDocument();
    expect(backend.callsTo('home_update')[0]).toEqual({ id: 'cmd.ping', label: 'Is Google up?', note: null });
  });

  it('removes from Home via the menu, keeping the catalog entry', async () => {
    const backend = installFakeBackend();
    const { user } = renderApp();
    const list = await quickActions();
    await user.click(within(list).getByRole('button', { name: 'More actions for View running processes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from Home' }));
    await waitFor(() => { expect(within(list).getAllByTestId('command-row')).toHaveLength(2); });
    expect(backend.state.commands.some((c) => c.id === 'ps.get-process')).toBe(true);
    expect(await screen.findByText('"View running processes" removed from Home')).toBeInTheDocument();
  });

  it('adds a command through the search palette', async () => {
    installFakeBackend();
    const { user } = renderApp();
    await quickActions();
    await user.click(screen.getByRole('button', { name: 'Add command' }));
    await user.type(screen.getByRole('combobox'), 'tasklist');
    await screen.findByRole('option', { name: /List running processes/ });
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(screen.getByText('4 of 10')).toBeInTheDocument(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("shows the backend's limit error and keeps the palette open when Home is full", async () => {
    const backend = installFakeBackend();
    const { user } = renderApp();
    await quickActions();
    backend.failNext('home_add', { kind: 'limit', message: 'Home is full (10 of 10). Remove a quick action or raise the limit to 15 in Settings.' });
    await user.click(screen.getByRole('button', { name: 'Add command' }));
    await user.type(screen.getByRole('combobox'), 'tasklist');
    await screen.findByRole('option', { name: /List running processes/ });
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Home is full/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add a command to Home' })).toBeInTheDocument();
  });

  it('disables Add when Home is at its limit', async () => {
    const ids = ['cmd.ping', 'cmd.ipconfig.all', 'cmd.ipconfig.flushdns', 'cmd.tasklist', 'cmd.format.quick', 'ps.get-process', 'ps.clear-dns-cache'];
    const extra = Array.from({ length: 3 }, (_, i) => ({ id: `cmd.extra${i}`, name: `Extra ${i}` }));
    installFakeBackend({ commands: [...FIXTURE_COMMANDS, ...extra.map((e) => command(e))], home: [...ids, ...extra.map((e) => e.id)] });
    renderApp();
    await quickActions();
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add command' })).toBeDisabled();
  });
});
