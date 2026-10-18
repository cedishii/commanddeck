import { invoke } from '@tauri-apps/api/core';
import type { ErrorKind, FieldError } from './types';

/** An error reported by the backend (or the absence of one). */
export class BackendError extends Error {
  readonly kind: ErrorKind;
  readonly fields: readonly FieldError[];

  constructor(kind: ErrorKind, message: string, fields: readonly FieldError[] = []) {
    super(message);
    this.name = 'BackendError';
    this.kind = kind;
    this.fields = fields;
  }

  /** Message for one form field, matching exact names or `name.` prefixes. */
  fieldMessage(field: string): string | undefined {
    return this.fields.find((f) => f.field === field || f.field.startsWith(`${field}.`))?.message;
  }
}

function isErrorPayload(value: unknown): value is { kind: ErrorKind; message: string; fields?: FieldError[] } {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;
}

function hasBackend(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** The only place the frontend talks to Rust. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasBackend()) {
    throw new BackendError('unavailable', 'The CommandDeck backend is not available. Run the desktop app (npm run tauri dev).');
  }
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    if (isErrorPayload(error)) throw new BackendError(error.kind, error.message, error.fields ?? []);
    throw new BackendError('internal', error instanceof Error ? error.message : String(error));
  }
}
