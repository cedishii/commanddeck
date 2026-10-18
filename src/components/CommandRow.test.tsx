import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommandEntry } from '../domain/command';
import { renderApp } from '../test/render';
import { CommandRow } from './CommandRow';

const routine: CommandEntry = {
  id: 'test.ipconfig',
  shell: 'cmd',
  name: 'View network configuration',
  summary: 'Shows adapters.',
  category: 'networking',
  syntax: 'ipconfig /all',
  requiresAdmin: false,
  risk: 'L1',
  modifies: false,
};

const highImpact: CommandEntry = {
  ...routine,
  id: 'test.format',
  shell: 'powershell',
  name: 'Format a volume',
  syntax: 'Format-Volume -DriveLetter <Letter> -FileSystem NTFS',
  requiresAdmin: true,
  risk: 'L3',
  modifies: true,
};

function renderRow(entry: CommandEntry, onOpenDetails = vi.fn()) {
  const result = renderApp(
    <ol>
      <CommandRow entry={entry} index={3} showShell onOpenDetails={onOpenDetails} />
    </ol>,
  );
  return { ...result, row: screen.getByTestId('command-row'), onOpenDetails };
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

  it('shows risk and admin badges when relevant', () => {
    const { row } = renderRow(highImpact);
    expect(within(row).getByText('High impact')).toBeInTheDocument();
    expect(within(row).getByText('Admin')).toBeInTheDocument();
    expect(within(row).getByText('PowerShell')).toBeInTheDocument();
  });

  it('opens details from the name and from the details button', async () => {
    const { user, row, onOpenDetails } = renderRow(routine);
    await user.click(within(row).getByRole('button', { name: 'View network configuration' }));
    await user.click(within(row).getByRole('button', { name: 'Details for View network configuration' }));
    expect(onOpenDetails).toHaveBeenCalledTimes(2);
    expect(onOpenDetails).toHaveBeenCalledWith(routine);
  });

  it('marks Run as unavailable until execution exists', () => {
    const { row } = renderRow(routine);
    expect(within(row).getByRole('button', { name: /^Run .*not available yet/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
