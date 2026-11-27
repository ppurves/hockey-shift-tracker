// Builds the game timeline as a standalone SVG string (no DOM). Used by the
// summary screen and rasterised into the PDF report. Colours are inlined so
// the SVG renders the same anywhere.

import { conditionSegments, derivePenalties, type Condition } from './penalties';
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
const GROUP_COLOR: Record<Group, string> = { F: '#56b4e9', D: '#009e73', G: '#9aa5b1', PP: '#e69f00', PK: '#cc79a7' };
/** Game condition lane: power play, penalty kill, and even (e.g. 4-on-4, hatched grey). */
const COND_COLOR: Record<Condition, string> = { PP: '#e69f00', PK: '#cc79a7', EVEN: 'url(#hst-even)' };
const COND_LABEL: Record<Condition, string> = { PP: 'Power play', PK: 'Penalty kill', EVEN: '4-on-4' };
/** Penalty box time in a player's row: hatched red, so it differs from shifts by pattern as well as colour. */
const BOX = 'url(#hst-box)';
const BOX_EDGE = '#c0392b';
const DEFS =
  '<defs>' +
  '<pattern id="hst-box" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<rect width="6" height="6" fill="#c0392b"/><rect width="2.5" height="6" fill="#f5b7b1"/></pattern>' +
  '<pattern id="hst-even" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<rect width="6" height="6" fill="#8a96a3"/><rect width="2.5" height="6" fill="#c9d1d9"/></pattern>' +
  '</defs>';
const GF = '#0072b2';
const GA = '#d55e00';

