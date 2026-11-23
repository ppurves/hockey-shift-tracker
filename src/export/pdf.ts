// PDF report (2 pages, US Letter landscape, printable). Uses jsPDF with the
// built-in Helvetica, so it's ASCII-safe (no em dashes or triangles in text).
// The timeline arrives as a PNG data URL rendered from the same SVG as the app.

import { jsPDF } from 'jspdf';
import {
  computeStats,
  formatClock,
  toiCheck,
  type GameEvent,
  type GameMeta,
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
  const name = (id: string) => meta.units.find((u) => u.id === id)?.name ?? id;
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

  /** Simple table; returns the y below it. */
  const table = (y: number, cols: { label: string; w: number; align?: 'left' | 'right' }[], rows: string[][]) => {
    const rowH = 18;
    let x = M;
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(85, 103, 122);
    for (const c of cols) {
      doc.text(c.label, c.align === 'left' ? x + 4 : x + c.w - 4, y + 12, { align: c.align === 'left' ? 'left' : 'right' });
      x += c.w;
    }
    y += rowH;
    doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(11, 28, 46);
    rows.forEach((r, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(238, 242, 246).rect(M, y, cols.reduce((a, c) => a + c.w, 0), rowH, 'F');
      }
      x = M;
      r.forEach((cell, j) => {
        const c = cols[j];
        doc.setFont('helvetica', j === 0 ? 'bold' : 'normal');
        const t = fit(cell, c.w - 8);
        doc.text(t, c.align === 'left' ? x + 4 : x + c.w - 4, y + 12.5, { align: c.align === 'left' ? 'left' : 'right' });
        x += c.w;
      });
      y += rowH;
    });
    return y;
  };

  // ---- Page 1: header, stats table, goals, penalties.
  header(`generated ${new Date(generatedAt).toLocaleString()}`);
  let y = M + 56;
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(11, 28, 46).text('Unit stats (game)', M, y);
  y += 8;
  const stats = computeStats(meta.units, events);
  y = table(
    y,
    [
      { label: 'Unit', w: 160, align: 'left' }, { label: 'Shifts', w: 55 }, { label: 'TOI', w: 65 }, { label: 'Avg shift', w: 70 },
      { label: 'Longest', w: 65 }, { label: 'Shortest', w: 70 }, { label: 'Avg rest', w: 70 }, { label: 'GF', w: 45 }, { label: 'GA', w: 45 }, { label: '+/-', w: 50 },
    ],
    stats.map((s) => [
      name(s.unitId), String(s.shifts), formatClock(s.toiMs), fmt(s.avgMs), fmt(s.longestMs), fmt(s.shortestMs), fmt(s.avgRestMs),
      String(s.gf), String(s.ga), s.plusMinus > 0 ? `+${s.plusMinus}` : String(s.plusMinus),
    ]),
  );

  y += 22;
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
  const pf = events.filter((e) => e.type === 'penaltyFor').length;
  const pa = events.filter((e) => e.type === 'penaltyAgainst').length;
  if (y < H - M - 10) {
    y += 8;
    doc.setFont('helvetica', 'bold').text(`Penalties: ${pf} for, ${pa} against`, M, y);
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

  const checks = toiCheck(meta.units, events);
  const periods = checks.map((c) => c.period);
  const per = periods.map((p) => computeStats(meta.units, events, { period: p }));
  const colW = Math.min(80, (W - 2 * M - 170 - 80) / Math.max(periods.length, 1));
  doc.setFont('helvetica', 'bold').setFontSize(13).text('Time on ice by period', M, y);
  y += 8;
  y = table(
    y,
    [{ label: 'Unit', w: 170, align: 'left' }, ...periods.map((p) => ({ label: pl(p), w: colW })), { label: 'Game', w: 80 }],
    [
      ...stats.map((s, i) => [name(s.unitId), ...per.map((ps) => formatClock(ps[i].toiMs)), formatClock(s.toiMs)]),
      ['Game clock', ...checks.map((c) => formatClock(c.clockMs)), formatClock(checks.reduce((a, c) => a + c.clockMs, 0))],
    ],
  );
  if (y < H - M) {
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
