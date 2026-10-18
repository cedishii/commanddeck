import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsPage } from '../pages/SettingsPage';
import { renderApp } from '../test/render';
import { mediaState } from '../test/setup';

describe('theme', () => {
  it('follows the system theme by default', () => {
    mediaState.dark = true;
    renderApp(<SettingsPage />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies and remembers an explicit choice', async () => {
    const { user } = renderApp(<SettingsPage />);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('commanddeck.theme')).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores a corrupted stored value and falls back to system', () => {
    window.localStorage.setItem('commanddeck.theme', '{not-a-theme');
    renderApp(<SettingsPage />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });
});
