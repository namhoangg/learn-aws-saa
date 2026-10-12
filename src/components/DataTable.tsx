import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

/** Comparison table in a labelled scroll region; shows a swipe hint only when it overflows. */
export function DataTable({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const short = label.length > 80 ? `${label.slice(0, 80)}…` : label;
  return (
    <div className="table-block">
      <div ref={ref} className="table-wrap" role="region" aria-label={`${short || 'Table'}${overflows ? ', scrolls sideways' : ''}`} tabIndex={overflows ? 0 : undefined}>
        <table>{children}</table>
      </div>
      {overflows && (
        <p className="table-hint">
          <ArrowRight size={14} aria-hidden /> Swipe the table sideways to compare
        </p>
      )}
    </div>
  );
}