const LABEL_W = 96;
const RIGHT_PAD = 14;
const TOP_LANE = 30;
const ROW_H = 30;
/** Roster players get thinner rows under their line. */
const PLAYER_ROW_H = 22;
const AXIS_H = 22;
const LEGEND_ROW = 22;
const COND_H = 26;

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
  const inView = (period: number) => segOf.has(period);
  const penalties = derivePenalties(opts.events, opts.liveGameMs);
  const timed = penalties.filter((p) => p.lengthMs !== null);
  const conds = conditionSegments(timed).filter((sg) => inView(sg.period));
  const hasCond = timed.length > 0;
  const condY = TOP_LANE + COND_H / 2;
  const rowsTop = TOP_LANE + (hasCond ? COND_H : 0);
  const unitIndex = new Map(opts.units.map((u, i) => [u.id, i]));
  const boxed = timed.filter((p) => p.side === 'against' && p.playerId && unitIndex.has(p.playerId));

  // Legend items, wrapped to the width.
  const legend: { draw: (x: number, y: number) => string; text: string; w: number }[] = [
    { draw: (x, y) => triangle(x + 4, y, 10, true, GF, '#ffffff'), text: 'Goal for', w: 74 },
    { draw: (x, y) => triangle(x + 4, y, 10, false, GA, '#ffffff'), text: 'Goal against', w: 98 },
    { draw: (x, y) => flag(x + 2, y, true, c.text), text: 'Penalty for', w: 90 },
    { draw: (x, y) => flag(x + 2, y, false, c.text), text: 'Penalty against', w: 110 },
  ];
  const swatch = (fill: string) => (x: number, y: number) => `<rect x="${n(x - 2)}" y="${n(y - 5)}" width="12" height="10" rx="2" fill="${fill}"/>`;
  for (const k of ['PP', 'PK', 'EVEN'] as Condition[]) {
    if (conds.some((sg) => sg.condition === k)) legend.push({ draw: swatch(COND_COLOR[k]), text: COND_LABEL[k], w: k === 'EVEN' ? 66 : 90 });
  }
  if (boxed.length) legend.push({ draw: swatch(BOX), text: 'In penalty box', w: 104 });
  const legendX0 = width < 540 ? 12 : LABEL_W;
  const legendPos: { x: number; row: number }[] = [];
  {
    let lx = legendX0, row = 0;
    for (const it of legend) {
      if (lx + it.w > width - RIGHT_PAD && lx > legendX0) { lx = legendX0; row++; }
      legendPos.push({ x: lx, row });
      lx += it.w;
    }
  }
  const legendRows = (legendPos[legendPos.length - 1]?.row ?? 0) + 1;
  const rowH = opts.units.map((u) => (u.kind === 'player' ? PLAYER_ROW_H : ROW_H));
  const rowTop: number[] = [];
  let acc = rowsTop;
  for (const h of rowH) { rowTop.push(acc); acc += h; }
  const rowsBottom = acc;
  const height = rowsBottom + AXIS_H + legendRows * LEGEND_ROW + 6;
  const rowY = (i: number) => rowTop[i] + rowH[i] / 2;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">`,
    DEFS,
    `<rect width="${width}" height="${height}" fill="${c.bg}"/>`,
  );

  // Game condition lane: PP / PK / 4-on-4 while timed penalties run, with the
  // penalized player's number on each penalty kill.
  if (hasCond) {
    out.push(
      `<text x="${LABEL_W - 8}" y="${n(condY + 4)}" fill="${c.text}" font-size="12.5" font-weight="700" text-anchor="end">PP / PK</text>`,
      `<line x1="${LABEL_W}" y1="${n(condY)}" x2="${LABEL_W + plotW}" y2="${n(condY)}" stroke="${c.track}" stroke-width="1"/>`,
    );
    for (const sg of conds) {
      const x1 = x(sg.period, sg.startMs);
      const w = Math.max(x(sg.period, sg.endMs) - x1, 1.5);
      out.push(`<rect class="cond cond-${sg.condition}" x="${n(x1)}" y="${n(condY - 9)}" width="${n(w)}" height="18" rx="3" fill="${COND_COLOR[sg.condition]}"/>`);
    }
    for (const p of timed) {
      if (p.side !== 'against') continue;
      const piece = p.pieces.find((pc) => inView(pc.period));
      const num = p.playerId ? opts.units.find((u) => u.id === p.playerId)?.number : p.number;
      if (!piece || !num) continue;
      const x1 = x(piece.period, piece.startMs);
      if (x(piece.period, piece.endMs) - x1 < 20) continue;
      out.push(`<text class="box-label" x="${n(x1 + 3)}" y="${n(condY + 4)}" fill="#000" font-size="10.5" font-weight="700">#${escapeXml(num)}</text>`);
    }
  }

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
    const player = u.kind === 'player';
    const label = u.name.length > 13 ? `${u.name.slice(0, 12)}…` : u.name;
    const barH = player ? 10 : 16;
    out.push(
      player
        ? `<text x="${LABEL_W - 8}" y="${n(y + 4)}" fill="${c.muted}" font-size="11" text-anchor="end">${escapeXml(label)}</text>`
        : `<text x="${LABEL_W - 8}" y="${n(y + 4)}" fill="${c.text}" font-size="12.5" font-weight="700" text-anchor="end">${escapeXml(label)}</text>`,
      `<line x1="${LABEL_W}" y1="${n(y)}" x2="${LABEL_W + plotW}" y2="${n(y)}" stroke="${c.track}" stroke-width="1"/>`,
    );
    for (const s of shifts.filter((sh) => sh.unitId === u.id)) {
      const x1 = x(s.period, s.startMs);
      const w = Math.max(x(s.period, s.endMs) - x1, 1.5);
      out.push(`<rect class="shift" data-unit="${escapeXml(u.id)}" x="${n(x1)}" y="${n(y - barH / 2)}" width="${n(w)}" height="${barH}" rx="2" fill="${GROUP_COLOR[u.group]}"${s.open ? ` fill-opacity="0.6"` : ''}/>`);
    }
  });

  // Penalty box time in the penalized player's row.
  for (const p of boxed) {
    const i = unitIndex.get(p.playerId!)!;
    const y = rowY(i);
    for (const pc of p.pieces) {
      if (!inView(pc.period)) continue;
      const x1 = x(pc.period, pc.startMs);
      const w = Math.max(x(pc.period, pc.endMs) - x1, 1.5);
      out.push(`<rect class="box" data-unit="${escapeXml(p.playerId!)}" x="${n(x1)}" y="${n(y - 6)}" width="${n(w)}" height="12" rx="2" fill="${BOX}" stroke="${BOX_EDGE}" stroke-width="1"/>`);
    }
  }

  // Goals: a dashed line through all rows, a marker in the top lane, and a
  // marker on the track of each unit that was on the ice.
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
        if (i !== undefined) out.push(`<g class="goal-on-ice ${e.type}">${triangle(ex, rowY(i), opts.units[i].kind === 'player' ? 9 : 11, up, col, mk)}</g>`);
      }
    } else if (e.type === 'penaltyFor' || e.type === 'penaltyAgainst') {
      out.push(`<g class="penalty ${e.type}">${flag(ex, TOP_LANE / 2, e.type === 'penaltyFor', c.text)}</g>`);
    }
  }

  // Legend.
  const legendTop = rowsBottom + AXIS_H;
  legend.forEach((it, i) => {
    const lx = legendPos[i].x;
    const ly = legendTop + legendPos[i].row * LEGEND_ROW + LEGEND_ROW / 2;
    out.push(it.draw(lx, ly), `<text x="${n(lx + 15)}" y="${n(ly + 4)}" fill="${c.muted}" font-size="11">${it.text}</text>`);
  });

  out.push('</svg>');
  return { svg: out.join(''), width, height };
}
