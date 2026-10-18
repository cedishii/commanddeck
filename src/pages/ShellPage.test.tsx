import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FIXTURE_COMMANDS, command, installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';

async function goTo(shortcut: '2' | '3', listName: string) {
  const r = renderApp();
  await screen.findByRole('list', { name: 'Quick actions' });
  await r.user.keyboard(`{Control>}${shortcut}{/Control}`);
  return { ...r, list: await screen.findByRole('list', { name: listName }) };
}

describe('ShellPage', () => {
  it('lists only CMD commands on the CMD page', async () => {
    const backend = installFakeBackend();
    const { list } = await goTo('2', 'CMD commands');
    expect(within(list).getByText('ipconfig /all')).toBeInTheDocument();
    expect(within(list).queryByText('Get-Process')).not.toBeInTheDocument();
    expect(backend.callsTo('catalog_list')).toContainEqual({ shell: 'cmd' });
  });

  it('lists only PowerShell commands on the PowerShell page', async () => {
    installFakeBackend();
    const { list } = await goTo('3', 'PowerShell commands');
    expect(within(list).getByText('Get-Process')).toBeInTheDocument();
    expect(within(list).queryByText('ipconfig /all')).not.toBeInTheDocument();
  });

  it('filters by category and shows an empty state for empty categories', async () => {
    installFakeBackend();
    const { user } = await goTo('2', 'CMD commands');
    const categories = screen.getByRole('navigation', { name: 'CMD categories' });
    await user.click(within(categories).getByRole('button', { name: /^Processes/ }));
    const list = screen.getByRole('list', { name: 'CMD commands' });
    expect(within(list).getAllByTestId('command-row')).toHaveLength(1);
    expect(within(list).getByText('tasklist')).toBeInTheDocument();
    await user.click(within(categories).getByRole('button', { name: /^Security and Diagnostics/ }));
    expect(screen.getByText('No commands in this category yet.')).toBeInTheDocument();
  });

  it('filters favorites and custom commands', async () => {
    const custom = command({ id: 'custom.1', name: 'My backup', source: 'custom', category: 'files', syntax: 'robocopy a b /E' });
    const backend = installFakeBackend({ commands: [...FIXTURE_COMMANDS, custom] });
    backend.state.favorites.add('cmd.tasklist');
    const { user } = await goTo('2', 'CMD commands');
    const categories = screen.getByRole('navigation', { name: 'CMD categories' });
    await user.click(within(categories).getByRole('button', { name: /^Favorites/ }));
    expect(within(screen.getByRole('list', { name: 'CMD commands' })).getAllByTestId('command-row')).toHaveLength(1);
    await user.click(within(categories).getByRole('button', { name: /^My commands/ }));
    const list = screen.getByRole('list', { name: 'CMD commands' });
    expect(within(list).getByText('My backup')).toBeInTheDocument();
    expect(within(list).getByText('Custom')).toBeInTheDocument();
  });

  it('stars a command and updates the Favorites count', async () => {
    installFakeBackend();
    const { user, list } = await goTo('2', 'CMD commands');
    const star = within(list).getByRole('button', { name: 'Favorite List running processes' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    await waitFor(() => { expect(within(list).getByRole('button', { name: 'Favorite List running processes' })).toHaveAttribute('aria-pressed', 'true'); });
    const categories = screen.getByRole('navigation', { name: 'CMD categories' });
    expect(within(categories).getByRole('button', { name: /^Favorites/ })).toHaveTextContent('1');
  });

});
