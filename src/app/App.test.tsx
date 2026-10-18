import { screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';
import { App } from './App';

function nav() {
  return screen.getByRole('navigation', { name: 'Primary' });
}

describe('App navigation', () => {
  it('shows Home, CMD, PowerShell then Settings, with Home active by default', () => {
    renderApp(<App />);
    const names = within(nav()).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Home', 'CMD', 'PowerShell', 'Settings']);
    expect(within(nav()).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('switches pages on click and moves aria-current', async () => {
    const { user } = renderApp(<App />);
    await user.click(within(nav()).getByRole('button', { name: 'CMD' }));
    expect(screen.getByRole('heading', { level: 1, name: 'CMD' })).toBeInTheDocument();
    expect(within(nav()).getByRole('button', { name: 'CMD' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('supports Ctrl+1/2/3 and Ctrl+, shortcuts', async () => {
    const { user } = renderApp(<App />);
    await user.keyboard('{Control>}2{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'CMD' })).toBeInTheDocument();
    await user.keyboard('{Control>}3{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'PowerShell' })).toBeInTheDocument();
    await user.keyboard('{Control>},{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    await user.keyboard('{Control>}1{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('moves focus to the new page title after navigating', async () => {
    const { user } = renderApp(<App />);
    await user.keyboard('{Control>}3{/Control}');
    expect(screen.getByRole('heading', { level: 1, name: 'PowerShell' })).toHaveFocus();
  });

  it('does not move focus on startup, even under StrictMode double effects (regression)', () => {
    renderApp(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('labels the privilege indicator as not yet wired instead of guessing', () => {
    renderApp(<App />);
    expect(screen.getByTestId('privilege-badge')).toHaveTextContent('not checked yet');
  });
});
