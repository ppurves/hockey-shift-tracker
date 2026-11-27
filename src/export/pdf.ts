// PDF report (2 pages, US Letter landscape, printable). Uses jsPDF with the
// built-in Helvetica, so it's ASCII-safe (no em dashes or triangles in text).
// The timeline arrives as a PNG data URL rendered from the same SVG as the app.

import { jsPDF } from 'jspdf';
import {
  conditionTotals,
  derivePenalties,
  formatClock,
  penaltyEndText,
  penaltyPlayer,
  isRoster,
  statRows,
  toiCheck,
  trackedUnits,
  unitNamer,
  type GameEvent,
  type GameMeta,
  type StatRow,
} from '../core';

const M = 36; // margin, pt
const fmt = (ms: number | null) => (ms === null ? '-' : formatClock(ms));
const pl = (p: number) => (p <= 3 ? `P${p}` : p === 4 ? 'OT' : `OT${p - 3}`);

export interface PdfInput {
  meta: GameMeta;
  events: readonly GameEvent[];
  /** JPEG or PNG data URL of the full-game timeline, and its pixel size. */
  timeline?: { dataUrl: string; width: number; height: number } | null;
  generatedAt: number;
  /** Deflate page streams (default true). Tests turn it off to read the text. */
  compress?: boolean;
}

