import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';
import { screenOf, typeInto } from '../test/xtermMock';
import { commandBarInput } from './useTerminalSession';

async function openCmdPage(options: Parameters<typeof installFakeBackend>[0] = {}) {
  const backend = installFakeBackend(options);
  const r = renderApp();
  await screen.findByRole('list', { name: 'Quick actions' });
  await r.user.keyboard('{Control>}2{/Control}');
  await waitFor(() => { expect(backend.callsTo('pty_open')).toHaveLength(1); });
  const panel = screen.getByRole('region', { name: 'CMD session' });
  return { ...r, backend, panel, bar: within(panel).getByLabelText('Command bar') };
}

describe('commandBarInput', () => {
  it('is the text as typed, each line ended with Enter (CR)', () => {
    expect(commandBarInput('echo hi')).toBe('echo hi\r');
    expect(commandBarInput('Get-Process |\n  Select -First 1')).toBe('Get-Process |\r  Select -First 1\r');
    expect(commandBarInput('a\r\nb')).toBe('a\rb\r');
    expect(commandBarInput('  "quoted" & ^x  ')).toBe('  "quoted" & ^x  \r');
  });
});

describe('Terminal session', () => {
  it('starts a real shell only when its page is first shown', async () => {
    const backend = installFakeBackend();
    const { user } = renderApp();
    await screen.findByRole('list', { name: 'Quick actions' });
    expect(backend.callsTo('pty_open')).toHaveLength(0);
    await user.keyboard('{Control>}3{/Control}');
    await waitFor(() => { expect(backend.callsTo('pty_open')).toHaveLength(1); });
    expect(backend.callsTo('pty_open')[0]).toMatchObject({ shell: 'powershell', cols: 100, rows: 30 });
  });

  it('shows output and status, and forwards keystrokes verbatim', async () => {
    const { backend, panel } = await openCmdPage();
    expect(await within(panel).findByText('Running · PID 1001')).toBeInTheDocument();
    backend.output(1, 'Microsoft Windows [Version 10.0]\r\nC:\\Users\\me>');
    expect(screenOf('CMD terminal')).toContain('C:\\Users\\me>');
    typeInto('CMD terminal', 'dir\r');
    typeInto('CMD terminal', '\x1b[A');
    await waitFor(() => { expect(backend.sessions[0]?.written).toBe('dir\r\x1b[A'); });
  });

  it('sends command-bar text exactly as typed, then clears it', async () => {
    const { user, backend, bar } = await openCmdPage();
    await waitFor(() => { expect(bar).toBeEnabled(); });
    await user.type(bar, 'echo "a & b"{Shift>}{Enter}{/Shift}ver{Enter}');
    await waitFor(() => { expect(backend.sessions[0]?.written).toBe('echo "a & b"\rver\r'); });
    expect(bar).toHaveValue('');
  });

  it('reports the exit code, disables input, and restarts on request', async () => {
    const { user, backend, panel, bar } = await openCmdPage();
    await within(panel).findByText('Running · PID 1001');
    backend.exit(1, 0);
    expect(await within(panel).findByText('Ended · exit code 0')).toBeInTheDocument();
    expect(bar).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Restart session' }));
    await waitFor(() => { expect(backend.callsTo('pty_open')).toHaveLength(2); });
    expect(await within(panel).findByText('Running · PID 1002')).toBeInTheDocument();
  });

  it('ends the session (whole process tree) with End session', async () => {
    const { user, backend, panel } = await openCmdPage();
    await within(panel).findByText('Running · PID 1001');
    await user.click(within(panel).getByRole('button', { name: 'End session' }));
    await waitFor(() => { expect(backend.callsTo('pty_close')).toEqual([{ sessionId: 1 }]); });
    expect(await within(panel).findByText(/Ended · exit code/)).toBeInTheDocument();
  });

  it('keeps the session when navigating away and back', async () => {
    const { user, backend, panel } = await openCmdPage();
    await within(panel).findByText('Running · PID 1001');
    await user.keyboard('{Control>}1{/Control}');
    await user.keyboard('{Control>}2{/Control}');
    expect(backend.callsTo('pty_open')).toHaveLength(1);
    expect(backend.callsTo('pty_close')).toHaveLength(0);
  });

  it('shows a launch failure instead of a blank terminal', async () => {
    const backend = installFakeBackend();
    backend.failNext('pty_open', { kind: 'internal', message: 'could not start cmd.exe: access denied' });
    const { user } = renderApp();
    await screen.findByRole('list', { name: 'Quick actions' });
    await user.keyboard('{Control>}2{/Control}');
    expect(await screen.findByText(/Couldn't start: could not start cmd.exe/)).toBeInTheDocument();
  });

  it('leaves Ctrl+K and Ctrl+1 to the shell while the terminal has focus, but honors Ctrl+Shift+K', async () => {
    const { panel } = await openCmdPage();
    const term = within(panel).getByTestId('xterm');
    fireEvent.keyDown(term, { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(term, { key: '1', code: 'Digit1', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'CMD' })).toBeInTheDocument();

    fireEvent.keyDown(term, { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true });
    expect(within(panel).getByLabelText('Command bar')).toHaveFocus();
    fireEvent.keyDown(term, { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Search commands' })).toBeInTheDocument();
  });

  it('collapses and maximizes', async () => {
    const { user, panel } = await openCmdPage();
    await user.click(within(panel).getByRole('button', { name: 'Maximize terminal' }));
    expect(screen.queryByRole('list', { name: 'CMD commands' })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Restore terminal size' }));
    expect(screen.getByRole('list', { name: 'CMD commands' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Hide terminal' }));
    expect(within(panel).getByRole('button', { name: 'Show terminal' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Open in terminal', () => {
  it('puts the command in the command bar of the right shell and never sends it by itself', async () => {
    const backend = installFakeBackend();
    const { user } = renderApp();
    const list = await screen.findByRole('list', { name: 'Quick actions' });
    await user.click(within(list).getByRole('button', { name: 'More actions for View running processes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open in terminal' }));

    expect(screen.getByRole('heading', { level: 1, name: 'PowerShell' })).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'PowerShell session' });
    const bar = within(panel).getByLabelText('Command bar');
    await waitFor(() => { expect(bar).toHaveValue('Get-Process'); });
    await waitFor(() => { expect(bar).toHaveFocus(); });
    await waitFor(() => { expect(backend.sessions).toHaveLength(1); });
    expect(backend.sessions[0]?.written).toBe('');
  });
});

describe('Run', () => {
  async function runFromHome() {
    const backend = installFakeBackend();
    const r = renderApp();
    const list = await screen.findByRole('list', { name: 'Quick actions' });
    await r.user.click(within(list).getByRole('button', { name: 'Run View network configuration' }));
    const dialog = await screen.findByRole('dialog', { name: 'Run: View network configuration' });
    await waitFor(() => { expect(backend.callsTo('exec_run')).toHaveLength(1); });
    return { ...r, backend, dialog };
  }

  it('runs a catalog command by id and shows output and exit code', async () => {
    const { backend, dialog } = await runFromHome();
    expect(backend.callsTo('exec_prepare')).toEqual([{ id: 'cmd.ipconfig.all', params: {} }]);
    expect(backend.callsTo('exec_run')[0]).toMatchObject({ prepareId: 'prep-1', grant: null });
    expect(within(dialog).getByText('ipconfig /all')).toBeInTheDocument();
    backend.output(1, 'Windows IP Configuration\r\n');
    expect(screenOf('Output of View network configuration')).toContain('Windows IP Configuration');
    backend.exit(1, 0);
    expect(await within(dialog).findByText('Finished · exit code 0')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Run again' })).toBeInTheDocument();
  });

  it('shows a non-zero exit code as a failure', async () => {
    const { backend, dialog } = await runFromHome();
    backend.exit(1, 5);
    expect(await within(dialog).findByText('Finished · exit code 5')).toHaveClass('text-danger');
  });

  it('stops a running command and stops it on close', async () => {
    const { user, backend, dialog } = await runFromHome();
    await user.click(await within(dialog).findByRole('button', { name: 'Stop' }));
    await waitFor(() => { expect(backend.callsTo('pty_close')).toEqual([{ sessionId: 1 }]); });
    // Run again prepares a fresh run (a prepared run is single use).
    await user.click(within(dialog).getByRole('button', { name: 'Run again' }));
    await waitFor(() => { expect(backend.callsTo('exec_run')).toHaveLength(2); });
    expect(backend.callsTo('exec_prepare')).toHaveLength(2);
    expect(backend.callsTo('exec_run')[1]).toMatchObject({ prepareId: 'prep-2' });
    const again = await screen.findByRole('dialog', { name: 'Run: View network configuration' });
    await user.click(within(again).getByRole('button', { name: 'Close output' }));
    await waitFor(() => { expect(backend.sessions[1]?.open).toBe(false); });
  });

  it('shows the backend refusal instead of running', async () => {
    const backend = installFakeBackend();
    backend.failNext('exec_run', { kind: 'conflict', message: 'This run expired or was already used. Start it again.' });
    const { user } = renderApp();
    const list = await screen.findByRole('list', { name: 'Quick actions' });
    await user.click(within(list).getByRole('button', { name: 'Run View network configuration' }));
    expect(await screen.findByText("Couldn't run: This run expired or was already used. Start it again.")).toBeInTheDocument();
  });
});

describe('Command bar check (SECURITY.md §6.2)', () => {
  const finding = { operation: 'Delete a folder and everything in it', target: 'C:\\ (the root of a drive)', consequence: 'Deletes everything on the drive.' };
  const risky = 'rd /s /q C:\\';

  it('sends ordinary lines immediately and exactly as typed', async () => {
    const { user, backend, bar } = await openCmdPage();
    await user.type(bar, 'ipconfig /flushdns{Enter}');
    await waitFor(() => { expect(backend.sessions[0]?.written).toBe('ipconfig /flushdns\r'); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(backend.callsTo('bar_check')).toEqual([{ shell: 'cmd', text: 'ipconfig /flushdns' }]);
  });

  it('asks once before an identified high-impact line, then sends the original text unchanged', async () => {
    const { user, backend, bar } = await openCmdPage({ barFindings: { [risky]: [finding] } });
    fireEvent.change(bar, { target: { value: risky } });
    await user.type(bar, '{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Check before running' });
    expect(dialog).toHaveTextContent('Delete a folder and everything in it: C:\\ (the root of a drive)');
    expect(backend.sessions[0]?.written).toBe('');
    await user.click(within(dialog).getByRole('button', { name: 'Run anyway' }));
    await waitFor(() => { expect(backend.sessions[0]?.written).toBe(`${risky}\r`); });
    expect(bar).toHaveValue('');

    // The same unchanged line isn't asked about again in this session.
    fireEvent.change(bar, { target: { value: risky } });
    await user.type(bar, '{Enter}');
    await waitFor(() => { expect(backend.sessions[0]?.written).toBe(`${risky}\r${risky}\r`); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Edit keeps the text, Cancel clears it, and neither sends anything', async () => {
    const { user, backend, bar } = await openCmdPage({ barFindings: { [risky]: [finding] } });
    fireEvent.change(bar, { target: { value: risky } });
    await user.type(bar, '{Enter}');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit' }));
    expect(bar).toHaveValue(risky);
    await waitFor(() => { expect(bar).toHaveFocus(); });
    await user.type(bar, '{Enter}');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(bar).toHaveValue('');
    expect(backend.sessions[0]?.written).toBe('');
  });

  it('fails open: if the check itself fails, the line is sent', async () => {
    const { user, backend, bar } = await openCmdPage();
    backend.failNext('bar_check', { kind: 'internal', message: 'boom' });
    await user.type(bar, 'dir{Enter}');
    await waitFor(() => { expect(backend.sessions[0]?.written).toBe('dir\r'); });
  });

  it('hints at Restart as administrator when Windows refuses access, without touching the output', async () => {
    const { user, backend, panel } = await openCmdPage();
    backend.output(1, 'Access is denied.\r\n');
    expect(await within(panel).findByText(/Windows refused access/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Restart as administrator…' }));
    expect(screen.getByRole('dialog', { name: 'Restart as administrator?' })).toHaveTextContent('Windows refused access in the terminal');
    expect(screenOf('CMD terminal')).toContain('Access is denied.');
  });
});
