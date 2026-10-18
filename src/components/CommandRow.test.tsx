import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CommandView } from '../ipc/types';
import { command, installFakeBackend } from '../test/fakeBackend';
import { renderWithContext } from '../test/render';
import { CommandRow } from './CommandRow';

function viewOf(partial: Parameters<typeof command>[0], extra: Partial<CommandView> = {}): CommandView {
  return { ...command(partial), favorite: false, onHome: false, userAliases: [], multiStep: false, runnable: true, runBlockedReason: null, ...extra };
}

const routine = viewOf({ id: 'cmd.ipconfig.all', name: 'View network configuration', summary: 'Shows adapters.', syntax: 'ipconfig /all' });
const highImpact = viewOf({
  id: 'ps.format-volume',
  shell: 'powershell',
  name: 'Format a volume',
  syntax: 'Format-Volume -DriveLetter <Letter> -FileSystem NTFS',
  requiresAdmin: true,
  risk: 'L3',
  modifies: true,
});

function renderRow(entry: CommandView, props: { label?: string; note?: string } = {}) {
  installFakeBackend();
  const result = renderWithContext(
    <ol>
      <CommandRow entry={entry} index={3} showShell {...props} />
    </ol>,
  );
  return { ...result, row: within(result.container).getByTestId('command-row') };
}

describe('CommandRow', () => {
  it('shows number, description, shell and syntax, with no risk badge for routine commands', () => {
    const { row } = renderRow(routine);
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'View network configuration' })).toBeInTheDocument();
    expect(within(row).getByText('Shows adapters.')).toBeInTheDocument();
    expect(within(row).getByText('CMD')).toBeInTheDocument();
    expect(within(row).getByText('ipconfig /all')).toBeInTheDocument();
    expect(within(row).queryByText('Routine')).not.toBeInTheDocument();
    expect(within(row).queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows risk, admin, custom and multi-step badges when relevant', () => {
    const { row } = renderRow(highImpact);
    expect(within(row).getByText('High impact')).toBeInTheDocument();
    expect(within(row).getByText('Admin')).toBeInTheDocument();
    expect(within(row).getByText('PowerShell')).toBeInTheDocument();

    const custom = viewOf({ id: 'custom.1', name: 'Mine', source: 'custom', syntax: 'a && b' }, { multiStep: true });
    const { row: customRow } = renderRow(custom);
    expect(within(customRow).getByText('Custom')).toBeInTheDocument();
    expect(within(customRow).getByText('Multi-step')).toBeInTheDocument();
  });

  it('opens details from the name and from the details button', async () => {
    const { user, row, context } = renderRow(routine);
    await user.click(within(row).getByRole('button', { name: 'View network configuration' }));
    await user.click(within(row).getByRole('button', { name: 'Details for View network configuration' }));
    expect(context.openDetails).toHaveBeenCalledTimes(2);
    expect(context.openDetails).toHaveBeenCalledWith('cmd.ipconfig.all');
  });

  it('shows a personal label without hiding the catalog name', () => {
    const { row } = renderRow(routine, { label: 'My IP info', note: 'Before calling the ISP' });
    const title = within(row).getByRole('button', { name: 'My IP info' });
    expect(title).toHaveAttribute('title', 'Your label. Catalog name: View network configuration');
    expect(within(row).getByText('Before calling the ISP')).toBeInTheDocument();
    expect(within(row).getByText('ipconfig /all')).toBeInTheDocument();
  });

  it('offers Run for runnable commands and Open in terminal otherwise, with the reason', async () => {
    const { user, row, context } = renderRow(routine);
    await user.click(within(row).getByRole('button', { name: 'Run View network configuration' }));
    expect(context.runCommand).toHaveBeenCalledWith(routine);

    const blocked = viewOf(
      { id: 'cmd.del', name: 'Delete a file', syntax: 'del "<File>"', risk: 'L2', modifies: true },
      { runnable: false, runBlockedReason: 'This changes your system.' },
    );
    const { row: blockedRow, context: ctx2 } = renderRow(blocked);
    expect(within(blockedRow).queryByRole('button', { name: /^Run / })).not.toBeInTheDocument();
    const open = within(blockedRow).getByRole('button', { name: 'Open Delete a file in the terminal' });
    expect(open).toHaveAttribute('title', 'This changes your system.');
    await user.click(open);
    expect(ctx2.openInTerminal).toHaveBeenCalledWith(blocked);
  });

  it('opens the overflow menu with arrow keys and closes it with Esc', async () => {
    const { user, row } = renderRow(routine);
    const more = within(row).getByRole('button', { name: 'More actions for View network configuration' });
    more.focus();
    await user.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Add to Home' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Open in terminal' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(menu).getByRole('menuitem', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});
