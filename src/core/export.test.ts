import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  computeStats,
  csvField,
  deriveShifts,
  eventsCsv,
  fileBase,
  generateDemoGame,
  makeBackup,
  normalizeSettings,
  parseBackup,
  shiftsCsv,
  summaryCsv,
  summaryText,
} from '.';

const demo = generateDemoGame({ id: 'demo', startWall: Date.UTC(2026, 10, 21, 19) });
const parse = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('csv', () => {
  it('quotes and guards fields', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=SUM(A1)', true)).toBe("'=SUM(A1)");
    expect(csvField(-1)).toBe('-1'); // numbers are not touched
    expect(csvField(null)).toBe('');
  });

  it('file names are YYYY-MM-DD_vs_Opponent', () => {
    expect(fileBase({ ...demo.meta, date: '2026-11-21', opponent: 'St. Mary’s / Hawks' })).toBe('2026-11-21_vs_St-Mary-s-Hawks');
    expect(fileBase({ ...demo.meta, opponent: '' })).toMatch(/_vs_Opponent$/);
  });

  it('summary.csv: BOM, header, a game row per unit then one per unit per period', () => {
    const csv = summaryCsv(demo.meta, demo.events);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = parse(csv);
    expect(lines[0]).toBe('Scope,Unit,Group,Shifts,TOI,TOI (s),Avg shift,Avg (s),Longest,Longest (s),Shortest,Shortest (s),Avg rest,Avg rest (s),GF,GA,+/-');
    expect(lines).toHaveLength(1 + 9 * 4);
    const l1 = computeStats(demo.meta.units, demo.events).find((s) => s.unitId === 'L1')!;
    expect(lines[1].split(',').slice(0, 4)).toEqual(['Game', 'Line 1', 'F', String(l1.shifts)]);
    expect(lines[1].split(',')[5]).toBe(String(Math.round(l1.toiMs / 1000)));
  });

  it('shifts.csv has every shift; events.csv has goals, penalties and pauses but no shift taps', () => {
    expect(parse(shiftsCsv(demo.meta, demo.events))).toHaveLength(1 + deriveShifts(demo.events).length);
    const ev = parse(eventsCsv(demo.meta, demo.events)).slice(1).map((l) => l.split(',')[3]);
    expect(ev).toContain('Goal for');
    expect(ev).toContain('Penalty against');
    expect(ev).toContain('Pause');
    expect(ev.filter((t) => t === 'Period start')).toHaveLength(3);
    expect(ev.join()).not.toMatch(/unit/i);
  });

  it('summary text has score and one line per unit', () => {
    const t = summaryText(demo.meta, demo.events);
    expect(t).toContain('vs Demo Hawks: 4-2');
    expect(t.split('\n').filter((l) => /^(Line|D|PP|PK) \d/.test(l))).toHaveLength(9);
  });
});

describe('backup', () => {
  it('round-trips every game and the settings', () => {
    const settings = { ...DEFAULT_SETTINGS, recipientEmail: 'coach@example.com' };
    const b = makeBackup([demo, { ...demo, meta: { ...demo.meta, id: 'x' } }], settings, 0);
    const back = parseBackup(JSON.stringify(b));
    expect(back.games).toEqual(b.games);
    expect(back.settings).toEqual(settings);
  });

  it('rejects non-backups with readable messages', () => {
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Hockey Shift Tracker backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'hockey-shift-tracker', version: 99, games: [] }))).toThrow(/newer version/);
    const bad = makeBackup([demo], DEFAULT_SETTINGS, 0);
    (bad.games[0].events[3] as { type: string }).type = 'explode';
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/Game 1, event 4/);
  });

  it('normalizes partial settings', () => {
    expect(normalizeSettings({ audioTick: true })).toMatchObject({ audioTick: true, recipientEmail: '', defaultPeriodLengthMs: 900_000 });
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toMatchObject({ longShiftMs: 90_000, longRestMs: 300_000 });
    expect(normalizeSettings({ longShiftMs: 75_000, longRestMs: 240_000 })).toMatchObject({ longShiftMs: 75_000, longRestMs: 240_000 });
    expect(normalizeSettings({ longShiftMs: 0, longRestMs: 'x' })).toMatchObject({ longShiftMs: 90_000, longRestMs: 300_000 });
  });
});
