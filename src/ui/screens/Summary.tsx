import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatClock,
  formatMaybe,
  gameMsAt,
  isRoster,
  reportView,
  statRows,
  timelineSvg,
  toiCheck,
  unitNamer,
  type GameEvent,
} from '../../core';
import { navigate } from '../hooks/useHashRoute';
import { useDisplayClock } from '../hooks/useDisplayClock';
import type { GameSession } from '../hooks/useGameSession';
import { periodLabel } from './Capture';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(360);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Summary({ session }: { session: GameSession }) {
  const { meta, engine } = session;
  const s = engine.state;
  const live = meta.status === 'live';
  useDisplayClock(live && s.running);
  const liveGameMs = live && s.period !== null && !s.periodEnded ? gameMsAt(s, Date.now()) : undefined;
  const events = engine.events as GameEvent[];

  const periods = s.periodsStarted.length ? [...s.periodsStarted].sort((a, b) => a - b) : [1, 2, 3];
  const [tab, setTab] = useState<number | 'all'>('all');
  const [boxRef, boxW] = useWidth<HTMLDivElement>();

  const timelineWidth = tab === 'all' ? Math.max(boxW, 1100) : Math.max(boxW, 360);
  const roster = isRoster(meta);
  const svg = useMemo(() => {
    const view = reportView(meta, events);
    return timelineSvg({ units: view.units, events: view.events, period: tab, periodLengthMs: meta.periodLengthMs, liveGameMs, width: timelineWidth }).svg;
  // liveGameMs changes every tick only while live; that's the point.
  }, [meta, events, events.length, tab, liveGameMs, timelineWidth]);
  const rows = statRows(meta, events, { period: tab === 'all' ? undefined : tab, liveGameMs });
  const checks = toiCheck(engine.units, events, liveGameMs).filter((r) => tab === 'all' || r.period === tab);
  const goals = events.filter((e) => (e.type === 'goalFor' || e.type === 'goalAgainst') && (tab === 'all' || e.period === tab));
  const name = unitNamer(meta);
  const avgOn = (sum: number, clock: number) => (clock > 0 ? (sum / clock).toFixed(2) : '—');

  return (
    <main className="page summary">
      <div className="sum-top">
        <button className="link-btn" onClick={() => navigate('')}>‹ Games</button>
        {live && <button className="link-btn" onClick={() => navigate(`game/${meta.id}`)}>Live capture ›</button>}
      </div>
      <h1>
        {meta.homeAway === 'home' ? 'vs' : '@'} {meta.opponent}{' '}
        <span className="sum-score" data-testid="summary-score">{meta.score.for}–{meta.score.against}</span>
      </h1>
      <p className="muted small">{meta.date} · {live ? 'in progress' : 'final'} · periods of {formatClock(meta.periodLengthMs)}</p>

      <div className="sum-actions">
        <button className="big-btn primary" onClick={() => navigate(`game/${meta.id}/export`)}>✉ Export &amp; email</button>
        {!live && <button className="big-btn" onClick={() => navigate(`game/${meta.id}/edit`)}>✎ Edit shifts &amp; events</button>}
      </div>

      <div className="tabs" role="tablist" aria-label="Period">
        {[...periods, 'all' as const].map((p) => (
          <button key={p} role="tab" aria-selected={tab === p} className={tab === p ? 'sel' : ''} onClick={() => setTab(p)}>
            {p === 'all' ? 'All' : periodLabel(p)}
          </button>
        ))}
      </div>

      <div ref={boxRef} className="timeline-box" aria-label="Shift timeline">
        <div className="timeline-scroll" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      {tab === 'all' && boxW < 1100 && <p className="muted small">Scroll sideways for the full game, or turn the phone.</p>}

      <h2>{roster ? 'Time on ice' : 'Unit stats'} {tab === 'all' ? '(game)' : `(${periodLabel(tab)})`}</h2>
      <div className="table-scroll">
        <table className="stats" data-testid="stats-table">
          <thead>
            <tr>
              <th scope="col">{roster ? 'Line / player' : 'Unit'}</th><th scope="col">Shifts</th><th scope="col">TOI</th><th scope="col">Avg</th>
              <th scope="col">Long</th><th scope="col">Short</th><th scope="col" title="Average time between shifts">Rest</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">+/-</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ kind, unit, stats: st }) => (
              <tr key={unit.id} className={`row-${kind}`}>
                <th scope="row">{unit.name}</th>
                <td>{st.shifts}</td>
                <td>{formatClock(st.toiMs)}</td>
                <td>{formatMaybe(st.avgMs)}</td>
                <td>{formatMaybe(st.longestMs)}</td>
                <td>{formatMaybe(st.shortestMs)}</td>
                <td>{formatMaybe(st.avgRestMs)}</td>
                <td>{st.gf}</td>
                <td>{st.ga}</td>
                <td className={st.plusMinus > 0 ? 'plus' : st.plusMinus < 0 ? 'minus' : ''}>{st.plusMinus > 0 ? `+${st.plusMinus}` : st.plusMinus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted small">
        Rest = average game-clock time between shifts (pauses and intermissions don't count).
        {roster && ' Line rows count the time a majority of the line was on together (2 of 3 forwards, both D).'}
      </p>

      <h2>Goals</h2>
      {goals.length === 0 ? <p className="muted">None.</p> : (
        <ul className="goal-list">
          {goals.map((g) => g.type === 'goalFor' || g.type === 'goalAgainst' ? (
            <li key={g.seq}>
              <span className={g.type === 'goalFor' ? 'gf-mark' : 'ga-mark'}>{g.type === 'goalFor' ? '▲ For' : '▼ Against'}</span>
              {' '}{periodLabel(g.period)} {formatClock(g.gameMs)} · {g.strength} · <span className="muted">{g.onIce.map(name).join(', ') || 'no units on ice'}</span>
            </li>
          ) : null)}
        </ul>
      )}

      <h2>TOI check</h2>
      {roster ? (
        <>
          <p className="muted small">Average skaters on the ice: normally 3 forwards and 2 D at even strength.</p>
          <table className="stats check" data-testid="toi-check">
            <thead><tr><th>Period</th><th>Clock</th><th>Forwards</th><th>Defense</th></tr></thead>
            <tbody>
              {checks.map((r) => (
                <tr key={r.period}>
                  <th scope="row">{periodLabel(r.period)}</th>
                  <td>{formatClock(r.clockMs)}</td>
                  <td>{avgOn(r.sums.F, r.clockMs)}</td>
                  <td>{avgOn(r.sums.D, r.clockMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (<>
      <p className="muted small">Forward TOI and D TOI should each match the game clock when a line and a pair were always on the ice.</p>
      <table className="stats check" data-testid="toi-check">
        <thead><tr><th>Period</th><th>Clock</th><th>Forwards</th><th>Defense</th><th>PP+PK</th></tr></thead>
        <tbody>
          {checks.map((r) => (
            <tr key={r.period}>
              <th scope="row">{periodLabel(r.period)}</th>
              <td>{formatClock(r.clockMs)}</td>
              <td className={r.sums.F === r.clockMs ? 'plus' : 'warnc'}>{formatClock(r.sums.F)} {r.sums.F === r.clockMs ? '✓' : '≠'}</td>
              <td className={r.sums.D === r.clockMs ? 'plus' : 'warnc'}>{formatClock(r.sums.D)} {r.sums.D === r.clockMs ? '✓' : '≠'}</td>
              <td>{formatClock(r.sums.ST)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </>)}
    </main>
  );
}
