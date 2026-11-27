import { useState } from 'react';
import {
  describeTxn,
  exclusionSet,
  formatClock,
  gameMsAt,
  isRoster,
  lineThreshold,
  restMsAt,
  rosterLines,
  unitNamer,
  type GameMeta,
  type Command,
  type GameEvent,
  type UnitDef,
} from '../../core';
import { ConfirmSheet, type SheetAction } from '../components/ConfirmSheet';
import { TapButton } from '../components/TapButton';
import { Toast, useToast } from '../components/Toast';
import { navigate } from '../hooks/useHashRoute';
import { useDisplayClock } from '../hooks/useDisplayClock';
import type { GameSession } from '../hooks/useGameSession';
import { useWakeLock } from '../hooks/useWakeLock';
import { useSettings } from '../hooks/useSettings';
import { tick } from '../audio';

export const periodLabel = (p: number) => (p <= 3 ? `P${p}` : p === 4 ? 'OT' : `OT${p - 3}`);

type Row = { key: string; label: string; units: UnitDef[]; line?: UnitDef };

/** Up to 4 special-teams tiles share a row; more get a PP row and a PK row. */
function stRows(st: UnitDef[]): Row[] {
  return st.length > 4
    ? [
        { key: 'PP', label: 'Power play', units: st.filter((u) => u.group === 'PP') },
        { key: 'PK', label: 'Penalty kill', units: st.filter((u) => u.group === 'PK') },
      ]
    : [{ key: 'ST', label: 'Special teams', units: st }];
}

/**
 * Roster mode: one row per line (a line tile, then its players), a row of
 * extras, then special teams. `tracked` is the engine's unit list.
 */
function rosterRows(meta: GameMeta, tracked: readonly UnitDef[]): Row[] {
  const players = tracked.filter((u) => u.kind === 'player');
  const lineRows: Row[] = rosterLines(meta)
    .map((line) => ({ key: line.id, label: line.name, line, units: players.filter((p) => p.lineId === line.id) }))
    .filter((r) => r.units.length);
  const extras = players.filter((p) => !lineRows.some((r) => r.line!.id === p.lineId));
  const extraRows: Row[] = extras.length > 5
    ? [
        { key: 'XF', label: 'Extra forwards', units: extras.filter((p) => p.group === 'F') },
        { key: 'XD', label: 'Extra defense', units: extras.filter((p) => p.group === 'D') },
      ]
    : [{ key: 'X', label: 'Extras', units: extras }];
  return [...lineRows, ...extraRows, ...stRows(tracked.filter((u) => u.group === 'PP' || u.group === 'PK'))].filter((r) => r.units.length);
}

/** Units grouped into on-screen rows: forwards, defense, special teams (PP + PK). */
function rows(units: readonly UnitDef[]): Row[] {
  const by = (set: string) => units.filter((u) => exclusionSet(u.group) === set);
  const st = by('ST');
  return [
    { key: 'F', label: 'Forwards', units: by('F') },
    { key: 'D', label: 'Defense', units: by('D') },
    ...stRows(st),
  ].filter((r) => r.units.length);
}

