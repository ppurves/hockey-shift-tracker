// Timed penalties, derived from the log: when each started and ended, and the
// game condition (power play / penalty kill / 4-on-4) they add up to. Used by
// the timeline, the summary and the exports.

import { periodLengths } from './stats';
import type { GameEvent, PenaltyEndReason, PenaltySide } from './types';

export interface PenaltyPiece {
  period: number;
  startMs: number;
  endMs: number;
}

export interface PenaltyView {
  /** txn of the penalty event (its id). */
  ref: number;
  side: PenaltySide;
  period: number;
  gameMs: number;
  /** null for penalties logged before timed penalties (marker only). */
  lengthMs: number | null;
  playerId?: string;
  number?: string;
  /**
   * Where it ended. 'open' = still running when the log ends (live game) or
   * cut off by the end of the game. null for untimed penalties.
   */
  end: { period: number; gameMs: number; reason: PenaltyEndReason | 'open' } | null;
  /** The time served, split per period (empty for untimed penalties). */
  pieces: PenaltyPiece[];
}

export type Condition = 'PP' | 'PK' | 'EVEN';

export interface ConditionSegment extends PenaltyPiece {
  /** PP: more opponent penalties running; PK: more of ours; EVEN: equal (e.g. 4-on-4). */
  condition: Condition;
}

/** Period lengths so far: ended periods by their end, the last one by liveGameMs or its last event. */
function playedLengths(events: readonly GameEvent[], liveGameMs?: number) {
  const ended = periodLengths(events);
  const started = [...new Set(events.filter((e) => e.type === 'periodStart').map((e) => e.period))].sort((a, b) => a - b);
  const last = started[started.length - 1];
  const len: Record<number, number> = {};
  const off: Record<number, number> = {};
  let acc = 0;
  for (const p of started) {
    const latest = Math.max(0, ...events.filter((e) => e.period === p).map((e) => e.gameMs));
    len[p] = ended[p] ?? (p === last && liveGameMs !== undefined ? Math.max(liveGameMs, latest) : latest);
    off[p] = acc;
    acc += len[p];
  }
  return { started, len, off, total: acc };
}

export function derivePenalties(events: readonly GameEvent[], liveGameMs?: number): PenaltyView[] {
  const { started, len, off, total } = playedLengths(events, liveGameMs);
  const abs = (period: number, ms: number) => (off[period] ?? 0) + ms;
  const views: PenaltyView[] = [];
  const endAbs = new Map<number, { abs: number; period: number; gameMs: number; reason: PenaltyEndReason }>();
  for (const e of events) {
    if (e.type === 'penaltyFor' || e.type === 'penaltyAgainst') {
      views.push({
        ref: e.txn,
        side: e.type === 'penaltyFor' ? 'for' : 'against',
        period: e.period,
        gameMs: e.gameMs,
        lengthMs: e.lengthMs && e.lengthMs > 0 ? e.lengthMs : null,
        ...(e.playerId ? { playerId: e.playerId } : {}),
        ...(e.number ? { number: e.number } : {}),
        end: null,
        pieces: [],
      });
    } else if (e.type === 'penaltyInfo') {
      const v = views.find((x) => x.ref === e.ref);
      if (!v) continue;
      if (e.playerId !== undefined) { if (e.playerId) v.playerId = e.playerId; else delete v.playerId; }
      if (e.number !== undefined) { if (e.number) v.number = e.number; else delete v.number; }
      if (e.lengthMs && e.lengthMs > 0 && v.lengthMs !== null) v.lengthMs = e.lengthMs;
    } else if (e.type === 'penaltyEnd' && !endAbs.has(e.ref)) {
      endAbs.set(e.ref, { abs: abs(e.period, e.gameMs), period: e.period, gameMs: e.gameMs, reason: e.reason });
    }
  }
  /** Game time across periods → (period, ms), preferring the earlier period at a boundary. */
  const locate = (a: number) => {
    const p = started.find((q) => a <= off[q] + len[q]) ?? started[started.length - 1];
    return { period: p, gameMs: Math.max(0, a - off[p]) };
  };
  for (const v of views) {
    if (v.lengthMs === null) continue;
    const start = abs(v.period, v.gameMs);
    const expiry = start + v.lengthMs;
    const ended = endAbs.get(v.ref);
    let stop: number;
    if (ended) {
      stop = ended.abs;
      v.end = { period: ended.period, gameMs: ended.gameMs, reason: ended.reason };
    } else if (expiry <= total) {
      stop = expiry; // e.g. added in a post-game edit: served in full
      v.end = { ...locate(expiry), reason: 'expired' };
    } else {
      stop = total;
      v.end = { ...locate(total), reason: 'open' };
    }
    for (const p of started) {
      const s = Math.max(start, off[p]);
      const e = Math.min(stop, off[p] + len[p]);
      if (e > s) v.pieces.push({ period: p, startMs: s - off[p], endMs: e - off[p] });
    }
  }
  return views;
}

/** Splits each period into PP / PK / EVEN stretches while timed penalties run. */
export function conditionSegments(penalties: readonly PenaltyView[]): ConditionSegment[] {
  const out: ConditionSegment[] = [];
  const periods = [...new Set(penalties.flatMap((p) => p.pieces.map((x) => x.period)))].sort((a, b) => a - b);
  for (const period of periods) {
    const pieces = penalties.flatMap((p) => p.pieces.filter((x) => x.period === period).map((x) => ({ ...x, side: p.side })));
    const points = [...new Set(pieces.flatMap((x) => [x.startMs, x.endMs]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const on = pieces.filter((x) => x.startMs <= a && x.endMs >= b);
      if (!on.length) continue;
      const f = on.filter((x) => x.side === 'for').length;
      const g = on.length - f;
      const condition: Condition = f > g ? 'PP' : g > f ? 'PK' : 'EVEN';
      const prev = out[out.length - 1];
      if (prev && prev.period === period && prev.condition === condition && prev.endMs === a) prev.endMs = b;
      else out.push({ period, startMs: a, endMs: b, condition });
    }
  }
  return out;
}

/** Total game time per condition (all periods, or one). */
export function conditionTotals(penalties: readonly PenaltyView[], period?: number): Record<Condition, number> {
  const t: Record<Condition, number> = { PP: 0, PK: 0, EVEN: 0 };
  for (const s of conditionSegments(penalties)) if (period === undefined || s.period === period) t[s.condition] += s.endMs - s.startMs;
  return t;
}

const END_TEXT: Record<PenaltyEndReason | 'open', string> = {
  expired: 'served', goal: 'ended by goal', manual: 'ended early', open: 'still running',
};
const pl = (p: number) => (p <= 3 ? `P${p}` : p === 4 ? 'OT' : `OT${p - 3}`);
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/** Who's in the box: the player's name (roster), "#12" (lines mode), or "". */
export function penaltyPlayer(p: Pick<PenaltyView, 'playerId' | 'number'>, name: (id: string) => string): string {
  return p.playerId ? name(p.playerId) : p.number ? `#${p.number}` : '';
}

/** "ended by goal, P2 1:00" (ASCII only: also used in the PDF). */
export function penaltyEndText(p: PenaltyView): string {
  if (!p.end) return '';
  return p.end.reason === 'open' ? END_TEXT.open : `${END_TEXT[p.end.reason]}, ${pl(p.end.period)} ${clock(p.end.gameMs)}`;
}
