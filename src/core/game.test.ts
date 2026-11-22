import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD_MS, DEFAULT_UNITS, isoDate, newGameMeta } from '.';

describe('newGameMeta', () => {
  it('fills defaults and copies units so edits never touch DEFAULT_UNITS', () => {
    const now = new Date(2026, 10, 21, 19, 30).getTime();
    const m = newGameMeta({ opponent: '  Hawks ' }, 'g1', now);
    expect(m).toMatchObject({
      id: 'g1', opponent: 'Hawks', date: '2026-11-21', homeAway: 'home',
      periodLengthMs: DEFAULT_PERIOD_MS, status: 'live', score: { for: 0, against: 0 },
    });
    m.units[0].name = 'Smith-Jones-Lee';
    expect(DEFAULT_UNITS[0].name).toBe('Line 1');
  });
  it('uses a fallback opponent name and local dates', () => {
    expect(newGameMeta({ opponent: ' ' }, 'g', 0).opponent).toBe('Opponent');
    expect(isoDate(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});