export function Capture({ session }: { session: GameSession }) {
  const { meta, engine, dispatch, undo, updateMeta, saveError } = session;
  const s = engine.state;
  useDisplayClock(s.running); // re-render trigger only
  const gameMs = gameMsAt(s, Date.now());
  const wake = useWakeLock(meta.status === 'live');
  const { toast, show } = useToast();
  const [sheet, setSheet] = useState<{ title: string; message?: string; actions: SheetAction[] } | null>(null);

  const livePeriod = s.period !== null && !s.periodEnded;
  const nextPeriod = (s.period ?? 0) + 1;
  const paused = livePeriod && !s.running;
  const overLength = livePeriod && gameMs >= meta.periodLengthMs;
  const name = unitNamer(meta);
  const roster = isRoster(meta);
  const undoPeek = engine.peekUndo();

  const { settings } = useSettings();
  const run = (cmd: Command) => {
    if (settings.audioTick) tick();
    const r = dispatch(cmd);
    if (!r.ok) show(r.reason, 'error');
    return r;
  };

  const goal = (type: 'goalFor' | 'goalAgainst') => {
    const r = run({ type });
    if (r.ok) {
      const e = r.events[0] as Extract<GameEvent, { onIce: string[] }>;
      const who = e.onIce.length ? e.onIce.map(name).join(', ') : 'no units on ice';
      show(`${type === 'goalFor' ? '▲ Goal for' : '▼ Goal against'} (${e.strength}) · ${who}`);
    }
  };

  const confirmStart = (p: number) =>
    setSheet({
      title: `Start ${periodLabel(p)}?`,
      message: livePeriod
        ? `Ends ${periodLabel(s.period!)} at ${formatClock(gameMs)} and takes every unit off the ice. ${periodLabel(p)} starts at 0:00, paused.`
        : `${periodLabel(p)} starts at 0:00, paused. Tap Resume at the faceoff.`,
      actions: [{ label: `Start ${periodLabel(p)}`, onConfirm: () => { run({ type: 'startPeriod', period: p }); setSheet(null); } }],
    });

  const endGame = () => {
    if (livePeriod) run({ type: 'endPeriod' });
    void updateMeta({ status: 'final' }).then(() => navigate(`game/${meta.id}/summary`));
  };

  const openPeriodSheet = () => {
    const actions: SheetAction[] = [];
    if (livePeriod) {
      actions.push({ label: `End ${periodLabel(s.period!)} now`, tone: 'danger', onConfirm: () => { run({ type: 'endPeriod' }); setSheet(null); } });
    }
    actions.push({ label: `Start ${periodLabel(nextPeriod)}`, onConfirm: () => confirmStart(nextPeriod) });
    actions.push({ label: 'View summary & timeline', onConfirm: () => navigate(`game/${meta.id}/summary`) });
    if (s.period !== null) actions.push({ label: 'End game', tone: 'danger', onConfirm: endGame });
    setSheet({
      title: s.period === null ? 'Periods' : `${periodLabel(s.period)}${s.periodEnded ? ' (ended)' : ''} · ${formatClock(gameMs)}`,
      message: 'Ending a period takes every unit off the ice and stops the clock.',
      actions,
    });
  };

  const mainButton = !livePeriod
    ? { label: `Start ${periodLabel(nextPeriod)}`, cls: 'start', onTap: () => confirmStart(nextPeriod) }
    : s.running
      ? { label: 'Pause all', cls: 'pause', onTap: () => run({ type: 'pause' }) }
      : { label: '▶ Resume', cls: 'resume', onTap: () => run({ type: 'resume' }) };

  const doUndo = () => {
    const undone = undo();
    if (undone.length) show(`Undone: ${describeTxn(undone, engine.units, engine.lines)}`);
  };

  const unitRows = roster ? rosterRows(meta, engine.units) : rows(meta.units);

  /** A line or pair (lines mode), a PP/PK unit, or a roster player. */
  const unitTile = (u: UnitDef) => {
    const a = s.active[u.id];
    const ms = a ? gameMs - a.startMs : s.lastShiftMs[u.id] ?? 0;
    // Rest and long-shift flags are for lines, D pairs and skaters only.
    const evenStrength = u.group === 'F' || u.group === 'D';
    const rest = evenStrength && !a && s.period !== null ? restMsAt(s, u.id, s.periodEnded ? s.accMs : gameMs) : null;
    const longShift = evenStrength && !!a && ms > settings.longShiftMs;
    const longRest = rest !== null && rest > settings.longRestMs;
    const state = a ? '● ON ICE' : rest !== null ? `off ${formatClock(rest)}` : s.lastShiftMs[u.id] !== undefined ? 'last shift' : '';
    const player = u.kind === 'player';
    const title = player && u.number ? `#${u.number}` : u.name;
    const sub = player && u.number ? u.name.replace(/^#\S+\s*/, '') : '';
    return (
      <TapButton
        key={u.id}
        className={`tile g-${u.group} ${player ? 'player' : ''} ${a ? 'on' : ''} ${longShift ? 'long-shift' : ''} ${longRest ? 'long-rest' : ''}`}
        aria-pressed={!!a}
        aria-label={`${u.name}, ${a ? 'on ice' : 'off'}, ${formatClock(ms)}${longShift ? ', long shift' : ''}${rest !== null ? `, off for ${formatClock(rest)}` : ''}`}
        data-unit={u.id}
        onTap={() => run({ type: 'tapUnit', unitId: u.id })}
      >
        <span className="tile-name">{title}</span>
        {sub && <span className="tile-pname">{sub}</span>}
        <span className="tile-time">{formatClock(ms)}</span>
        <span className="tile-state" data-testid={`rest-${u.id}`}>{state}</span>
      </TapButton>
    );
  };

  /** Roster mode: puts the whole line on (or off when it's all on). */
  const lineTile = (line: UnitDef, members: UnitDef[]) => {
    const on = members.filter((m) => s.active[m.id]);
    const isOn = on.length >= lineThreshold(members.length);
    const full = on.length === members.length;
    // Longest current shift among its players, so a tired line stands out.
    const ms = on.reduce((m, p) => Math.max(m, gameMs - s.active[p.id].startMs), 0);
    const longShift = on.length > 0 && ms > settings.longShiftMs;
    const state = full ? '● ON ICE' : on.length ? `${on.length}/${members.length} on` : 'tap: all on';
    return (
      <TapButton
        key={`line-${line.id}`}
        className={`tile line-tile g-${line.group} ${isOn ? 'on' : ''} ${on.length && !full ? 'partial' : ''} ${longShift ? 'long-shift' : ''}`}
        aria-pressed={full}
        aria-label={`${line.name}, ${on.length} of ${members.length} on ice${on.length ? `, ${formatClock(ms)}` : ''}. Tap to ${full ? 'take the line off' : 'put the whole line on'}`}
        data-line={line.id}
        onTap={() => run({ type: 'tapLine', lineId: line.id })}
      >
        <span className="tile-name">{line.name}</span>
        <span className="tile-time">{on.length ? formatClock(ms) : '—'}</span>
        <span className="tile-state">{state}</span>
      </TapButton>
    );
  };

  return (
    <div className={`capture ${paused ? 'is-paused' : ''} ${s.running ? 'is-running' : ''}`}>
      <header className="cap-header">
        <button className="cap-back" onClick={() => navigate('')} aria-label="Back to games">‹</button>
        <button className="cap-period" onClick={openPeriodSheet} aria-label="Period options">
          {s.period === null ? '—' : periodLabel(s.period)} ▾
        </button>
        <div className={`cap-clock ${overLength ? 'over' : ''}`} data-testid="game-clock" aria-label="Game clock">
          {formatClock(gameMs)}
          {overLength && <small>period length reached</small>}
        </div>
        <div className="cap-score" data-testid="score" aria-label={`Score ${s.score.for} to ${s.score.against}`}>
          <span className="for">{s.score.for}</span>–<span className="against">{s.score.against}</span>
          <small>vs {meta.opponent}</small>
        </div>
      </header>

      <div className="cap-strips">
        {saveError && <div className="strip error" role="alert">{saveError}</div>}
        {(wake === 'unsupported' || wake === 'failed') && (
          <div className="strip warn" data-testid="wake-warning">Screen may lock: wake lock {wake}. Set Auto-Lock to Never during the game.</div>
        )}
        {paused && <div className="strip paused" role="status">⏸ PAUSED: clock stopped</div>}
        {s.period === null && <div className="strip info">Tap “Start P1” when you're ready.</div>}
        {s.periodEnded && <div className="strip info">{periodLabel(s.period!)} ended. Start {periodLabel(nextPeriod)} when ready.</div>}
      </div>

      <main
        className={`cap-units ${roster ? 'roster' : ''}`}
        // Roster rows share one column grid so pairs and extras line up with the lines.
        style={roster ? ({ '--cols': Math.max(4, ...unitRows.map((r) => r.units.length + (r.line ? 1 : 0))) } as React.CSSProperties) : undefined}
      >
        {unitRows.map((row) => (
          <section key={row.key} className={`unit-row row-${row.key}`} aria-label={row.label}>
            {row.line && lineTile(row.line, row.units)}
            {row.units.map(unitTile)}
          </section>
        ))}
      </main>

      <section className="cap-events" aria-label="Goals and penalties">
        <TapButton className="ev gf" disabled={!livePeriod} onTap={() => goal('goalFor')}>▲ Goal<br />For</TapButton>
        <TapButton className="ev ga" disabled={!livePeriod} onTap={() => goal('goalAgainst')}>▼ Goal<br />Against</TapButton>
        <TapButton className="ev pf" disabled={!livePeriod} onTap={() => run({ type: 'penaltyFor' }).ok && show('⚑ Penalty for')}>⚑ Penalty<br />For</TapButton>
        <TapButton className="ev pa" disabled={!livePeriod} onTap={() => run({ type: 'penaltyAgainst' }).ok && show('⚐ Penalty against')}>⚐ Penalty<br />Against</TapButton>
      </section>

      <footer className="cap-footer">
        <TapButton className="undo" disabled={!undoPeek} onTap={doUndo} aria-label={undoPeek ? `Undo ${undoPeek.label}` : 'Nothing to undo'}>
          ↶ Undo
          <small>{undoPeek ? undoPeek.label : 'nothing'}</small>
        </TapButton>
        <TapButton className={`main ${mainButton.cls}`} onTap={mainButton.onTap}>{mainButton.label}</TapButton>
      </footer>

      <Toast toast={toast} />
      {sheet && <ConfirmSheet {...sheet} onCancel={() => setSheet(null)} />}
    </div>
  );
}
