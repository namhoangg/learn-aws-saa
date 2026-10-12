/** Minimal trend line for percentages (0–100). */
export function Sparkline({ values, width = 180, height = 40 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const step = width / (values.length - 1);
  const y = (v: number) => height - 2 - (v / 100) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'} ${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Recent scores, latest ${last}%`}>
      <line x1="0" x2={width} y1={y(72)} y2={y(72)} className="sparkline__pass" />
      <path d={d} className="sparkline__line" />
      <circle cx={(values.length - 1) * step} cy={y(last)} r="3" className="sparkline__dot" />
    </svg>
  );
}
