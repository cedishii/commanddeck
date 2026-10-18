import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Command } from '../ipc/types';
import { FIXTURE_COMMANDS, command, installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';

const restart = command({ id: 'cmd.restart', name: 'Restart now', syntax: 'shutdown /r /t 0', risk: 'L2', modifies: true });
const rd = command({
  id: 'cmd.rd',
  name: 'Delete a folder',
  syntax: 'rd /s /q "<Folder>"',
  risk: 'L2',
  modifies: true,
  placeholders: [{ name: 'Folder', description: 'Folder to delete' }],
});
const netstat = command({ id: 'cmd.netstat.b', name: 'Programs using the network', syntax: 'netstat -b', requiresAdmin: true });
const windowsFinding = { operation: 'Delete a folder and everything in it', target: 'C:\\Windows (the Windows folder)', consequence: 'Windows will stop working.' };

async function setup(commands: Command[], options: Parameters<typeof installFakeBackend>[0] = {}) {
  const backend = installFakeBackend({ commands: [...FIXTURE_COMMANDS, ...commands], home: commands.map((c) => c.id), ...options });
  const r = renderApp();
  const list = await screen.findByRole('list', { name: 'Quick actions' });
  const run = async (name: string) => { await r.user.click(within(list).getByRole('button', { name: `Run ${name}` })); };
  return { ...r, backend, run };
}

describe('Run flow (SECURITY.md §5)', () => {
  it('confirms a meaningful change once, then runs it with the issued grant', async () => {
    const { user, backend, run } = await setup([restart]);
    await run('Restart now');
    const dialog = await screen.findByRole('dialog', { name: 'Confirm this change' });
    expect(dialog).toHaveTextContent('Changes your system');
    expect(dialog).toHaveTextContent('shutdown /r /t 0');
    expect(backend.callsTo('exec_run')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Run' }));
    await waitFor(() => { expect(backend.callsTo('exec_run')).toHaveLength(1); });
    expect(backend.callsTo('exec_authorize')).toEqual([{ prepareId: 'prep-1', confirmation: null, password: null }]);
    expect(backend.callsTo('exec_run')[0]).toMatchObject({ prepareId: 'prep-1', grant: 'grant-prep-1' });
  });

  it('asks for values, shows backend field errors, and runs exactly the resolved text', async () => {
    const { user, backend, run } = await setup([rd]);
    await run('Delete a folder');
    const form = await screen.findByRole('dialog', { name: 'Run: Delete a folder' });
    await user.click(within(form).getByRole('button', { name: 'Continue' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Fill this in.');
    await user.type(within(form).getByRole('textbox', { name: /Folder/ }), 'C:\\old-build');
    await user.click(within(form).getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm this change' });
    expect(confirm).toHaveTextContent('rd /s /q "C:\\old-build"');
    expect(backend.callsTo('exec_prepare').at(-1)).toEqual({ id: 'cmd.rd', params: { Folder: 'C:\\old-build' } });
  });

  it('requires typing the target for a high-impact run, and the app password when set', async () => {
    const { user, backend, run } = await setup([rd], { runFindings: { 'rd /s /q "C:\\Windows"': [windowsFinding] }, password: 'open sesame' });
    await run('Delete a folder');
    await user.type(await screen.findByRole('textbox', { name: /Folder/ }), 'C:\\Windows');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm a high-impact run' });
    expect(dialog).toHaveTextContent('High impact');
    expect(dialog).toHaveTextContent('Delete a folder and everything in it: C:\\Windows (the Windows folder)');
    const runButton = within(dialog).getByRole('button', { name: 'Run' });
    expect(runButton).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox', { name: /to confirm/ }), 'C:\\Windows');
    await user.type(within(dialog).getByLabelText('App password'), 'wrong');
    await user.click(runButton);
    expect(await within(dialog).findByText('Wrong password.')).toBeInTheDocument();
    expect(backend.callsTo('exec_run')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('App password'));
    await user.type(within(dialog).getByLabelText('App password'), 'open sesame');
    await user.click(runButton);
    await waitFor(() => { expect(backend.callsTo('exec_run')).toHaveLength(1); });
  });

  it('offers restart, copy or cancel when a command needs administrator rights, and never runs it', async () => {
    const { user, backend, run } = await setup([netstat]);
    await run('Programs using the network');
    const dialog = await screen.findByRole('dialog', { name: 'Administrator rights needed' });
    expect(within(dialog).getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Restart as administrator' }));
    const restartDialog = screen.getByRole('dialog', { name: 'Restart as administrator?' });
    expect(restartDialog).toHaveTextContent('nothing runs automatically');
    expect(backend.callsTo('exec_run')).toHaveLength(0);
  });

  it('skips confirmations for meaningful changes in Advanced Mode and shows the badge', async () => {
    const { backend, run } = await setup([restart], { advancedMode: true });
    expect(await screen.findByTestId('advanced-badge')).toHaveTextContent('Advanced Mode');
    await run('Restart now');
    await waitFor(() => { expect(backend.callsTo('exec_run')).toHaveLength(1); });
    expect(backend.callsTo('exec_authorize')).toHaveLength(0);
  });
});

describe('Security settings', () => {
  async function openSecurity(options: Parameters<typeof installFakeBackend>[0] = {}) {
    const backend = installFakeBackend(options);
    const r = renderApp();
    await screen.findByRole('list', { name: 'Quick actions' });
    await r.user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    return { ...r, backend, page: screen.getByRole('main') };
  }

  it('sets a password, then requires it to turn on Advanced Mode', async () => {
    const { user, backend, page } = await openSecurity();
    await user.click(await within(page).findByRole('button', { name: 'Set a password' }));
    const dialog = screen.getByRole('dialog', { name: 'Set an app password' });
    await user.type(within(dialog).getByLabelText(/New password/), 'open sesame');
    await user.type(within(dialog).getByLabelText('Repeat new password'), 'open sesame');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Password set')).toBeInTheDocument();
    expect(backend.state.security.password).toBe('open sesame');

    await user.click(within(page).getByRole('checkbox', { name: 'Advanced Mode' }));
    const prompt = screen.getByRole('dialog', { name: 'Turn on Advanced Mode' });
    await user.type(within(prompt).getByLabelText('App password'), 'nope');
    await user.click(within(prompt).getByRole('button', { name: 'Turn on' }));
    expect(await within(prompt).findByRole('alert')).toHaveTextContent('Wrong password.');
    await user.clear(within(prompt).getByLabelText('App password'));
    await user.type(within(prompt).getByLabelText('App password'), 'open sesame');
    await user.click(within(prompt).getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByTestId('advanced-badge')).toBeInTheDocument();
    // Turning it off never asks.
    await user.click(within(page).getByRole('checkbox', { name: 'Advanced Mode' }));
    await waitFor(() => { expect(screen.queryByTestId('advanced-badge')).not.toBeInTheDocument(); });
  });

  it('refuses mismatched new passwords before calling the backend', async () => {
    const { user, backend, page } = await openSecurity();
    await user.click(await within(page).findByRole('button', { name: 'Set a password' }));
    const dialog = screen.getByRole('dialog', { name: 'Set an app password' });
    await user.type(within(dialog).getByLabelText(/New password/), 'open sesame');
    await user.type(within(dialog).getByLabelText('Repeat new password'), 'open sesamE');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('don’t match');
    expect(backend.callsTo('security_set_password')).toHaveLength(0);
  });

  it('turns off meaningful-change confirmations', async () => {
    const { user, backend, page } = await openSecurity();
    await user.click(await within(page).findByRole('checkbox', { name: 'Ask before meaningful changes' }));
    await waitFor(() => { expect(backend.state.settings.confirmMeaningful).toBe(false); });
  });

  it('asks for the password before restarting as administrator when the policy says so', async () => {
    const { user, backend } = await openSecurity({ password: 'open sesame' });
    await user.click(await screen.findByRole('button', { name: 'Standard user' }));
    const dialog = screen.getByRole('dialog', { name: 'Restart as administrator?' });
    const restartButton = within(dialog).getByRole('button', { name: 'Restart as administrator' });
    expect(restartButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText('App password'), 'bad');
    await user.click(restartButton);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Wrong password.');
    await user.clear(within(dialog).getByLabelText('App password'));
    await user.type(within(dialog).getByLabelText('App password'), 'open sesame');
    await user.click(restartButton);
    await waitFor(() => { expect(backend.callsTo('restart_elevated').at(-1)).toEqual({ page: 'settings', password: 'open sesame' }); });
  });
});
