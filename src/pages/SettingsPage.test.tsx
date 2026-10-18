import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Settings } from '../ipc/types';
import { installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';

async function openSettings(settings: Partial<Settings> = {}, history: HistoryEntry[] = []) {
  const backend = installFakeBackend({ settings, history });
  const r = renderApp();
  await screen.findByRole('list', { name: 'Quick actions' });
  await r.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  const page = screen.getByRole('main');
  return { ...r, backend, page };
}

function entry(partial: Partial<HistoryEntry> & Pick<HistoryEntry, 'id' | 'name'>): HistoryEntry {
  return { commandId: `cmd.${partial.name}`, startedAt: Date.UTC(2026, 9, 18, 10), durationMs: 250, exitCode: 0, shell: 'cmd', exists: true, ...partial };
}

describe('Settings: appearance and terminal', () => {
  it('applies density immediately and saves it', async () => {
    const { user, backend, page } = await openSettings();
    expect(document.documentElement.dataset.density).toBe('comfortable');
    await user.click(within(page).getByRole('radio', { name: 'Compact' }));
    await waitFor(() => { expect(document.documentElement.dataset.density).toBe('compact'); });
    expect(backend.state.settings.density).toBe('compact');
  });

  it('applies terminal font size and screen reader mode to running terminals without restarting them', async () => {
    const { user, backend, page } = await openSettings();
    await user.keyboard('{Control>}2{/Control}');
    await waitFor(() => { expect(backend.callsTo('pty_open')).toHaveLength(1); });
    await user.keyboard('{Control>},{/Control}');

    await user.selectOptions(within(page).getByLabelText('Font size'), '16');
    await user.click(within(page).getByRole('checkbox', { name: /Screen reader support/ }));
    await waitFor(() => { expect(backend.state.settings).toMatchObject({ terminalFontSize: 16, terminalScreenReader: true }); });

    // The CMD page is hidden while Settings is shown, but its terminal keeps running.
    const term = within(screen.getByRole('region', { name: 'CMD session', hidden: true })).getByTestId('xterm');
    expect(term).toHaveAttribute('data-font-size', '16');
    expect(term).toHaveAttribute('data-screen-reader', 'on');
    expect(backend.callsTo('pty_open')).toHaveLength(1);
  });

  it('respects "start sessions automatically: off" and offers Start session instead', async () => {
    const backend = installFakeBackend({ settings: { autoStartSessions: false } });
    const { user } = renderApp();
    await screen.findByRole('list', { name: 'Quick actions' });
    await user.keyboard('{Control>}2{/Control}');
    const panel = screen.getByRole('region', { name: 'CMD session' });
    expect(await within(panel).findByText('Not started')).toBeInTheDocument();
    expect(backend.callsTo('pty_open')).toHaveLength(0);

    await user.click(within(panel).getByRole('button', { name: 'Start session' }));
    await waitFor(() => { expect(backend.callsTo('pty_open')).toHaveLength(1); });
    expect(await within(panel).findByRole('button', { name: 'Restart session' })).toBeInTheDocument();
  });
});

describe('Settings: search shortcut', () => {
  it('moves search to the chosen key everywhere and frees Ctrl+K', async () => {
    const { user, backend, page } = await openSettings();
    await user.click(within(page).getByRole('radio', { name: 'Ctrl+P' }));
    await waitFor(() => { expect(backend.state.settings.searchShortcut).toBe('p'); });

    expect(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name: /Search/ })).toHaveTextContent('Ctrl+P');
    expect(within(page).getByRole('table')).toHaveTextContent('Ctrl+Shift+P');

    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Search commands' })).not.toBeInTheDocument();
    await user.keyboard('{Control>}p{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Search commands' })).toBeInTheDocument();
  });

  it('uses the chosen key for the in-terminal Ctrl+Shift shortcut', async () => {
    const backend = installFakeBackend({ settings: { searchShortcut: 'j' } });
    const { user } = renderApp();
    await screen.findByRole('list', { name: 'Quick actions' });
    await user.keyboard('{Control>}2{/Control}');
    await waitFor(() => { expect(backend.callsTo('pty_open')).toHaveLength(1); });
    const term = within(screen.getByRole('region', { name: 'CMD session' })).getByTestId('xterm');
    fireEvent.keyDown(term, { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Search commands' })).not.toBeInTheDocument();
    fireEvent.keyDown(term, { key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Search commands' })).toBeInTheDocument();
  });
});

describe('Settings: run history', () => {
  it('lists runs with exit code, and marks commands deleted since', async () => {
    const { page } = await openSettings({}, [
      entry({ id: 2, name: 'my.custom', exists: false, exitCode: 1, shell: null }),
      entry({ id: 1, name: 'Check network connectivity', durationMs: 1500 }),
    ]);
    const list = await within(page).findByRole('list', { name: 'Run history' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('exit 1');
    expect(within(rows[0] as HTMLElement).getByText('my.custom')).toHaveAttribute('title', 'my.custom (deleted)');
    expect(rows[1]).toHaveTextContent('Check network connectivity');
    expect(rows[1]).toHaveTextContent('1.5 s');
  });

  it('clears history after confirmation', async () => {
    const { user, backend, page } = await openSettings({}, [entry({ id: 1, name: 'Ping' })]);
    await user.click(await within(page).findByRole('button', { name: 'Clear run history' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Clear run history?' })).getByRole('button', { name: 'Clear' }));
    expect(await within(page).findByText(/No runs recorded yet/)).toBeInTheDocument();
    expect(backend.state.history).toEqual([]);
  });

  it('saves the retention choice', async () => {
    const { user, backend, page } = await openSettings();
    expect(within(page).getByRole('radio', { name: '30 days' })).toBeChecked();
    await user.click(within(page).getByRole('radio', { name: 'Off' }));
    await waitFor(() => { expect(backend.state.settings.historyRetentionDays).toBe(0); });
    expect(await screen.findByText('Run history is off and was cleared')).toBeInTheDocument();
  });
});
