// Roster mode. Players are tracked as units of their own (kind: 'player',
// group F or D), so the engine, shifts, stats, timeline and post-game edits
// work per player unchanged. Lines are then derived: a line is "on" while a
// majority of its players are on the ice (2 of 3 forwards, 2 of 2 D).

import { computeStats } from './stats';
import type { GameEvent, GameMeta, Player, Position, UnitDef, UnitStats } from './types';

export const isRoster = (meta: Pick<GameMeta, 'mode'>): boolean => meta.mode === 'roster';

/** Line group for a position; goalies have no line. */
export const positionGroup = (p: Position): 'F' | 'D' | null => (p === 'G' ? null : p);

/** "#12 Smith", "#12" or "Smith". */
export function playerLabel(p: Pick<Player, 'number' | 'name'>): string {
  const num = p.number.trim();
  const name = p.name.trim();
  if (num && name) return `#${num} ${name}`;
  if (num) return `#${num}`;
  return name || 'Player';
}

/** Next free player id: p1, p2, … (lowercase, so it can't clash with unit ids like PP1). */
export function nextPlayerId(players: readonly Player[]): string {
  const taken = new Set(players.map((p) => p.id));
  let n = players.length + 1;
  while (taken.has(`p${n}`)) n++;
  return `p${n}`;
}

/**
 * Clears line assignments that no longer fit: a removed line, or a line of
 * the other group (a D on a forward line). Goalies never have a line.
 */
export function sanitizeRoster(players: readonly Player[], units: readonly UnitDef[]): Player[] {
  return players.map((p) => {
    const g = positionGroup(p.position);
    const line = units.find((u) => u.id === p.lineId);
    const ok = g !== null && line !== undefined && line.group === g;
    return ok ? p : { ...p, lineId: null };
  });
}

/** Numeric-aware jersey order (2 before 10), then text. */
const byNumber = (a: Pick<Player, 'number'>, b: Pick<Player, 'number'>) =>
  a.number.localeCompare(b.number, undefined, { numeric: true });

/** F lines and D pairs of a roster game, in display order. */
export function rosterLines(meta: Pick<GameMeta, 'units'>): UnitDef[] {
  return meta.units.filter((u) => u.group === 'F' || u.group === 'D');
}

/**
 * Players as trackable units, ordered by line (in the game's line order) and
 * jersey number within a line; then extras (forwards first), then goalies.
 */
export function playerUnits(meta: Pick<GameMeta, 'units' | 'players'>): UnitDef[] {
  const players = sanitizeRoster(meta.players ?? [], meta.units);
  const lineOrder = new Map(rosterLines(meta).map((u, i) => [u.id, i]));
  const rank = (p: Player) =>
    p.lineId !== null ? lineOrder.get(p.lineId)! : 1000 + ['F', 'D', 'G'].indexOf(p.position);
  return players
    .sort((a, b) => rank(a) - rank(b) || byNumber(a, b))
    .map((p) => ({
      id: p.id,
      name: playerLabel(p),
      group: p.position,
      kind: 'player' as const,
      lineId: p.lineId,
      number: p.number.trim(),
    }));
}

/** The units the engine tracks: lines mode → meta.units; roster mode → players (incl. goalies) + any legacy PP/PK units. */
export function trackedUnits(meta: Pick<GameMeta, 'mode' | 'units' | 'players'>): UnitDef[] {
  if (!isRoster(meta)) return meta.units;
  return [...playerUnits(meta), ...meta.units.filter((u) => u.group === 'PP' || u.group === 'PK')];
}

/** Players needed on the ice for a line of `size` players to count as "on". */
export const lineThreshold = (size: number): number => Math.floor(size / 2) + 1;

/**
 * Adds derived unitOn/unitOff events for each line (on while a majority of
 * its players are on), and adds the lines that were on to each goal's onIce.
 * The result feeds computeStats/timelineSvg with the lines as units. A line
 * that drops off and comes straight back at the same game time keeps one shift.
 */
