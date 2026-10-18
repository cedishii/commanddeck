import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Parses the hex color tokens of each theme block in tokens.css. */
function themeTokens(): Record<'light' | 'dark', Map<string, string>> {
  // Vitest runs from the project root.
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const darkStart = css.indexOf(":root[data-theme='dark']");
  const parse = (block: string) =>
    new Map(Array.from(block.matchAll(/(--cd-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g), (m) => [m[1] ?? '', m[2] ?? '']));
  return { light: parse(css.slice(0, darkStart)), dark: parse(css.slice(darkStart)) };
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background] pairs used for text in the UI. */
const TEXT_PAIRS: readonly [string, string][] = [
  ['--cd-fg', '--cd-bg'],
  ['--cd-fg', '--cd-surface'],
  ['--cd-fg', '--cd-surface-2'],
  ['--cd-fg', '--cd-accent-soft'],
  ['--cd-fg-muted', '--cd-bg'],
  ['--cd-fg-muted', '--cd-surface'],
  ['--cd-fg-muted', '--cd-surface-2'],
  ['--cd-accent-fg', '--cd-accent'],
  ['--cd-accent', '--cd-surface'],
  ['--cd-accent', '--cd-accent-soft'],
  ['--cd-code-fg', '--cd-code-bg'],
  ['--cd-risk1-fg', '--cd-risk1-bg'],
  ['--cd-risk2-fg', '--cd-risk2-bg'],
  ['--cd-risk3-fg', '--cd-risk3-bg'],
  ['--cd-admin-fg', '--cd-admin-bg'],
  ['--cd-danger-fg', '--cd-surface'],
];

describe('design tokens', () => {
  const themes = themeTokens();

  for (const theme of ['light', 'dark'] as const) {
    describe(`${theme} theme`, () => {
      it.each(TEXT_PAIRS)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
        const fgHex = themes[theme].get(fg);
        const bgHex = themes[theme].get(bg);
        expect(fgHex, `${fg} missing`).toBeDefined();
        expect(bgHex, `${bg} missing`).toBeDefined();
        expect(contrast(fgHex ?? '', bgHex ?? '')).toBeGreaterThanOrEqual(4.5);
      });

      it('focus ring is visible against surfaces (3:1)', () => {
        const focus = themes[theme].get('--cd-focus') ?? '';
        expect(contrast(focus, themes[theme].get('--cd-surface') ?? '')).toBeGreaterThanOrEqual(3);
        expect(contrast(focus, themes[theme].get('--cd-bg') ?? '')).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
