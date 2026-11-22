// CSV exports (pure). Excel- and Numbers-friendly: UTF-8 BOM, CRLF, quoted
// fields where needed, and times both as m:ss and as plain seconds.

import { formatClock, formatMaybe } from './format';
import { computeStats, deriveShifts, shiftMs } from './stats';
import type { GameEvent, GameMeta } from './types';

const BOM = '﻿';

/** Quotes a field if needed; neutralises spreadsheet formula injection in text. */
export function csvField(v: string | number | null | undefined, text = false): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: (string | number | null)[][], textCols: number[] = []): string {
  const line = (r: (string | number | null)[]) => r.map((v, i) => csvField(v, textCols.includes(i))).join(',');
  return BOM + [line(header), ...rows.map(line)].join('\r\n') + '\r\n';
}

const secs = (ms: number | null) => (ms === null ? null : Math.round(ms / 1000));
const periodsOf = (events: readonly GameEvent[]) =>
  [...new Set(events.filter((e) => e.type === 'periodStart').map((e) => e.period))].sort((a, b) => a - b);

/** "2026-11-21_vs_Hawks": safe on every OS. */
export function fileBase(meta: GameMeta): string {
  const opp = meta.opponent.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'Opponent';
  return `${meta.date}_vs_${opp}`;
}

/** Per-unit stats: whole game first, then each period. */
export function summaryCsv(meta: GameMeta, events: readonly GameEvent[]): string {
  const scopes: (number | undefined)[] = [undefined, ...periodsOf(events)];
  const rows = scopes.flatMap((period) =>
    computeStats(meta.units, events, { period }).map((s) => {
      const u = meta.units.find((x) => x.id === s.unitId)!;
      return [
        period === undefined ? 'Game' : `P${period}`, u.name, u.group, s.shifts,
        formatClock(s.toiMs), secs(s.toiMs), formatMaybe(s.avgMs), secs(s.avgMs),
        formatMaybe(s.longestMs), secs(s.longestMs), formatMaybe(s.shortestMs), secs(s.shortestMs),
        s.gf, s.ga, s.plusMinus,
      ];
    }),
  );
  return toCsv(
    ['Scope', 'Unit', 'Group', 'Shifts', 'TOI', 'TOI (s)', 'Avg shift', 'Avg (s)', 'Longest', 'Longest (s)', 'Shortest', 'Shortest (s)', 'GF', 'GA', '+/-'],
    rows,
    [1],
  );
}

export function shiftsCsv(meta: GameMeta, events: readonly GameEvent[]): string {
  const order = new Map(meta.units.map((u, i) => [u.id, i]));
  const shifts = deriveShifts(events).sort((a, b) => a.period - b.period || a.startMs - b.startMs || order.get(a.unitId)! - order.get(b.unitId)!);
  return toCsv(
    ['Unit', 'Group', 'Period', 'Start', 'End', 'Duration', 'Start (s)', 'End (s)', 'Duration (s)'],
    shifts.map((s) => {
      const u = meta.units.find((x) => x.id === s.unitId);
      return [u?.name ?? s.unitId, u?.group ?? '', s.period, formatClock(s.startMs), formatClock(s.endMs), formatClock(shiftMs(s)), secs(s.startMs), secs(s.endMs), secs(shiftMs(s))];
    }),
    [0],
  );
}

const EVENT_LABEL: Partial<Record<GameEvent['type'], string>> = {
  periodStart: 'Period start', periodEnd: 'Period end', pause: 'Pause', resume: 'Resume',
  goalFor: 'Goal for', goalAgainst: 'Goal against', penaltyFor: 'Penalty for', penaltyAgainst: 'Penalty against',
};

/** Goals, penalties, pauses and period boundaries (shift on/off are in shifts.csv). */
export function eventsCsv(meta: GameMeta, events: readonly GameEvent[]): string {
  const name = (id: string) => meta.units.find((u) => u.id === id)?.name ?? id;
  return toCsv(
    ['Period', 'Game time', 'Game time (s)', 'Event', 'Strength', 'On ice', 'Wall clock'],
    events
      .filter((e) => EVENT_LABEL[e.type])
      .map((e) => [
        e.period, formatClock(e.gameMs), secs(e.gameMs), EVENT_LABEL[e.type]!,
        'strength' in e ? e.strength : '', 'onIce' in e ? e.onIce.map(name).join('; ') : '',
        e.wallTs ? new Date(e.wallTs).toISOString() : '',
      ]),
    [5],
  );
}

/** Plain-text stats table for an email body (mailto fallback, share text). */
export function summaryText(meta: GameMeta, events: readonly GameEvent[]): string {
  const stats = computeStats(meta.units, events);
  const w = Math.max(6, ...meta.units.map((u) => u.name.length));
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const lines = [
    `${meta.date} ${meta.homeAway === 'home' ? 'vs' : '@'} ${meta.opponent}: ${meta.score.for}-${meta.score.against}`,
    '',
    `${'Unit'.padEnd(w)} Shifts   TOI   Avg  GF GA  +/-`,
    ...stats.map((s) => {
      const u = meta.units.find((x) => x.id === s.unitId)!;
      const pm = s.plusMinus > 0 ? `+${s.plusMinus}` : String(s.plusMinus);
      return `${u.name.padEnd(w)} ${pad(s.shifts, 6)} ${pad(formatClock(s.toiMs), 5)} ${pad(formatMaybe(s.avgMs), 5)} ${pad(s.gf, 3)} ${pad(s.ga, 2)} ${pad(pm, 4)}`;
    }),
    '',
    'Sent from Hockey Shift Tracker',
  ];
  return lines.join('\n');
}
