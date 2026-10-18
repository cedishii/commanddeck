import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../test/fakeBackend';
import { renderApp } from '../test/render';
import { placeholderNames } from './CustomCommandEditor';

async function openEditor() {
  const r = renderApp();
  await screen.findByRole('list', { name: 'Quick actions' });
  await r.user.keyboard('{Control>}3{/Control}');
  await screen.findByRole('list', { name: 'PowerShell commands' });
  await r.user.click(screen.getByRole('button', { name: 'New command' }));
  return { ...r, dialog: screen.getByRole('dialog', { name: 'New custom command' }) };
}

describe('CustomCommandEditor', () => {
  it('shows backend validation messages next to the fields', async () => {
    installFakeBackend();
    const { user, dialog } = await openEditor();
    await user.click(within(dialog).getByRole('button', { name: 'Create command' }));
    expect(await within(dialog).findAllByText('is required')).toHaveLength(3);
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('creates a command for the current shell, preserving syntax exactly, and opens its details', async () => {
    const backend = installFakeBackend();
    const { user, dialog } = await openEditor();
    expect(within(dialog).getByLabelText('Shell')).toHaveValue('powershell');
    await user.type(within(dialog).getByLabelText('Name'), 'Git branches');
    await user.type(within(dialog).getByLabelText('Description'), 'All local and remote branches.');
    await user.type(within(dialog).getByLabelText('Command'), 'git branch --all | Select-String <Pattern>');
    await user.type(within(dialog).getByLabelText('Description of Pattern'), 'Text to filter by');
    await user.type(within(dialog).getByLabelText('Aliases'), 'gb, branches');
    await user.click(within(dialog).getByRole('button', { name: 'Create command' }));

    const details = await screen.findByRole('dialog', { name: 'Git branches' });
    expect(details.querySelector('pre')?.textContent).toBe('git branch --all | Select-String <Pattern>');
    expect(within(details).getByText('Multi-step')).toBeInTheDocument();
    const draft = backend.callsTo('custom_create')[0]?.draft as Record<string, unknown>;
    expect(draft).toMatchObject({
      shell: 'powershell',
      aliases: ['gb', 'branches'],
      placeholders: [{ name: 'Pattern', description: 'Text to filter by' }],
    });
  });

  it('forces "changes the system" for risky commands and sends the declared risk', async () => {
    const backend = installFakeBackend();
    const { user, dialog } = await openEditor();
    await user.selectOptions(within(dialog).getByLabelText('How risky is it?'), 'L2');
    expect(within(dialog).getByLabelText('Changes the system')).toBeChecked();
    expect(within(dialog).getByLabelText('Changes the system')).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Name'), 'Clean temp');
    await user.type(within(dialog).getByLabelText('Description'), 'Deletes temp files.');
    await user.type(within(dialog).getByLabelText('Command'), 'Remove-Item -Path $env:TEMP\\* -Recurse');
    await user.click(within(dialog).getByRole('button', { name: 'Create command' }));
    await waitFor(() => { expect(backend.callsTo('custom_create')).toHaveLength(1); });
    expect(backend.callsTo('custom_create')[0]?.draft).toMatchObject({ risk: 'L2', modifies: true });
  });

  it('extracts placeholder names like the backend', () => {
    expect(placeholderNames('copy <Src> <Dst> <Src> <1x> < a > <Ok2>')).toEqual(['Src', 'Dst', 'Ok2']);
  });
});
