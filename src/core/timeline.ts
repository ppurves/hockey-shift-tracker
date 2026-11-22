// Builds the game timeline as a standalone SVG string (no DOM). Used by the
// summary screen and rasterised into the PDF report. Colours are inlined so
// the SVG renders the same anywhere.

import { deriveShifts, periodLengths } from './stats';
import type { GameEvent, Group, UnitDef } from './types';

export type TimelineTheme = 'dark' | 'light';

export interface TimelineOptions {
  units: readonly UnitDef[];
  events: readonly GameEvent[];
  /** A period number, or 'all' for the whole game laid end to end. */
  period: number | 'all';
  periodLengthMs: number;
  /** Current game time, so open shifts in the live period are drawn. */
  liveGameMs?: number;
  /** Total SVG width in px (default 760). */
  width?: number;
  theme?: TimelineTheme;
}

export interface TimelineResult {
  svg: string;
  width: number;
  height: number;
}

const PALETTE = {
  dark: { bg: '#0b1c2e', text: '#f4f7fb', muted: '#9fb3c8', track: '#2c4a68', grid: '#1d3550', gridMajor: '#2f5070' },
  light: { bg: '#ffffff', text: '#0b1c2e', muted: '#55677a', track: '#b8c6d4', grid: '#eef2f6', gridMajor: '#cfd9e3' },
};
// Okabe-Ito based, colour-blind safe. Goals also differ by shape (▲ / ▼).
const GROUP_COLOR: Record<Group, string> = { F: '#56b4e9', D: '#009e73', PP: '#e69f00', PK: '#cc79a7' };
const GF = '#0072b2';
const GA = '#d55e00';

const LABEL_W = 96;
const RIGHT_PAD = 14;
const TOP_LANE = 30;
const ROW_H = 30;
const AXIS_H = 22;
const LEGEND_ROW = 22;

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const n = (v: number) => (Math.round(v * 10) / 10).toString();

