import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithContext as renderApp } from '../test/render';
import { SyntaxPreview } from './SyntaxPreview';

const LONG =
  'Get-ChildItem -Path "$env:USERPROFILE\\Downloads" -Recurse -File -ErrorAction SilentlyContinue |\n' +
  '    Sort-Object -Property Length -Descending |\n' +
  "    Select-Object -First 20 -Property FullName, @{Name = 'SizeMB'; Expression = { [math]::Round($_.Length / 1MB, 1) }}";

function forceOverflow() {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('SyntaxPreview', () => {
  it('shows no chevron for a short single-line command that fits', () => {
    renderApp(<SyntaxPreview syntax="dir" label="List files" />);
    expect(screen.queryByRole('button', { name: /expand syntax/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command for List files' })).toBeInTheDocument();
  });

  it('keeps the full syntax in the DOM while collapsed (truncation is visual only)', () => {
    forceOverflow();
    const { container } = renderApp(<SyntaxPreview syntax={LONG} label="Largest files" />);
    expect(container.querySelector('code')?.textContent).toBe(LONG);
  });

  it('expands and collapses an overflowing command', async () => {
    forceOverflow();
    const syntax = 'ping -n 10 -l 1472 -f some-really-long-host-name.example.internal';
    const { user, container } = renderApp(<SyntaxPreview syntax={syntax} label="Ping" />);

    const toggle = screen.getByRole('button', { name: 'Expand syntax for Ping' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    const collapse = screen.getByRole('button', { name: 'Collapse syntax for Ping' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('pre')?.textContent).toBe(syntax);

    await user.click(collapse);
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand syntax for Ping' })).toBeInTheDocument();
  });

  it('offers expansion for multi-line commands and preserves newlines and indentation', async () => {
    const { user, container } = renderApp(<SyntaxPreview syntax={LONG} label="Largest files" />);
    await user.click(screen.getByRole('button', { name: 'Expand syntax for Largest files' }));
    expect(container.querySelector('pre')?.textContent).toBe(LONG);
  });

  it('full variant always shows the whole command without a chevron', () => {
    forceOverflow();
    const { container } = renderApp(<SyntaxPreview syntax={LONG} label="Largest files" variant="full" />);
    expect(container.querySelector('pre')?.textContent).toBe(LONG);
    expect(screen.queryByRole('button', { name: /(expand|collapse) syntax/i })).not.toBeInTheDocument();
  });

  it('keeps short tokens like -File unbreakable when wrapped (regression)', () => {
    const { container } = renderApp(<SyntaxPreview syntax={LONG} label="Largest files" variant="full" />);
    const nowrap = Array.from(container.querySelectorAll('pre span.whitespace-nowrap'), (s) => s.textContent);
    expect(nowrap).toContain('-File');
    expect(nowrap).toContain('-Recurse');
  });

  it('copies the exact canonical syntax, not the visible preview', async () => {
    forceOverflow();
    const { user } = renderApp(<SyntaxPreview syntax={LONG} label="Largest files" />);
    await user.click(screen.getByRole('button', { name: 'Copy command for Largest files' }));
    expect(await navigator.clipboard.readText()).toBe(LONG);
    expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('reports a clipboard failure instead of failing silently', async () => {
    const { user } = renderApp(<SyntaxPreview syntax="dir" label="List files" />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy command for List files' }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });
});
