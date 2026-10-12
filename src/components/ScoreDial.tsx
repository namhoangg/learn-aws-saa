import { Check, X } from 'lucide-react';

const START = 135; // degrees, lower left; the arc sweeps 270° clockwise to the lower right.
const SWEEP = 270;

function point(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.max(0.0001, Math.min(1, fraction));
  const [x0, y0] = point(cx, cy, r, START);
  const [x1, y1] = point(cx, cy, r, START + SWEEP * f);
  const large = SWEEP * f > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Results dial from DESIGN_SPEC §7: 270° arc, pass tick, score in the centre. */
export function ScoreDial({ value, max, pass, passed }: { value: number; max: number; pass: number; passed: boolean }) {
  const c = 120;
  const r = 88;
  const passAngle = START + SWEEP * (pass / max);
  const [tx0, ty0] = point(c, c, 70, passAngle);
  const [tx1, ty1] = point(c, c, 106, passAngle);
  const [lx, ly] = point(c, c, 118, passAngle);
  return (
    <figure className={`score-dial ${passed ? 'is-pass' : 'is-fail'}`}>
      <svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label={`Score ${value} of ${max}, pass mark ${pass}`}>
        <path d={arc(c, c, r, 1)} className="score-dial__track" />
        {value > 0 && <path d={arc(c, c, r, value / max)} className="score-dial__value" />}
        <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} className="score-dial__pass" />
        <text x={lx} y={ly} className="score-dial__pass-label" textAnchor="middle" dominantBaseline="middle">
          {pass}
        </text>
      </svg>
      <figcaption aria-hidden>
        <strong>{value}</strong>
        <span className="score-dial__of">of {max}</span>
        <span className={`chip ${passed ? 'chip--free' : 'chip--notfree'}`}>
          {passed ? <Check size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
          {passed ? 'Pass' : 'Fail'}
        </span>
      </figcaption>
    </figure>
  );
}