function triangle(x: number, y: number, size: number, up: boolean, fill: string, stroke: string) {
  const h = size, w = size * 1.15;
  const pts = up
    ? [[x, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]]
    : [[x, y + h / 2], [x + w / 2, y - h / 2], [x - w / 2, y - h / 2]];
  return `<polygon points="${pts.map(([a, b]) => `${n(a)},${n(b)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
}

function flag(x: number, y: number, filled: boolean, color: string) {
  return (
    `<line x1="${n(x)}" y1="${n(y - 8)}" x2="${n(x)}" y2="${n(y + 8)}" stroke="${color}" stroke-width="1.6"/>` +
    `<polygon points="${n(x)},${n(y - 8)} ${n(x + 10)},${n(y - 4)} ${n(x)},${n(y)}" fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="1.4"/>`
  );
}

/** Periods shown, each with its drawn length and x-offset in ms. */
function segments(opts: TimelineOptions) {
  const ended = periodLengths(opts.events);
  const started = [...new Set(opts.events.filter((e) => e.type === 'periodStart').map((e) => e.period))].sort((a, b) => a - b);
  const lastPeriod = started[started.length - 1];
  const lengthOf = (p: number) => {
    const played = ended[p] ?? (p === lastPeriod ? opts.liveGameMs ?? 0 : 0);
    return Math.max(opts.periodLengthMs, played);
  };
  const list = opts.period === 'all' ? (started.length ? started : [1, 2, 3]) : [opts.period];
  let offset = 0;
  return list.map((p) => {
    const seg = { period: p, offset, length: lengthOf(p) };
    offset += seg.length;
    return seg;
  });
}

export function timelineSvg(opts: TimelineOptions): TimelineResult {
  const c = PALETTE[opts.theme ?? 'dark'];
  const mk = '#ffffff'; // white outline keeps goal markers visible on bars and on the dark background
  const width = opts.width ?? 760;
  const plotW = width - LABEL_W - RIGHT_PAD;
  const segs = segments(opts);
  const totalMs = segs.reduce((a, s) => a + s.length, 0) || 1;
  const segOf = new Map(segs.map((s) => [s.period, s]));
  const x = (period: number, ms: number) => LABEL_W + ((segOf.get(period)!.offset + ms) / totalMs) * plotW;
  const rowsTop = TOP_LANE;
  const legendRows = width < 540 ? 2 : 1;
  const height = rowsTop + opts.units.length * ROW_H + AXIS_H + legendRows * LEGEND_ROW + 6;
  const rowY = (i: number) => rowsTop + i * ROW_H + ROW_H / 2;
  const rowsBottom = rowsTop + opts.units.length * ROW_H;
  const inView = (period: number) => segOf.has(period);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="${c.bg}"/>`,
  );

  // Grid: a line every minute, stronger every 5 minutes, with labels.
  for (const s of segs) {
    for (let m = 0; m * 60_000 <= s.length; m++) {
      const gx = x(s.period, m * 60_000);
      const major = m % 5 === 0;
      if (!major && plotW / (totalMs / 60_000) < 6) continue; // too dense
      out.push(`<line x1="${n(gx)}" y1="${rowsTop}" x2="${n(gx)}" y2="${rowsBottom}" stroke="${major ? c.gridMajor : c.grid}" stroke-width="${major && m === 0 ? 2 : 1}"/>`);
      const isLastSeg = s === segs[segs.length - 1];
      // Skip the end-of-period label where the next period's "P#" label starts.
      if (major && m > 0 && (isLastSeg || (m + 1) * 60_000 <= s.length)) {
        const anchor = gx > width - RIGHT_PAD - 16 ? 'end' : 'middle';
        out.push(`<text x="${n(gx)}" y="${rowsBottom + 15}" fill="${c.muted}" font-size="11" text-anchor="${anchor}">${m}:00</text>`);
      }
    }
    if (segs.length > 1) {
      out.push(`<text x="${n(x(s.period, 0) + 4)}" y="${rowsBottom + 15}" fill="${c.text}" font-size="11" font-weight="700">P${s.period}</text>`);
    }
  }

  // Unit rows: label, track and shift bars.
  const shifts = deriveShifts(opts.events, opts.liveGameMs).filter((s) => inView(s.period));
  opts.units.forEach((u, i) => {
    const y = rowY(i);
    const label = u.name.length > 13 ? `${u.name.slice(0, 12)}…` : u.name;
    out.push(
      `<text x="${LABEL_W - 8}" y="${n(y + 4)}" fill="${c.text}" font-size="12.5" font-weight="700" text-anchor="end">${escapeXml(label)}</text>`,
      `<line x1="${LABEL_W}" y1="${n(y)}" x2="${LABEL_W + plotW}" y2="${n(y)}" stroke="${c.track}" stroke-width="1"/>`,
    );
    for (const s of shifts.filter((sh) => sh.unitId === u.id)) {
      const x1 = x(s.period, s.startMs);
      const w = Math.max(x(s.period, s.endMs) - x1, 1.5);
      out.push(`<rect class="shift" data-unit="${escapeXml(u.id)}" x="${n(x1)}" y="${n(y - 8)}" width="${n(w)}" height="16" rx="2" fill="${GROUP_COLOR[u.group]}"${s.open ? ` fill-opacity="0.6"` : ''}/>`);
    }
  });

  // Goals: a dashed line through all rows, a marker in the top lane, and a
  // marker on the track of each unit that was on the ice.
  const unitIndex = new Map(opts.units.map((u, i) => [u.id, i]));
  for (const e of opts.events) {
    if (!inView(e.period)) continue;
    const ex = x(e.period, e.gameMs);
    if (e.type === 'goalFor' || e.type === 'goalAgainst') {
      const up = e.type === 'goalFor';
      const col = up ? GF : GA;
      out.push(
        `<line x1="${n(ex)}" y1="${rowsTop}" x2="${n(ex)}" y2="${rowsBottom}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>`,
        `<g class="goal ${e.type}">${triangle(ex, TOP_LANE / 2, 13, up, col, mk)}</g>`,
      );
      for (const id of e.onIce) {
        const i = unitIndex.get(id);
        if (i !== undefined) out.push(`<g class="goal-on-ice ${e.type}">${triangle(ex, rowY(i), 11, up, col, mk)}</g>`);
      }
    } else if (e.type === 'penaltyFor' || e.type === 'penaltyAgainst') {
      out.push(`<g class="penalty ${e.type}">${flag(ex, TOP_LANE / 2, e.type === 'penaltyFor', c.text)}</g>`);
    }
  }

  // Legend.
  const legendTop = rowsBottom + AXIS_H;
  const legendX = legendRows === 2 ? 12 : LABEL_W;
  let lx = legendX;
  let ly = legendTop + LEGEND_ROW / 2;
  const item = (draw: (x: number, y: number) => string, text: string, w: number, breakAfter = false) => {
    out.push(draw(lx, ly), `<text x="${n(lx + 15)}" y="${n(ly + 4)}" fill="${c.muted}" font-size="11">${text}</text>`);
    lx += w;
    if (breakAfter && legendRows === 2) { lx = legendX; ly += LEGEND_ROW; }
  };
  item((x, y) => triangle(x + 4, y, 10, true, GF, mk), 'Goal for', 74);
  item((x, y) => triangle(x + 4, y, 10, false, GA, mk), 'Goal against', 98, true);
  item((x, y) => flag(x + 2, y, true, c.text), 'Penalty for', 90);
  item((x, y) => flag(x + 2, y, false, c.text), 'Penalty against', 110);

  out.push('</svg>');
  return { svg: out.join(''), width, height };
}
