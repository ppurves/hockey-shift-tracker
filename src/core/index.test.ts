import { describe, expect, it } from 'vitest';
import { formatClock } from '.';

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(45_000)).toBe('0:45');
    expect(formatClock(65_999)).toBe('1:05');
    expect(formatClock(15 * 60_000)).toBe('15:00');
  });
  it('clamps negatives', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});
