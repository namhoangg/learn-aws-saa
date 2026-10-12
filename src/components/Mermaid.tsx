import { useEffect, useId, useRef, useState } from 'react';
import { Maximize, Maximize2, Minus, Plus, X } from 'lucide-react';
import { useResolvedTheme } from '../lib/theme';
import { mermaidDark, mermaidLight } from '../lib/mermaidTheme';
import { useDialogFocus } from '../lib/useDialogFocus';

type MermaidApi = typeof import('mermaid').default;
let mermaidPromise: Promise<MermaidApi> | null = null;
let configuredFor: string | null = null;
// mermaid.render is not re-entrant; diagrams render one after another.
let queue: Promise<unknown> = Promise.resolve();

async function getMermaid(theme: 'light' | 'dark'): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  if (configuredFor !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...(theme === 'dark' ? mermaidDark : mermaidLight) });
    configuredFor = theme;
  }
  return mermaid;
}

function captionOf(code: string): string | undefined {
  return code.match(/^\s*%%\s*caption:\s*(.+)$/m)?.[1]?.trim();
}

const TYPE_LABEL: [RegExp, string][] = [
  [/^(flowchart|graph)\b/, 'Flowchart'],
  [/^sequenceDiagram\b/, 'Sequence'],
  [/^stateDiagram/, 'State'],
  [/^timeline\b/, 'Timeline'],
  [/^mindmap\b/, 'Mind map'],
  [/^classDiagram\b/, 'Class'],
  [/^erDiagram\b/, 'Entity relationship'],
  [/^quadrantChart\b/, 'Quadrant'],
  [/^gantt\b/, 'Gantt'],
  [/^pie\b/, 'Pie'],
];

function typeOf(code: string): string {
  const first = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%'));
  return TYPE_LABEL.find(([re]) => re.test(first ?? ''))?.[1] ?? 'Diagram';
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function Mermaid({ code }: { code: string }) {
  const theme = useResolvedTheme();
  const rawId = useId();
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(2); // index into ZOOMS; 2 = fit
  const caption = captionOf(code);
  const kind = typeOf(code);
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef, expanded);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, '')}-${theme}`;
    queue = queue.then(async () => {
      try {
        const mermaid = await getMermaid(theme);
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setError('');
        }
      } catch (e) {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, theme, rawId]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(ZOOMS.length - 1, z + 1));
      if (e.key === '-') setZoom((z) => Math.max(0, z - 1));
      if (e.key === '0') setZoom(2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (error) {
    return (
      <figure className="diagram diagram--error" data-mermaid-error="true">
        <div className="diagram__head">
          <span className="diagram__kind">Diagram · {kind}</span>
        </div>
        <div className="diagram__error">
          <p>
            <strong>Diagram could not be drawn.</strong> {error.split('\n')[0]}
          </p>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure className="diagram">
      <div className="diagram__head">
        <span className="diagram__kind">Diagram · {kind}</span>
        <button type="button" className="btn btn--ghost btn--sm" aria-label="Expand diagram to full screen" onClick={() => setExpanded(true)} disabled={!svg}>
          <Maximize2 size={16} aria-hidden /> Expand
        </button>
      </div>
      <div className="diagram__body">
        {svg ? <div className="diagram__canvas" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="diagram__canvas diagram__loading" aria-busy="true" />}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
      {expanded && (
        <div className="diagram-modal" role="dialog" aria-modal="true" aria-label={caption ?? 'Diagram'} onClick={() => setExpanded(false)}>
          <div ref={modalRef} className="diagram-modal__inner" onClick={(e) => e.stopPropagation()}>
            <div className="diagram-modal__head">
              <span className="diagram-modal__title">{caption ?? 'Diagram'}</span>
              <div className="zoom-group" role="group" aria-label="Zoom">
                <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0, z - 1))}>
                  <Minus size={16} aria-hidden />
                </button>
                <span className="zoom-group__value">{zoom === 2 ? 'Fit' : `${Math.round(ZOOMS[zoom] * 100)}%`}</span>
                <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
                  <Plus size={16} aria-hidden />
                </button>
                <button type="button" aria-label="Fit to view" onClick={() => setZoom(2)}>
                  <Maximize size={16} aria-hidden />
                </button>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setExpanded(false)} autoFocus>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className={`diagram-modal__canvas${zoom === 2 ? ' is-fit' : ''}`}>
              <div style={zoom === 2 ? undefined : { width: `${ZOOMS[zoom] * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
