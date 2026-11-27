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

/**
 * Exclusion key for a unit: units with the same key can't be on together.
 * Roster players get a key of their own (any number of players can be on).
 */
export function exclusionKey(u: Pick<UnitDef, 'id' | 'group' | 'kind'>): string {
  return u.kind === 'player' ? `player:${u.id}` : exclusionSet(u.group);
}

const PREFIX: Record<Group, { id: string; name: string }> = {
  F: { id: 'L', name: 'Line' },
  D: { id: 'D', name: 'D' },
  PP: { id: 'PP', name: 'PP' },
  PK: { id: 'PK', name: 'PK' },
};

/** A new unit for `group` with the next free number, e.g. Line 4 / L4. */
export function nextUnit(units: readonly UnitDef[], group: Group): UnitDef {
  const p = PREFIX[group];
  const taken = new Set(units.map((u) => u.id));
  let n = units.filter((u) => u.group === group).length + 1;
  while (taken.has(`${p.id}${n}`)) n++;
  return { id: `${p.id}${n}`, name: `${p.name} ${n}`, group };
}

/** Units sorted by group order F, D, PP, PK (stable within a group). */
export function sortUnits(units: readonly UnitDef[]): UnitDef[] {
  const order: Group[] = ['F', 'D', 'PP', 'PK'];
  return order.flatMap((g) => units.filter((u) => u.group === g));
}

/** Default display name for a unit id, e.g. L4 → "Line 4" (used when a name is blanked). */
export function defaultUnitName(u: Pick<UnitDef, 'id' | 'group'>): string {
  return `${PREFIX[u.group].name} ${u.id.replace(/^\D+/, '')}`.trim();
}
