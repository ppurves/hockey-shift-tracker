import { sanitizeRoster } from './roster';
import type { GameMeta, Player, TrackMode, UnitDef } from './types';
import { DEFAULT_UNITS } from './units';

export const DEFAULT_PERIOD_MS = 15 * 60_000;

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface NewGameInput {
  opponent: string;
  date?: string;
  homeAway?: 'home' | 'away';
  periodLengthMs?: number;
  units?: UnitDef[];
  mode?: TrackMode;
  /** Roster mode only. */
  players?: Player[];
}

export function newGameMeta(input: NewGameInput, id: string, now: number): GameMeta {
  const units = (input.units ?? DEFAULT_UNITS).map((u) => ({ ...u }));
  const roster = input.mode === 'roster';
  return {
    id,
    opponent: input.opponent.trim() || 'Opponent',
    date: input.date || isoDate(now),
    homeAway: input.homeAway ?? 'home',
    periodLengthMs: input.periodLengthMs && input.periodLengthMs > 0 ? input.periodLengthMs : DEFAULT_PERIOD_MS,
    units,
    mode: roster ? 'roster' : 'lines',
    ...(roster ? { players: sanitizeRoster(input.players ?? [], units).map((p) => ({ ...p })) } : {}),
    status: 'live',
    score: { for: 0, against: 0 },
    createdAt: now,
    updatedAt: now,
  };
}
