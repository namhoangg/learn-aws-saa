import { useRef, type ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

interface Props<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm';
}

/**
 * Segmented control (DESIGN_SPEC §6) as a real radio group: one Tab stop on the checked option,
 * arrow keys and Home/End move the selection.
 */
export function Segmented<T extends string | number>({ options, value, onChange, label, size }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = options.length;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j < 0) return;
    e.preventDefault();
    onChange(options[j].value);
    refs.current[j]?.focus();
  };

  return (
    <div className={`segmented${size === 'sm' ? ' segmented--sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === checkedIndex ? 0 : -1}
          className="segmented__btn"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
