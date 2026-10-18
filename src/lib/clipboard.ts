/** Copies text verbatim. Callers must pass canonical command text, never a preview. */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('clipboard' in navigator)) {
    throw new Error('Clipboard is not available');
  }
  await navigator.clipboard.writeText(text);
}