export function buildPdf({ meta, events, timeline, generatedAt, compress = true }: PdfInput): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const name = unitNamer(meta);
  const roster = isRoster(meta);
  /** Players are indented under their line. */
  const rowLabel = (r: StatRow) => (r.kind === 'player' ? `   ${r.unit.name}` : r.unit.name);
  const fit = (s: string, max: number) => {
    if (doc.getTextWidth(s) <= max) return s;
    while (s.length > 1 && doc.getTextWidth(`${s}...`) > max) s = s.slice(0, -1);
    return `${s}...`;
  };

  const header = (subtitle: string) => {
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(11, 28, 46);
    doc.text(`${meta.homeAway === 'home' ? 'vs' : '@'} ${meta.opponent}`, M, M + 14);
    doc.text(`${meta.score.for} - ${meta.score.against}`, W - M, M + 14, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(85, 103, 122);
    doc.text(
      `${meta.date}  |  ${meta.homeAway === 'home' ? 'Home' : 'Away'}  |  ${meta.status === 'final' ? 'Final' : 'In progress'}  |  periods of ${formatClock(meta.periodLengthMs)}  |  ${subtitle}`,
      M, M + 32,
    );
    doc.setDrawColor(31, 78, 121).setLineWidth(1.5).line(M, M + 40, W - M, M + 40);
  };

  /**
   * Simple table; returns the y below it. Continues on a new page (with the
   * column headings again) when it runs out of room. `strong` rows (roster
   * line rows) are bold and shaded.
   */
  const table = (
    y: number,
    cols: { label: string; w: number; align?: 'left' | 'right' }[],
    rows: string[][],
    strong: boolean[] = [],
    subtitle = 'continued',
  ) => {
    const rowH = roster ? 16 : 18;
    const tableW = cols.reduce((a, c) => a + c.w, 0);
    const heads = () => {
      let hx = M;
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(85, 103, 122);
      for (const c of cols) {
        doc.text(c.label, c.align === 'left' ? hx + 4 : hx + c.w - 4, y + 12, { align: c.align === 'left' ? 'left' : 'right' });
        hx += c.w;
      }
      y += rowH;
    };
    heads();
    let x = M;
    rows.forEach((r, i) => {
      if (y + rowH > H - M) {
        doc.addPage('letter', 'landscape');
        header(subtitle);
        y = M + 52;
        heads();
      }
      doc.setFontSize(roster ? 9.5 : 10.5).setTextColor(11, 28, 46);
      if (strong[i]) {
        doc.setFillColor(214, 226, 238).rect(M, y, tableW, rowH, 'F');
      } else if (i % 2 === 0) {
        doc.setFillColor(238, 242, 246).rect(M, y, tableW, rowH, 'F');
      }
      x = M;
      r.forEach((cell, j) => {
        const c = cols[j];
        doc.setFont('helvetica', strong[i] || (j === 0 && !roster) ? 'bold' : 'normal');
        const t = fit(cell, c.w - 8);
        doc.text(t, c.align === 'left' ? x + 4 : x + c.w - 4, y + rowH - 5.5, { align: c.align === 'left' ? 'left' : 'right' });
        x += c.w;
      });
      y += rowH;
    });
    return y;
  };

  // ---- Page 1: header, stats table, goals, penalties.
  header(`generated ${new Date(generatedAt).toLocaleString()}`);
  let y = M + 56;
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(11, 28, 46).text(roster ? 'Time on ice by line and player (game)' : 'Unit stats (game)', M, y);
  y += 8;
  const rows = statRows(meta, events);
  const strong = rows.map((r) => r.kind === 'line');
  y = table(
    y,
    [
      { label: roster ? 'Line / player' : 'Unit', w: 160, align: 'left' }, { label: 'Shifts', w: 55 }, { label: 'TOI', w: 65 }, { label: 'Avg shift', w: 70 },
      { label: 'Longest', w: 65 }, { label: 'Shortest', w: 70 }, { label: 'Avg rest', w: 70 }, { label: 'GF', w: 45 }, { label: 'GA', w: 45 }, { label: '+/-', w: 50 },
    ],
    rows.map(({ stats: s, ...r }) => [
      rowLabel({ ...r, stats: s }), String(s.shifts), formatClock(s.toiMs), fmt(s.avgMs), fmt(s.longestMs), fmt(s.shortestMs), fmt(s.avgRestMs),
      String(s.gf), String(s.ga), s.plusMinus > 0 ? `+${s.plusMinus}` : String(s.plusMinus),
    ]),
    strong,
    'stats, continued',
  );
  if (roster && y < H - M - 12) {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(85, 103, 122);
    doc.text('Line rows: time a majority of the line was on the ice together (2 of 3 forwards, both D).', M, y + 11);
    y += 12;
  }

  y += 22;
  if (y > H - M - 60) {
    doc.addPage('letter', 'landscape');
    header('goals');
    y = M + 60;
  }
  doc.setTextColor(11, 28, 46);
  doc.setFont('helvetica', 'bold').setFontSize(13).text('Goals', M, y);
  doc.setFont('helvetica', 'normal').setFontSize(10.5);
  y += 16;
  const goals = events.filter((e): e is Extract<GameEvent, { onIce: string[] }> => e.type === 'goalFor' || e.type === 'goalAgainst');
  if (!goals.length) { doc.text('None.', M, y); y += 14; }
  for (const g of goals) {
    if (y > H - M - 20) { doc.text('(more goals in events.csv)', M, y); y += 14; break; }
    doc.setFont('helvetica', 'bold').text(g.type === 'goalFor' ? 'FOR' : 'AGAINST', M, y);
    doc.setFont('helvetica', 'normal').text(
      fit(`${pl(g.period)} ${formatClock(g.gameMs)}   ${g.strength}   on ice: ${g.onIce.map(name).join(', ') || 'none'}`, W - 2 * M - 70),
      M + 70, y,
    );
    y += 14;
  }
  // Penalties: each call with who is in the box, length and how it ended.
  const pens = derivePenalties(events);
  const totals = conditionTotals(pens);
  y += 10;
  if (y > H - M - 40) {
    doc.addPage('letter', 'landscape');
    header('penalties');
    y = M + 60;
  }
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(11, 28, 46).text('Penalties', M, y);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(85, 103, 122);
  doc.text(`Power play ${formatClock(totals.PP)}  |  Penalty kill ${formatClock(totals.PK)}${totals.EVEN ? `  |  4-on-4 ${formatClock(totals.EVEN)}` : ''}`, M + 80, y);
  doc.setFontSize(10.5).setTextColor(11, 28, 46);
  y += 16;
  if (!pens.length) { doc.text('None.', M, y); y += 14; }
  for (const p of pens) {
    if (y > H - M - 6) { doc.text('(more penalties in events.csv)', M, y); break; }
    const who = penaltyPlayer(p, name);
    doc.setFont('helvetica', 'bold').text(p.side === 'for' ? 'FOR (PP)' : 'AGAINST (PK)', M, y);
    doc.setFont('helvetica', 'normal').text(
      fit(`${pl(p.period)} ${formatClock(p.gameMs)}${who ? `   ${who}` : ''}${p.lengthMs ? `   ${formatClock(p.lengthMs)}` : ''}${p.end ? `   ${penaltyEndText(p)}` : ''}`, W - 2 * M - 90),
      M + 90, y,
    );
    y += 14;
  }

  // ---- Page 2: timeline + TOI by period + sanity check.
  doc.addPage('letter', 'landscape');
  header('timeline');
  y = M + 56;
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(11, 28, 46).text('Timeline (full game)', M, y);
  y += 8;
  if (timeline) {
    const w = W - 2 * M;
    const h = Math.min((timeline.height / timeline.width) * w, H * 0.5);
    doc.addImage(timeline.dataUrl, timeline.dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', M, y, (timeline.width / timeline.height) * h, h, undefined, 'FAST');
    y += h + 18;
  } else {
    doc.setFont('helvetica', 'normal').setFontSize(10).text('(timeline image unavailable)', M, y + 14);
    y += 30;
  }

  const checks = toiCheck(trackedUnits(meta), events);
  const periods = checks.map((c) => c.period);
  const per = periods.map((p) => statRows(meta, events, { period: p }));
  // Roster mode: lots of rows, so TOI by period gets a page of its own.
  if (roster && y > H * 0.55) {
    doc.addPage('letter', 'landscape');
    header('time on ice by period');
    y = M + 60;
  }
  const colW = Math.min(80, (W - 2 * M - 170 - 80) / Math.max(periods.length, 1));
  doc.setFont('helvetica', 'bold').setFontSize(13).text('Time on ice by period', M, y);
  y += 8;
  y = table(
    y,
    [{ label: 'Unit', w: 170, align: 'left' }, ...periods.map((p) => ({ label: pl(p), w: colW })), { label: 'Game', w: 80 }],
    [
      ...rows.map((r, i) => [rowLabel(r), ...per.map((ps) => formatClock(ps[i].stats.toiMs)), formatClock(r.stats.toiMs)]),
      ['Game clock', ...checks.map((c) => formatClock(c.clockMs)), formatClock(checks.reduce((a, c) => a + c.clockMs, 0))],
    ],
    [...strong, true],
    'time on ice by period, continued',
  );
  if (roster && y < H - M) {
    const avg = (k: 'F' | 'D') => checks.map((c) => `${pl(c.period)} ${c.clockMs ? (c.sums[k] / c.clockMs).toFixed(2) : '-'}`).join(', ');
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(85, 103, 122);
    doc.text(`Check, average skaters on ice: forwards ${avg('F')}; defense ${avg('D')} (normally 3 and 2).`, M, Math.min(y + 14, H - M / 2));
  } else if (y < H - M) {
    const ok = checks.every((c) => c.sums.F === c.clockMs && c.sums.D === c.clockMs);
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(85, 103, 122);
    doc.text(
      ok ? 'Check: forward TOI and defense TOI each equal the game clock in every period.'
        : 'Check: forward or defense TOI differs from the game clock in some period (a line or pair was off the ice).',
      M, Math.min(y + 14, H - M / 2),
    );
  }
  return doc;
}
