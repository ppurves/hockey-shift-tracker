import { useEffect, useState } from 'react';
import {
  describeTxn,
  exclusionSet,
  formatClock,
  boxPenalty,
  gameMsAt,
  isRoster,
  penaltyRemainingMs,
  type ActivePenalty,
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
import { PenaltySheet, type PenaltyChoice } from '../components/PenaltySheet';
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
 * extras, goalies, then any legacy special-teams units. `tracked` is the engine's unit list.
 */
function rosterRows(meta: GameMeta, tracked: readonly UnitDef[]): Row[] {
  const players = tracked.filter((u) => u.kind === 'player' && u.group !== 'G');
  const goalies = tracked.filter((u) => u.kind === 'player' && u.group === 'G');
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
  return [
    ...lineRows,
    ...extraRows,
    { key: 'G', label: 'Goalies', units: goalies },
    ...stRows(tracked.filter((u) => u.group === 'PP' || u.group === 'PK')),
  ].filter((r) => r.units.length);
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
  const { meta, engine, dispatch, undo, settle, updateMeta, saveError } = session;
  const s = engine.state;
  useDisplayClock(s.running); // re-render trigger only
  const gameMs = gameMsAt(s, Date.now());
  const wake = useWakeLock(meta.status === 'live');
  const { toast, show } = useToast();
  const [sheet, setSheet] = useState<{ title: string; message?: string; actions: SheetAction[] } | null>(null);
  const [penaltySheet, setPenaltySheet] = useState<{ ref: number; title: string; initial: PenaltyChoice } | null>(null);

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

  // Penalties end on the game clock: write the end the moment time runs out.
  // Runs after every render (~4 Hz while the clock runs).
  useEffect(() => {
    const settled = settle();
    if (settled.length) show(settled.length > 1 ? 'Penalties over' : `${penaltyText(settled[0])} over`);
  });

  /** "Power play" / "Penalty kill" for a penaltyEnd event (looks up the penalty's side). */
  function penaltyText(e: GameEvent) {
    const ref = e.type === 'penaltyEnd' ? e.ref : e.txn;
    const call = engine.events.find((x) => x.txn === ref && (x.type === 'penaltyFor' || x.type === 'penaltyAgainst'));
    return call?.type === 'penaltyFor' ? 'Power play' : 'Penalty kill';
  }

  const goal = (type: 'goalFor' | 'goalAgainst') => {
    const r = run({ type });
    if (r.ok) {
      const e = r.events.find((x) => x.type === type) as Extract<GameEvent, { onIce: string[] }>;
      const who = e.onIce.length ? e.onIce.map(name).join(', ') : 'no units on ice';
      const ended = r.events.some((x) => x.type === 'penaltyEnd' && x.txn === e.txn);
      show(`${type === 'goalFor' ? '▲ Goal for' : '▼ Goal against'} (${e.strength}) · ${who}${ended ? ` · ${type === 'goalFor' ? 'power play' : 'penalty kill'} over` : ''}`);
    }
  };

  /** Skaters for the penalty sheet (roster), or null (lines mode: type a number). */
  const skaters = roster ? engine.units.filter((u) => u.kind === 'player' && (u.group === 'F' || u.group === 'D')) : null;
  const openPenaltySheet = (p: ActivePenalty) =>
    setPenaltySheet({
      ref: p.ref,
      title: 'Penalty against: who and how long?',
      initial: { playerId: p.playerId ?? null, number: p.number ?? '', lengthMs: p.lengthMs },
    });
  const savePenalty = (ref: number, c: PenaltyChoice) => {
    setPenaltySheet(null);
    const p = s.penalties.find((x) => x.ref === ref);
    if (!p) return;
    const cmd: Command = { type: 'penaltyInfo', ref };
    if (roster && (c.playerId ?? null) !== (p.playerId ?? null)) cmd.playerId = c.playerId;
    if (!roster && c.number !== (p.number ?? '')) cmd.number = c.number || null;
    if (c.lengthMs !== p.lengthMs) cmd.lengthMs = c.lengthMs;
    if (Object.keys(cmd).length > 2 && run(cmd).ok) show(`Penalty: ${c.playerId ? name(c.playerId) : c.number ? `#${c.number}` : 'no player'} · ${formatClock(c.lengthMs)}`);
  };

  const penalty = (type: 'penaltyFor' | 'penaltyAgainst') => {
    const r = run({ type, lengthMs: settings.defaultPenaltyMs });
    if (!r.ok) return;
    if (type === 'penaltyFor') {
      show(`⚑ Penalty for · power play ${formatClock(settings.defaultPenaltyMs)}`);
      return;
    }
    const e = r.events.find((x) => x.type === 'penaltyAgainst')!;
    const p = engine.state.penalties.find((x) => x.ref === e.txn);
    if (p) openPenaltySheet(p);
  };

  /** Tap a PP/PK strip: change the player or length, or end it early. */
  const openConditionSheet = (p: ActivePenalty) => {
    const actions: SheetAction[] = [];
    if (p.side === 'against') actions.push({ label: 'Change player or length', onConfirm: () => { setSheet(null); openPenaltySheet(p); } });
    actions.push({
      label: `End ${p.side === 'for' ? 'power play' : 'penalty kill'} now`,
      tone: 'danger',
      onConfirm: () => { setSheet(null); if (run({ type: 'endPenalty', ref: p.ref }).ok) show(`${p.side === 'for' ? 'Power play' : 'Penalty kill'} ended`); },
    });
    setSheet({
      title: `${p.side === 'for' ? 'Power play' : 'Penalty kill'} · ${formatClock(penaltyRemainingMs(s, p, Date.now()))} left`,
      message: 'It ends by itself when the time runs out, or on a power-play goal.',
      actions,
    });
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
    // Numbers only on player tiles: easier to read and hit on a phone.
    const title = player && u.number ? `#${u.number}` : u.name;
    const box = player && !a ? boxPenalty(s, u.id) : undefined;
    const boxLeft = box ? penaltyRemainingMs(s, box, Date.now()) : 0;
    if (u.group === 'G') {
      // Goalies: in net or not; no timers.
      return (
        <TapButton
          key={u.id}
          className={`tile g-G player ${a ? 'on' : ''}`}
          aria-pressed={!!a}
          aria-label={`Goalie ${u.name}, ${a ? 'in net' : 'not in net'}`}
          data-unit={u.id}
          onTap={() => run({ type: 'tapUnit', unitId: u.id })}
        >
          <span className="tile-name">{title}</span>
          <span className="tile-state">{a ? '● IN NET' : 'goalie'}</span>
        </TapButton>
      );
    }
    return (
      <TapButton
        key={u.id}
        className={`tile g-${u.group} ${player ? 'player' : ''} ${a ? 'on' : ''} ${longShift ? 'long-shift' : ''} ${longRest && !box ? 'long-rest' : ''} ${box ? 'in-box' : ''}`}
        aria-pressed={!!a}
        aria-disabled={box ? true : undefined}
        disabled={!!box}
        aria-label={box
          ? `${u.name}, in the penalty box, ${formatClock(boxLeft)} left`
          : `${u.name}, ${a ? 'on ice' : 'off'}, ${formatClock(ms)}${longShift ? ', long shift' : ''}${rest !== null ? `, off for ${formatClock(rest)}` : ''}`}
        data-unit={u.id}
        onTap={() => run({ type: 'tapUnit', unitId: u.id })}
      >
        <span className="tile-name">{title}</span>
        <span className="tile-time">{box ? formatClock(boxLeft) : formatClock(ms)}</span>
        <span className="tile-state" data-testid={`rest-${u.id}`}>{box ? 'IN BOX' : state}</span>
      </TapButton>
    );
  };

  /** Roster mode: puts the whole line on (or off when it's all on). */
  const lineTile = (line: UnitDef, members: UnitDef[]) => {
    const on = members.filter((m) => s.active[m.id]);
    const boxed = members.filter((m) => !s.active[m.id] && boxPenalty(s, m.id)).length;
    const isOn = on.length >= lineThreshold(members.length);
    const full = on.length === members.length;
    // Longest current shift among its players, so a tired line stands out.
    const ms = on.reduce((m, p) => Math.max(m, gameMs - s.active[p.id].startMs), 0);
    const longShift = on.length > 0 && ms > settings.longShiftMs;
    const state = full ? '● ON ICE' : on.length ? boxed ? `${on.length}/${members.length} +box` : `${on.length}/${members.length} on` : 'tap: all on';
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
        {s.penalties.length > 0 && (
          <div className="cond-strips">
            {[...s.penalties]
              .sort((a, b) => penaltyRemainingMs(s, a, Date.now()) - penaltyRemainingMs(s, b, Date.now()))
              .map((p) => {
                const who = p.playerId ? name(p.playerId).split(' ')[0] : p.number ? `#${p.number}` : '';
                return (
                  <button
                    key={p.ref}
                    className={`strip cond ${p.side === 'for' ? 'pp' : 'pk'}`}
                    data-testid={`cond-${p.side}`}
                    onClick={() => openConditionSheet(p)}
                    aria-label={`${p.side === 'for' ? 'Power play' : 'Penalty kill'}, ${formatClock(penaltyRemainingMs(s, p, Date.now()))} left${who ? `, ${who} in the box` : ''}. Tap for options.`}
                  >
                    {p.side === 'for' ? 'PP' : 'PK'} {formatClock(penaltyRemainingMs(s, p, Date.now()))}
                    {who && <small> · {who} in box</small>}
                  </button>
                );
              })}
          </div>
        )}
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
        <TapButton className="ev pf" disabled={!livePeriod} onTap={() => penalty('penaltyFor')}>⚑ Penalty<br />For</TapButton>
        <TapButton className="ev pa" disabled={!livePeriod} onTap={() => penalty('penaltyAgainst')}>⚐ Penalty<br />Against</TapButton>
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
      {penaltySheet && (
        <PenaltySheet
          title={penaltySheet.title}
          players={skaters}
          unavailable={new Set(s.penalties.filter((p) => p.ref !== penaltySheet.ref && p.playerId).map((p) => p.playerId!))}
          initial={penaltySheet.initial}
          defaultLengthMs={settings.defaultPenaltyMs}
          onSave={(c) => savePenalty(penaltySheet.ref, c)}
          onCancel={() => setPenaltySheet(null)}
        />
      )}
    </div>
  );
}
