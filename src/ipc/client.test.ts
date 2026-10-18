import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../test/fakeBackend';
import { api } from './api';
import { BackendError, call } from './client';

describe('ipc client', () => {
  it('reports a missing backend clearly (e.g. running in a plain browser)', async () => {
    const error = await call('home_get').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({ kind: 'unavailable' });
  });

  it('maps backend error payloads to BackendError with fields', async () => {
    const backend = installFakeBackend();
    backend.failNext('custom_create', {
      kind: 'validation',
      message: 'Some fields are invalid',
      fields: [{ field: 'aliases', message: "alias 'ls' is already used" }, { field: 'commands[0].name', message: 'is required' }],
    });
    const error = (await api.createCustom({} as never).catch((e: unknown) => e)) as BackendError;
    expect(error).toBeInstanceOf(BackendError);
    expect(error.kind).toBe('validation');
    expect(error.fieldMessage('aliases')).toBe("alias 'ls' is already used");
    expect(error.fieldMessage('commands[0]')).toBe('is required');
    expect(error.fieldMessage('name')).toBeUndefined();
  });

  it('passes arguments in the camelCase shape Tauri expects', async () => {
    const backend = installFakeBackend();
    await api.homeMove('cmd.ping', 2);
    await api.search('dns', 'powershell', 5);
    expect(backend.callsTo('home_move')[0]).toEqual({ id: 'cmd.ping', toIndex: 2 });
    expect(backend.callsTo('catalog_search')[0]).toEqual({ query: 'dns', shell: 'powershell', limit: 5 });
  });
});
