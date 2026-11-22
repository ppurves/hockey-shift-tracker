import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS, nextUnit, sortUnits } from '.';

describe('units', () => {
  it('nextUnit picks the next free id and a default name', () => {
    expect(nextUnit(DEFAULT_UNITS, 'F')).toEqual({ id: 'L4', name: 'Line 4', group: 'F' });
    expect(nextUnit(DEFAULT_UNITS, 'D')).toEqual({ id: 'D3', name: 'D 3', group: 'D' });
    const gap = DEFAULT_UNITS.filter((u) => u.id !== 'L2');
    expect(nextUnit(gap, 'F').id).toBe('L4'); // L3 exists, never reuse a taken id
  });
  it('sortUnits groups F, D, PP, PK', () => {
    const mixed = [...DEFAULT_UNITS].reverse();
    expect(sortUnits(mixed).map((u) => u.group)).toEqual(['F', 'F', 'F', 'D', 'D', 'PP', 'PP', 'PK', 'PK']);
  });
});
