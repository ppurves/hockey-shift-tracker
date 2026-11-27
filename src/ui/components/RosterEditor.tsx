import { nextPlayerId, positionGroup, type Player, type Position, type UnitDef } from '../../core';

const POSITIONS: { v: Position; label: string }[] = [
  { v: 'F', label: 'F' },
  { v: 'D', label: 'D' },
  { v: 'G', label: 'G' },
];

/**
 * Edit a roster: number, name, position and line for each player. Lines come
 * from `units` (forward lines for F, D pairs for D); "Extra" means no line.
 */
export function RosterEditor(props: { players: Player[]; units: readonly UnitDef[]; onChange: (p: Player[]) => void }) {
  const { players, units, onChange } = props;
  const patch = (id: string, p: Partial<Player>) => onChange(players.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const linesFor = (pos: Position) => units.filter((u) => u.group === positionGroup(pos));
  const dupes = new Set(
    players.map((p) => p.number.trim()).filter((n, i, all) => n && all.indexOf(n) !== i),
  );
  const add = (position: Position) => {
    // Default the new player onto the first line with fewer than 3 F / 2 D.
    const size = position === 'D' ? 2 : 3;
    const line = linesFor(position).find((l) => players.filter((p) => p.lineId === l.id).length < size);
    onChange([...players, { id: nextPlayerId(players), number: '', name: '', position, lineId: position === 'G' ? null : line?.id ?? null }]);
  };

  return (
    <div className="roster-editor" data-testid="roster-editor">
      {players.length === 0 && <p className="muted small">No players yet. Add your skaters below.</p>}
      {players.length > 0 && (
        <div className="roster-head muted small" aria-hidden="true">
          <span>#</span><span>Name</span><span>Pos</span><span>Line</span><span />
        </div>
      )}
      {players.map((p, i) => (
        <div key={p.id} className="roster-row">
          <input
            aria-label={`Number for player ${i + 1}`}
            className={dupes.has(p.number.trim()) ? 'dupe' : ''}
            inputMode="numeric" maxLength={3} placeholder="#" value={p.number}
            onChange={(e) => patch(p.id, { number: e.target.value.replace(/[^\dA-Za-z]/g, '') })}
          />
          <input
            aria-label={`Name for player ${i + 1}`}
            maxLength={20} placeholder="Name" value={p.name} autoComplete="off"
            onChange={(e) => patch(p.id, { name: e.target.value })}
          />
          <select
            aria-label={`Position for player ${i + 1}`} value={p.position}
            onChange={(e) => {
              const position = e.target.value as Position;
              const keep = linesFor(position).some((l) => l.id === p.lineId);
              patch(p.id, { position, lineId: keep ? p.lineId : null });
            }}
          >
            {POSITIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select
            aria-label={`Line for player ${i + 1}`} value={p.lineId ?? ''} disabled={p.position === 'G'}
            onChange={(e) => patch(p.id, { lineId: e.target.value || null })}
          >
            {linesFor(p.position).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="">{p.position === 'G' ? 'Goalie' : 'Extra'}</option>
          </select>
          <button type="button" className="small-btn danger" aria-label={`Remove player ${i + 1}`} onClick={() => onChange(players.filter((x) => x.id !== p.id))}>
            ✕
          </button>
        </div>
      ))}
      {dupes.size > 0 && <p className="small warnc">Duplicate number: {[...dupes].map((n) => `#${n}`).join(', ')}.</p>}
      <div className="roster-add">
        <button type="button" className="small-btn" onClick={() => add('F')}>+ Forward</button>
        <button type="button" className="small-btn" onClick={() => add('D')}>+ Defense</button>
        <button type="button" className="small-btn" onClick={() => add('G')}>+ Goalie</button>
      </div>
      <p className="muted small">Goalies are listed but not tracked on the ice. Extras get their own row on the live screen.</p>
    </div>
  );
}

/** Lines only / Roster segmented control. */
export function ModePicker(props: { value: 'lines' | 'roster'; onChange: (v: 'lines' | 'roster') => void; legend: string }) {
  return (
    <fieldset className="seg">
      <legend>{props.legend}</legend>
      {(['lines', 'roster'] as const).map((v) => (
        <button type="button" key={v} className={props.value === v ? 'sel' : ''} aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {v === 'lines' ? 'Lines only' : 'Roster (players)'}
        </button>
      ))}
    </fieldset>
  );
}
