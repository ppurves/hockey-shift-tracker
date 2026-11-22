import type { ReactNode } from 'react';

export interface SheetAction {
  label: string;
  onConfirm: () => void;
  tone?: 'primary' | 'danger';
}

/** Bottom sheet with big buttons; used to guard period changes. */
export function ConfirmSheet(props: { title: string; message?: ReactNode; actions: SheetAction[]; onCancel: () => void }) {
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.message && <p className="muted">{props.message}</p>}
        {props.actions.map((a) => (
          <button key={a.label} className={`sheet-btn ${a.tone ?? 'primary'}`} onClick={a.onConfirm}>
            {a.label}
          </button>
        ))}
        <button className="sheet-btn cancel" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}