export function withLineEvents(lines: readonly UnitDef[], players: readonly UnitDef[], events: readonly GameEvent[]): GameEvent[] {
  const members = new Map(lines.map((l) => [l.id, new Set(players.filter((p) => p.lineId === l.id).map((p) => p.id))]));
  const playerLine = new Map<string, string>();
  for (const p of players) if (p.lineId && members.has(p.lineId)) playerLine.set(p.id, p.lineId);
  const count = new Map<string, number>();
  const lineOn = new Set<string>();
  const out: (GameEvent | null)[] = [];
  const lastOffIdx = new Map<string, number>();

  for (const e of events) {
    if (e.type === 'goalFor' || e.type === 'goalAgainst') {
      out.push({ ...e, onIce: [...e.onIce, ...lines.filter((l) => lineOn.has(l.id)).map((l) => l.id)] });
      continue;
    }
    out.push(e);
    if (e.type === 'periodStart' || e.type === 'periodEnd') {
      // deriveShifts closes every open shift at period boundaries.
      count.clear();
      lineOn.clear();
      lastOffIdx.clear();
      continue;
    }
    if (e.type !== 'unitOn' && e.type !== 'unitOff') continue;
    const lineId = playerLine.get(e.unitId);
    if (!lineId) continue;
    const c = (count.get(lineId) ?? 0) + (e.type === 'unitOn' ? 1 : -1);
    count.set(lineId, c);
    const should = c >= lineThreshold(members.get(lineId)!.size);
    const synth = (type: 'unitOn' | 'unitOff'): GameEvent => ({ ...e, type, unitId: lineId });
    if (should && !lineOn.has(lineId)) {
      lineOn.add(lineId);
      const prev = lastOffIdx.get(lineId);
      const prevE = prev === undefined ? null : out[prev];
      if (prevE && prevE.period === e.period && prevE.gameMs === e.gameMs) {
        out[prev!] = null; // went off and back on at the same moment: same shift
      } else {
        out.push(synth('unitOn'));
      }
      lastOffIdx.delete(lineId);
    } else if (!should && lineOn.has(lineId)) {
      lineOn.delete(lineId);
      lastOffIdx.set(lineId, out.length);
      out.push(synth('unitOff'));
    }
  }
  return out.filter((e): e is GameEvent => e !== null);
}

/** Lines that have at least one tracked player. */
function linesWithPlayers(meta: Pick<GameMeta, 'units' | 'players'>, players: readonly UnitDef[]): UnitDef[] {
  return rosterLines(meta).filter((l) => players.some((p) => p.lineId === l.id));
}

export interface ReportView {
  /** Rows in display order: lines mode = units; roster = each line then its players, extras, PP/PK. */
  units: UnitDef[];
  /** The log with derived line events (roster mode); unchanged in lines mode. */
  events: GameEvent[];
}

/** What the summary, timeline, CSV and PDF show for a game. */
export function reportView(meta: Pick<GameMeta, 'mode' | 'units' | 'players'>, events: readonly GameEvent[]): ReportView {
  if (!isRoster(meta)) return { units: [...meta.units], events: [...events] };
  const players = playerUnits(meta);
  const lines = linesWithPlayers(meta, players);
  const rows: UnitDef[] = [];
  for (const l of lines) rows.push(l, ...players.filter((p) => p.lineId === l.id));
  rows.push(...players.filter((p) => !p.lineId || !lines.some((l) => l.id === p.lineId)));
  rows.push(...meta.units.filter((u) => u.group === 'PP' || u.group === 'PK'));
  return { units: rows, events: withLineEvents(lines, players, events) };
}

export interface StatRow {
  /** 'line' = derived line row (roster mode), 'player' = a roster player, 'unit' = a tracked unit. */
  kind: 'line' | 'player' | 'unit';
  unit: UnitDef;
  stats: UnitStats;
}

/** Stats rows in report order (see reportView). */
export function statRows(
  meta: Pick<GameMeta, 'mode' | 'units' | 'players'>,
  events: readonly GameEvent[],
  opts: { period?: number; liveGameMs?: number } = {},
): StatRow[] {
  const view = reportView(meta, events);
  const stats = computeStats(view.units, view.events, opts);
  const roster = isRoster(meta);
  return view.units.map((unit, i) => ({
    kind: unit.kind === 'player' ? 'player' : roster && (unit.group === 'F' || unit.group === 'D') ? 'line' : 'unit',
    unit,
    stats: stats[i],
  }));
}

/** Display name for any unit, player or line id in a game. */
export function unitNamer(meta: Pick<GameMeta, 'mode' | 'units' | 'players'>): (id: string) => string {
  const all = [...meta.units, ...(isRoster(meta) ? playerUnits(meta) : [])];
  const names = new Map(all.map((u) => [u.id, u.name]));
  return (id) => names.get(id) ?? id;
}
