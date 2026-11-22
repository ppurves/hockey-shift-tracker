import type { Group, UnitDef } from './types';

export const DEFAULT_UNITS: UnitDef[] = [
  { id: 'L1', name: 'Line 1', group: 'F' },
  { id: 'L2', name: 'Line 2', group: 'F' },
  { id: 'L3', name: 'Line 3', group: 'F' },
  { id: 'D1', name: 'D 1', group: 'D' },
  { id: 'D2', name: 'D 2', group: 'D' },
  { id: 'PP1', name: 'PP 1', group: 'PP' },
  { id: 'PP2', name: 'PP 2', group: 'PP' },
  { id: 'PK1', name: 'PK 1', group: 'PK' },
  { id: 'PK2', name: 'PK 2', group: 'PK' },
];

/**
 * Units in the same exclusion set can't be on the ice together.
 * F and D are separate sets; PP and PK share one "special teams" set,
 * so at most one PP-or-PK unit is active at a time.
 */
export function exclusionSet(group: Group): 'F' | 'D' | 'ST' {
  return group === 'PP' || group === 'PK' ? 'ST' : group;
}
