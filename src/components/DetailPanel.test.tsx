import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FIXTURE_COMMANDS, command, installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';
import { docLabel } from './DetailPanel';

async function openFromHome(name: string) {
  const r = renderApp();
  const list = await screen.findByRole('list', { name: 'Quick actions' });
  const opener = within(list).getByRole('button', { name });
  await r.user.click(opener);
  const dialog = await screen.findByRole('dialog', { name });
  return { ...r, opener, dialog };
}

describe('DetailPanel', () => {
  it('opens from a row, shows the details, closes with Esc and returns focus', async () => {
    installFakeBackend();
    const { user, opener, dialog } = await openFromHome('View network configuration');
    expect(within(dialog).getByRole('button', { name: 'Close details' })).toHaveFocus();
    expect(dialog.querySelector('pre')?.textContent).toBe('ipconfig /all');
    expect(within(dialog).getByText('Works as a standard user.')).toBeInTheDocument();
    expect(within(dialog).getByText('Read-only. It does not change anything.')).toBeInTheDocument();
    expect(within(dialog).getByText('Full details.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab focus inside the panel', async () => {
    installFakeBackend();
    const { user, dialog } = await openFromHome('Check network connectivity');
    const close = within(dialog).getByRole('button', { name: 'Close details' });
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(close).not.toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it('toggles favorite and Home membership through the backend', async () => {
    const backend = installFakeBackend();
    const { user, dialog } = await openFromHome('Check network connectivity');
    await user.click(within(dialog).getByRole('button', { name: 'Favorite' }));
    expect(await within(dialog).findByRole('button', { name: 'Favorited' })).toHaveAttribute('aria-pressed', 'true');
    expect(backend.state.favorites.has('cmd.ping')).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Remove from Home' }));
    expect(await within(dialog).findByRole('button', { name: 'Add to Home' })).toBeInTheDocument();
    expect(backend.state.home.some((h) => h.id === 'cmd.ping')).toBe(false);
  });

  it('saves personal aliases and shows backend validation errors', async () => {
    const backend = installFakeBackend();
    const { user, dialog } = await openFromHome('Check network connectivity');
    const input = within(dialog).getByLabelText(/Extra words that find this command/);
    await user.clear(input);
    await user.type(input, 'bad;alias');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText("'bad;alias' is not allowed")).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    await user.type(input, 'isup, google');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(backend.state.aliases.get('cmd.ping')).toEqual(['isup', 'google']); });
  });

  it('opens documentation through the backend with an index, never a raw URL', async () => {
    const backend = installFakeBackend();
    const { user, dialog } = await openFromHome('Check network connectivity');
    await user.click(within(dialog).getByRole('button', { name: /learn\.microsoft\.com · ping/ }));
    expect(backend.callsTo('catalog_open_source')).toEqual([{ id: 'cmd.ping', index: 0 }]);
  });

  it('records a recent use when the command is copied', async () => {
    const backend = installFakeBackend();
    const { user, dialog } = await openFromHome('Check network connectivity');
    await user.click(within(dialog).getByRole('button', { name: 'Copy command for Check network connectivity' }));
    await waitFor(() => { expect(backend.state.recents).toEqual(['cmd.ping']); });
    expect(await navigator.clipboard.readText()).toBe('ping google.com');
  });

  it('lists placeholders and labels high-impact admin commands', async () => {
    installFakeBackend({ home: ['cmd.format.quick'] });
    const { dialog } = await openFromHome('Format a drive');
    expect(within(dialog).getByText('<Drive>')).toBeInTheDocument();
    expect(within(dialog).getByText('High impact')).toBeInTheDocument();
    expect(within(dialog).getByText(/Requires administrator rights/)).toBeInTheDocument();
  });

  it('deletes a custom command after confirmation', async () => {
    const custom = command({ id: 'custom.1', name: 'Git branches', source: 'custom', shell: 'powershell', category: 'automation', syntax: 'git branch -a' });
    const backend = installFakeBackend({ commands: [...FIXTURE_COMMANDS, custom], home: ['custom.1'] });
    const { user, dialog } = await openFromHome('Git branches');
    expect(within(dialog).getByText(/This risk level is your own description/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete custom command?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(backend.state.commands.some((c) => c.id === 'custom.1')).toBe(false);
    expect(await screen.findByText('No quick actions yet')).toBeInTheDocument();
  });

  it('shows an error state if the command cannot be loaded', async () => {
    const backend = installFakeBackend();
    const r = renderApp();
    const list = await screen.findByRole('list', { name: 'Quick actions' });
    backend.failNext('catalog_get', { kind: 'notFound', message: "Unknown command 'cmd.ping'." });
    await r.user.click(within(list).getByRole('button', { name: 'Check network connectivity' }));
    expect(await screen.findByText("Couldn't load this command")).toBeInTheDocument();
  });

  it('formats documentation labels', () => {
    expect(docLabel('https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ipconfig')).toBe('learn.microsoft.com · ipconfig');
    expect(docLabel('not a url')).toBe('not a url');
  });
});
