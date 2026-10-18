import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';
import { ShellPage } from './ShellPage';

describe('ShellPage', () => {
  it('lists only CMD commands on the CMD page', async () => {
    renderApp(<ShellPage shell="cmd" />);
    const list = await screen.findByRole('list', { name: 'CMD commands' });
    expect(within(list).getByText('ipconfig /all')).toBeInTheDocument();
    expect(within(list).queryByText('Get-Process')).not.toBeInTheDocument();
  });

  it('lists only PowerShell commands on the PowerShell page', async () => {
    renderApp(<ShellPage shell="powershell" />);
    const list = await screen.findByRole('list', { name: 'PowerShell commands' });
    expect(within(list).getByText('Get-Process')).toBeInTheDocument();
    expect(within(list).queryByText('ipconfig /all')).not.toBeInTheDocument();
  });

  it('filters by category and shows an empty state for empty categories', async () => {
    const { user } = renderApp(<ShellPage shell="cmd" />);
    await screen.findByRole('list', { name: 'CMD commands' });
    const categories = screen.getByRole('navigation', { name: 'CMD categories' });

    await user.click(within(categories).getByRole('button', { name: /^Processes/ }));
    const list = screen.getByRole('list', { name: 'CMD commands' });
    expect(within(list).getAllByTestId('command-row')).toHaveLength(1);
    expect(within(list).getByText('tasklist')).toBeInTheDocument();

    await user.click(within(categories).getByRole('button', { name: /^Disk Management/ }));
    expect(screen.getByText('Nothing in this category yet')).toBeInTheDocument();
  });

  it('states that the live session is not available yet', async () => {
    renderApp(<ShellPage shell="powershell" />);
    await screen.findByRole('list', { name: 'PowerShell commands' });
    expect(screen.getByRole('region', { name: 'PowerShell session' })).toHaveTextContent('Not available yet');
  });
});
