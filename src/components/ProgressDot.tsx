import type { SectionState } from '../lib/progress';

const LABEL: Record<SectionState, string> = {
  done: 'Done',
  'in-progress': 'In progress',
  'not-started': 'Not started',
};

/** 16px state dot from DESIGN_SPEC §6: done (check), in progress (half), not started (ring). */
export function ProgressDot({ state, pending }: { state: SectionState; pending?: boolean }) {
  return (
    <span className={`progress-dot progress-dot--${pending ? 'pending' : state}`} role="img" aria-label={pending ? 'Not written yet' : LABEL[state]}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        {state === 'done' && !pending ? (
          <>
            <circle cx="8" cy="8" r="7.5" className="progress-dot__fill" />
            <path d="M4.8 8.3l2.1 2.1 4.3-4.6" className="progress-dot__check" />
          </>
        ) : (
          <>
            <circle cx="8" cy="8" r="6.75" className="progress-dot__ring" />
            {state === 'in-progress' && !pending && <path d="M8 1.25 A6.75 6.75 0 0 1 8 14.75 Z" className="progress-dot__half" />}
          </>
        )}
      </svg>
    </span>
  );
}

/** Small completion ring for part headers and dashboard tiles (value 0–1). */
export function MiniRing({ value, size = 18, stroke = 2.5, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <span className={`mini-ring${pct >= 0.999 ? ' mini-ring--done' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="mini-ring__track" />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className="mini-ring__value"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
    </span>
  );
}
