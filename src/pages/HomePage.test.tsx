import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommandEntry } from '../domain/command';
import { SAMPLE_QUICK_ACTION_IDS } from '../fixtures/sample';
import { renderApp } from '../test/render';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('shows a loading state, then the sample quick actions with the count', async () => {
    renderApp(<HomePage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading quick actions');
    const list = await screen.findByRole('list', { name: 'Quick actions' });
    expect(within(list).getAllByTestId('command-row')).toHaveLength(SAMPLE_QUICK_ACTION_IDS.length);
    expect(screen.getByText(`${SAMPLE_QUICK_ACTION_IDS.length} of 10`)).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });

  it('shows an empty state when there are no quick actions', async () => {
    renderApp(<HomePage load={() => Promise.resolve([])} />);
    expect(await screen.findByText('No quick actions yet')).toBeInTheDocument();
  });

  it('shows an error state and recovers on retry', async () => {
    const load = vi
      .fn<() => Promise<readonly CommandEntry[]>>()
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce([]);
    const { user } = renderApp(<HomePage load={load} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your quick actions");
    expect(alert).toHaveTextContent('Storage unavailable');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No quick actions yet')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('DetailPanel (from Home)', () => {
  it('opens from a row, closes with Esc, and returns focus to the row', async () => {
    const { user } = renderApp(<HomePage />);
    const opener = await screen.findByRole('button', { name: 'View network configuration' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'View network configuration' });
    expect(within(dialog).getByRole('button', { name: 'Close details' })).toHaveFocus();
    expect(dialog.querySelector('pre')?.textContent).toBe('ipconfig /all');
    expect(within(dialog).getByText('Works as a standard user.')).toBeInTheDocument();
    expect(within(dialog).getByText('Read-only. It does not change anything.')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab focus inside the panel', async () => {
    const { user } = renderApp(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'View network configuration' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close details' });

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(close).not.toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
  });

  it('closes with the close button', async () => {
    const { user } = renderApp(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Check network connectivity' }));
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
