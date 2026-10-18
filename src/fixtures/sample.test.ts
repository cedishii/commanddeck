import { describe, expect, it } from 'vitest';
import { SAMPLE_COMMANDS, SAMPLE_QUICK_ACTION_IDS, SAMPLE_QUICK_ACTION_LIMIT } from './sample';

describe('sample fixtures', () => {
  it('are clearly marked as sample data', () => {
    for (const c of SAMPLE_COMMANDS) expect(c.id.startsWith('sample.')).toBe(true);
  });

  it('have unique ids', () => {
    const ids = SAMPLE_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('have non-empty syntax without stray surrounding whitespace', () => {
    for (const c of SAMPLE_COMMANDS) {
      expect(c.syntax.length).toBeGreaterThan(0);
      expect(c.syntax).toBe(c.syntax.trim());
    }
  });

  it('only reference existing commands from Home, within the limit', () => {
    const ids = new Set(SAMPLE_COMMANDS.map((c) => c.id));
    for (const id of SAMPLE_QUICK_ACTION_IDS) expect(ids.has(id)).toBe(true);
    expect(SAMPLE_QUICK_ACTION_IDS.length).toBeLessThanOrEqual(SAMPLE_QUICK_ACTION_LIMIT);
  });
});
