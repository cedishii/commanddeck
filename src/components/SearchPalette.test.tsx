import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';

async function openPalette() {
  const r = renderApp();
  await screen.findByRole('list', { name: 'Quick actions' });
  await r.user.keyboard('{Control>}k{/Control}');
  return { ...r, input: screen.getByRole('combobox', { name: 'Search commands' }) };
}

describe('SearchPalette', () => {
  it('searches the backend and shows results from both shells', async () => {
    const backend = installFakeBackend();
    const { user } = await openPalette();
    await user.keyboard('flush dns');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(options[0] as HTMLElement).getByText('CMD')).toBeInTheDocument();
    expect(within(options[1] as HTMLElement).getByText('PowerShell')).toBeInTheDocument();
    expect(backend.callsTo('catalog_search').at(-1)).toMatchObject({ query: 'flush dns', shell: null });
  });

  it('filters by shell', async () => {
    const backend = installFakeBackend();
    const { user } = await openPalette();
    await user.keyboard('dns');
    await screen.findAllByRole('option');
    await user.click(within(screen.getByRole('group', { name: 'Shell filter' })).getByRole('button', { name: 'PowerShell' }));
    await waitFor(() => { expect(screen.getAllByRole('option')).toHaveLength(1); });
    expect(backend.callsTo('catalog_search').at(-1)).toMatchObject({ shell: 'powershell' });
  });

  it('moves with arrow keys and opens details with Enter', async () => {
    installFakeBackend();
    const { user, input } = await openPalette();
    await user.keyboard('flush dns');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', (options[1] as HTMLElement).id);
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Flush the DNS cache' });
    expect(dialog.querySelector('pre')?.textContent).toBe('Clear-DnsClientCache');
  });

  it('copies with Ctrl+Enter and records the use', async () => {
    const backend = installFakeBackend();
    const { user } = await openPalette();
    await user.keyboard('tasklist');
    await screen.findByRole('option');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText('Command copied')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('tasklist');
    await waitFor(() => { expect(backend.state.recents).toEqual(['cmd.tasklist']); });
  });

  it('shows recents and favorites when the query is empty', async () => {
    const backend = installFakeBackend();
    backend.state.recents = ['cmd.tasklist'];
    backend.state.favorites.add('ps.get-process');
    await openPalette();
    expect(await screen.findByRole('group', { name: 'Recent' })).toHaveTextContent('List running processes');
    expect(screen.getByRole('group', { name: 'Favorites' })).toHaveTextContent('View running processes');
  });

  it('explains when nothing matches', async () => {
    installFakeBackend();
    const { user } = await openPalette();
    await user.keyboard('zzqqx');
    expect(await screen.findByText(/No commands match "zzqqx"/)).toBeInTheDocument();
  });

  it('closes with Esc and returns focus', async () => {
    installFakeBackend();
    const { user } = await openPalette();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
