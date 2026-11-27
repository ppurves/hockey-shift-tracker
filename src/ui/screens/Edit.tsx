import { useState } from 'react';
import {
  addMarker,
  addShift,
  deleteMarker,
  deleteShift,
  deriveShifts,
  editShift,
  formatClock,
  parseClock,
  shiftMs,
  type EditResult,
  type GameEvent,
  type Shift,
  unitNamer,
} from '../../core';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { navigate } from '../hooks/useHashRoute';
import type { GameSession } from '../hooks/useGameSession';
import { periodLabel } from './Capture';

type Marker = 'goalFor' | 'goalAgainst' | 'penaltyFor' | 'penaltyAgainst';
const MARKER_LABEL: Record<Marker, string> = {
  goalFor: '▲ Goal for', goalAgainst: '▼ Goal against', penaltyFor: '⚑ Penalty for', penaltyAgainst: '⚐ Penalty against',
};

function TimeInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="time-input">
      {props.label}
      <input inputMode="numeric" pattern="[0-9:]*" placeholder="m:ss" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function Edit({ session }: { session: GameSession }) {
  const { meta, engine, replaceLog } = session;
  const events = engine.events as GameEvent[];
  const periods = [...engine.state.periodsStarted].sort((a, b) => a - b);
  const [period, setPeriod] = useState(periods[0] ?? 1);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [editing, setEditing] = useState<{ shift: Shift; start: string; end: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; run: () => EditResult } | null>(null);
  // Tracked units: lines/pairs in lines mode, players + PP/PK in roster mode.
  const units = engine.units;
  const [newShift, setNewShift] = useState({ unitId: units[0]?.id ?? '', start: '', end: '' });
  const [newMarker, setNewMarker] = useState<{ type: Marker; time: string }>({ type: 'goalFor', time: '' });
  const name = unitNamer(meta);

  if (meta.status !== 'final') {
    return (
      <main className="page">
        <button className="link-btn" onClick={() => navigate(`game/${meta.id}/summary`)}>‹ Summary</button>
        <h1>Edit game</h1>
        <p>Editing is available once the game is over. Use “End game” in the period menu of the live screen first.</p>
      </main>
    );
  }

  const apply = async (r: EditResult, done: string) => {
    if (!r.ok) { setMsg({ text: r.reason, tone: 'error' }); return false; }
    await replaceLog(r.events);
    setMsg({ text: done, tone: 'ok' });
    return true;
  };
  const times = (a: string, b: string) => {
    const s = parseClock(a), e = parseClock(b);
    if (s === null || e === null) { setMsg({ text: 'Enter times as m:ss, e.g. 3:05.', tone: 'error' }); return null; }
    return [s, e] as const;
  };

  const shifts = deriveShifts(events).filter((s) => s.period === period).sort((a, b) => a.startMs - b.startMs);
  const markers = events.filter((e) => e.period === period && e.type in MARKER_LABEL);

  return (
    <main className="page edit">
      <button className="link-btn" onClick={() => navigate(`game/${meta.id}/summary`)}>‹ Summary</button>
      <h1>Edit game</h1>
      <p className="muted small">Fix shift times, delete mistaken goals/penalties, or add ones you missed. Goal credit (+/-) is recalculated from the shifts.</p>

      <div className="tabs" role="tablist" aria-label="Period">
        {periods.map((p) => (
          <button key={p} role="tab" aria-selected={p === period} className={p === period ? 'sel' : ''} onClick={() => { setPeriod(p); setEditing(null); }}>
            {periodLabel(p)}
          </button>
        ))}
      </div>

      {msg && <p className={`strip ${msg.tone === 'ok' ? 'okstrip' : 'error'}`} role="status" data-testid="edit-msg">{msg.text}</p>}

      <h2>Goals &amp; penalties</h2>
      <ul className="edit-list" data-testid="marker-list">
        {markers.length === 0 && <li className="muted">None in {periodLabel(period)}.</li>}
        {markers.map((e) => (
          <li key={e.seq}>
            <span>
              <strong>{MARKER_LABEL[e.type as Marker]}</strong> {formatClock(e.gameMs)}
              {'onIce' in e && <span className="muted small"> · {e.strength} · {e.onIce.map(name).join(', ') || 'no units'}</span>}
            </span>
            <button className="small-btn danger" aria-label={`Delete ${MARKER_LABEL[e.type as Marker]} at ${formatClock(e.gameMs)}`}
              onClick={() => setConfirm({ title: `Delete ${MARKER_LABEL[e.type as Marker]} at ${formatClock(e.gameMs)}?`, run: () => deleteMarker(units, events, e.seq) })}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div className="add-row">
        <select aria-label="Event type" value={newMarker.type} onChange={(e) => setNewMarker({ ...newMarker, type: e.target.value as Marker })}>
          {(Object.keys(MARKER_LABEL) as Marker[]).map((k) => <option key={k} value={k}>{MARKER_LABEL[k]}</option>)}
        </select>
        <TimeInput label="at" value={newMarker.time} onChange={(time) => setNewMarker({ ...newMarker, time })} />
        <button className="small-btn primary" onClick={async () => {
          const t = parseClock(newMarker.time);
          if (t === null) { setMsg({ text: 'Enter the time as m:ss, e.g. 3:05.', tone: 'error' }); return; }
          if (await apply(addMarker(units, events, newMarker.type, period, t), `Added ${MARKER_LABEL[newMarker.type]} at ${formatClock(t)}.`)) {
            setNewMarker({ ...newMarker, time: '' });
          }
        }}>Add</button>
      </div>

      <h2>Shifts ({shifts.length})</h2>
      <div className="add-row">
        <select aria-label="Unit" value={newShift.unitId} onChange={(e) => setNewShift({ ...newShift, unitId: e.target.value })}>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <TimeInput label="from" value={newShift.start} onChange={(start) => setNewShift({ ...newShift, start })} />
        <TimeInput label="to" value={newShift.end} onChange={(end) => setNewShift({ ...newShift, end })} />
        <button className="small-btn primary" onClick={async () => {
          const t = times(newShift.start, newShift.end);
          if (t && await apply(addShift(units, events, newShift.unitId, period, t[0], t[1]), `Added ${name(newShift.unitId)} shift.`)) {
            setNewShift({ ...newShift, start: '', end: '' });
          }
        }}>Add shift</button>
      </div>
      <ul className="edit-list" data-testid="shift-list">
        {shifts.map((s) => {
          const key = `${s.unitId}-${s.startMs}`;
          const isEditing = editing && editing.shift.unitId === s.unitId && editing.shift.startMs === s.startMs;
          return (
            <li key={key} className={isEditing ? 'editing' : ''}>
              {isEditing ? (
                <>
                  <strong>{name(s.unitId)}</strong>
                  <TimeInput label="from" value={editing.start} onChange={(start) => setEditing({ ...editing, start })} />
                  <TimeInput label="to" value={editing.end} onChange={(end) => setEditing({ ...editing, end })} />
                  <button className="small-btn primary" onClick={async () => {
                    const t = times(editing.start, editing.end);
                    if (t && await apply(editShift(units, events, s, t[0], t[1]), `Updated ${name(s.unitId)} shift.`)) setEditing(null);
                  }}>Save</button>
                  <button className="small-btn" onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span>
                    <strong>{name(s.unitId)}</strong> {formatClock(s.startMs)}–{formatClock(s.endMs)} <span className="muted small">({formatClock(shiftMs(s))})</span>
                  </span>
                  <span className="btns">
                    <button className="small-btn" aria-label={`Edit ${name(s.unitId)} shift at ${formatClock(s.startMs)}`}
                      onClick={() => setEditing({ shift: s, start: formatClock(s.startMs), end: formatClock(s.endMs) })}>Edit</button>
                    <button className="small-btn danger" aria-label={`Delete ${name(s.unitId)} shift at ${formatClock(s.startMs)}`}
                      onClick={() => setConfirm({ title: `Delete ${name(s.unitId)} shift ${formatClock(s.startMs)}–${formatClock(s.endMs)}?`, run: () => deleteShift(units, events, s) })}>Delete</button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {confirm && (
        <ConfirmSheet
          title={confirm.title}
          actions={[{ label: 'Delete', tone: 'danger', onConfirm: () => { const c = confirm; setConfirm(null); void apply(c.run(), 'Deleted.'); } }]}
          onCancel={() => setConfirm(null)}
        />
      )}
    </main>
  );
}
