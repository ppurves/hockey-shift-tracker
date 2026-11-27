// CSV exports (pure). Excel- and Numbers-friendly: UTF-8 BOM, CRLF, quoted
// fields where needed, and times both as m:ss and as plain seconds.

import { formatClock, formatMaybe } from './format';
import { isRoster, playerUnits, statRows, unitNamer, type StatRow } from './roster';
import { deriveShifts, shiftMs } from './stats';
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

const ROW_TYPE: Record<StatRow['kind'], string> = { line: 'Line', player: 'Player', unit: 'Unit' };

/**
 * Per-unit stats: whole game first, then each period. Roster games list each
 * line followed by its players (with Type, Number and Line columns).
 */
export function summaryCsv(meta: GameMeta, events: readonly GameEvent[]): string {
  const roster = isRoster(meta);
  const name = unitNamer(meta);
  const scopes: (number | undefined)[] = [undefined, ...periodsOf(events)];
  const rows = scopes.flatMap((period) =>
    statRows(meta, events, { period }).map(({ kind, unit: u, stats: s }) => [
      period === undefined ? 'Game' : `P${period}`,
      ...(roster ? [ROW_TYPE[kind], u.name, u.number ?? '', u.kind === 'player' ? (u.lineId ? name(u.lineId) : 'Extra') : ''] : [u.name]),
      u.group, s.shifts,
      formatClock(s.toiMs), secs(s.toiMs), formatMaybe(s.avgMs), secs(s.avgMs),
      formatMaybe(s.longestMs), secs(s.longestMs), formatMaybe(s.shortestMs), secs(s.shortestMs),
      formatMaybe(s.avgRestMs), secs(s.avgRestMs),
      s.gf, s.ga, s.plusMinus,
    ]),
  );
  const stats = ['Group', 'Shifts', 'TOI', 'TOI (s)', 'Avg shift', 'Avg (s)', 'Longest', 'Longest (s)', 'Shortest', 'Shortest (s)', 'Avg rest', 'Avg rest (s)', 'GF', 'GA', '+/-'];
  return roster
    ? toCsv(['Scope', 'Type', 'Unit', 'Number', 'Line', ...stats], rows, [2, 3, 4])
    : toCsv(['Scope', 'Unit', ...stats], rows, [1]);
}

export function shiftsCsv(meta: GameMeta, events: readonly GameEvent[]): string {
  const roster = isRoster(meta);
  const units = roster ? [...playerUnits(meta), ...meta.units] : meta.units;
  const name = unitNamer(meta);
  const order = new Map(units.map((u, i) => [u.id, i]));
  const rank = (id: string) => order.get(id) ?? units.length;
  const shifts = deriveShifts(events).sort((a, b) => a.period - b.period || a.startMs - b.startMs || rank(a.unitId) - rank(b.unitId));
  const times = ['Group', 'Period', 'Start', 'End', 'Duration', 'Start (s)', 'End (s)', 'Duration (s)'];
  return toCsv(
    roster ? ['Unit', 'Number', 'Line', ...times] : ['Unit', ...times],
    shifts.map((s) => {
      const u = units.find((x) => x.id === s.unitId);
      const who = roster
        ? [u?.name ?? s.unitId, u?.number ?? '', u?.kind === 'player' ? (u.lineId ? name(u.lineId) : 'Extra') : '']
        : [u?.name ?? s.unitId];
      return [...who, u?.group ?? '', s.period, formatClock(s.startMs), formatClock(s.endMs), formatClock(shiftMs(s)), secs(s.startMs), secs(s.endMs), secs(shiftMs(s))];
    }),
    roster ? [0, 1, 2] : [0],
  );
}

const EVENT_LABEL: Partial<Record<GameEvent['type'], string>> = {
  periodStart: 'Period start', periodEnd: 'Period end', pause: 'Pause', resume: 'Resume',
  goalFor: 'Goal for', goalAgainst: 'Goal against', penaltyFor: 'Penalty for', penaltyAgainst: 'Penalty against',
};

/** Goals, penalties, pauses and period boundaries (shift on/off are in shifts.csv). */
export function eventsCsv(meta: GameMeta, events: readonly GameEvent[]): string {
  const name = unitNamer(meta);
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
  const rows = statRows(meta, events);
  const label = (r: StatRow) => (r.kind === 'player' ? `  ${r.unit.name}` : r.unit.name);
  const w = Math.max(6, ...rows.map((r) => label(r).length));
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const lines = [
    `${meta.date} ${meta.homeAway === 'home' ? 'vs' : '@'} ${meta.opponent}: ${meta.score.for}-${meta.score.against}`,
    '',
    `${'Unit'.padEnd(w)} Shifts   TOI   Avg  GF GA  +/-`,
    ...rows.map((r) => {
      const s = r.stats;
      const pm = s.plusMinus > 0 ? `+${s.plusMinus}` : String(s.plusMinus);
      return `${label(r).padEnd(w)} ${pad(s.shifts, 6)} ${pad(formatClock(s.toiMs), 5)} ${pad(formatMaybe(s.avgMs), 5)} ${pad(s.gf, 3)} ${pad(s.ga, 2)} ${pad(pm, 4)}`;
    }),
    '',
    'Sent from Hockey Shift Tracker',
  ];
  return lines.join('\n');
}
