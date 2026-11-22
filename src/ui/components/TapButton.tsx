import type { ButtonHTMLAttributes, PointerEvent, MouseEvent } from 'react';

/**
 * Button that fires on pointerdown (no click delay). Keyboard/screen-reader
 * activation still works through click events with detail === 0.
 */
export function TapButton({ onTap, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { onTap: () => void }) {
  return (
    <button
      type="button"
      {...rest}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 || rest.disabled) return;
        onTap();
      }}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (e.detail === 0 && !rest.disabled) onTap();
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
