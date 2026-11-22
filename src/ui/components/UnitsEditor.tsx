import { defaultUnitName, nextUnit, sortUnits, type Group, type UnitDef } from '../../core';

const GROUP_LABEL: Record<Group, string> = { F: 'Forward lines', D: 'Defense pairs', PP: 'Power play', PK: 'Penalty kill' };
const MIN: Record<Group, number> = { F: 1, D: 1, PP: 0, PK: 0 };
const MAX: Record<Group, number> = { F: 5, D: 4, PP: 3, PK: 3 };

/** Rename units, and (optionally) add or remove units per group. */
export function UnitsEditor(props: { units: UnitDef[]; onChange: (u: UnitDef[]) => void; allowAddRemove?: boolean }) {
  const { units, onChange } = props;
  const rename = (id: string, name: string) => onChange(units.map((u) => (u.id === id ? { ...u, name } : u)));
  return (
    <div className="units-editor">
      {(['F', 'D', 'PP', 'PK'] as Group[]).map((g) => {
        const list = units.filter((u) => u.group === g);
        return (
          <fieldset key={g}>
            <legend>{GROUP_LABEL[g]}</legend>
            {list.map((u) => (
              <div key={u.id} className="unit-row-edit">
                <input
                  aria-label={`Name for ${u.id}`}
                  value={u.name}
                  maxLength={24}
                  onChange={(e) => rename(u.id, e.target.value)}
                  onBlur={(e) => !e.target.value.trim() && rename(u.id, defaultUnitName(u))}
                />
                {props.allowAddRemove && list.length > MIN[g] && (
                  <button type="button" className="small-btn danger" aria-label={`Remove ${u.name}`} onClick={() => onChange(units.filter((x) => x.id !== u.id))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            {props.allowAddRemove && list.length < MAX[g] && (
              <button type="button" className="small-btn" onClick={() => onChange(sortUnits([...units, nextUnit(units, g)]))}>
                + Add {nextUnit(units, g).name}
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
