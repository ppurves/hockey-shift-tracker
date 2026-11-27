import { useState } from 'react';
import { formatClock, type UnitDef } from '../../core';

export interface PenaltyChoice {
  /** Roster: penalized player's id (null = none / bench minor). */
  playerId: string | null;
  /** Lines mode: number as typed ('' = none). */
  number: string;
  lengthMs: number;
}

/**
 * After a penalty against: who's going to the box, and for how long. Players
 * show as numbers only, so the grid stays readable on a phone. Optional:
 * "Skip" keeps the penalty with no player at the default length.
 */
export function PenaltySheet(props: {
  title: string;
  /** Roster mode: skaters that can be picked (null in lines mode: type a number). */
  players: UnitDef[] | null;
  /** Ids already in the box for another penalty (shown disabled). */
  unavailable: ReadonlySet<string>;
  initial: PenaltyChoice;
  defaultLengthMs: number;
  onSave: (c: PenaltyChoice) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<PenaltyChoice>(props.initial);
  const lengths = [...new Set([props.defaultLengthMs, 2 * 60_000, 4 * 60_000, 5 * 60_000, 10 * 60_000, props.initial.lengthMs])]
    .sort((a, b) => a - b);
  const label = (u: UnitDef) => (u.number ? `#${u.number}` : u.name);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="sheet penalty-sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.players ? (
          <div className="pick-grid" role="group" aria-label="Penalized player">
            {props.players.map((u) => (
              <button
                key={u.id}
                type="button"
                className={`pick ${choice.playerId === u.id ? 'sel' : ''}`}
                aria-pressed={choice.playerId === u.id}
                disabled={props.unavailable.has(u.id)}
                onClick={() => setChoice({ ...choice, playerId: choice.playerId === u.id ? null : u.id })}
              >
                {label(u)}
              </button>
            ))}
          </div>
        ) : (
          <label className="pick-number">Player #
            <input
              inputMode="numeric" maxLength={3} placeholder="optional" value={choice.number} autoComplete="off"
              onChange={(e) => setChoice({ ...choice, number: e.target.value.replace(/[^\dA-Za-z]/g, '') })}
            />
          </label>
        )}
        <div className="pick-lengths" role="group" aria-label="Penalty length">
          {lengths.map((ms) => (
            <button
              key={ms} type="button"
              className={`pick ${choice.lengthMs === ms ? 'sel' : ''}`}
              aria-pressed={choice.lengthMs === ms}
              onClick={() => setChoice({ ...choice, lengthMs: ms })}
            >
              {formatClock(ms)}
            </button>
          ))}
        </div>
        <button className="sheet-btn primary" onClick={() => props.onSave(choice)}>Save</button>
        <button className="sheet-btn cancel" onClick={props.onCancel}>Skip</button>
      </div>
    </div>
  );
}
