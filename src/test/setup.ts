import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/** jsdom has no matchMedia. Default to a light system theme; tests can override `matches`. */
export const mediaState = { dark: false };

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((query: string) => ({
    get matches() {
      return query.includes('dark') ? mediaState.dark : false;
    },
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mediaState.dark = false;
  delete document.documentElement.dataset.theme;
});
