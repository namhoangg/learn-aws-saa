import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { ArrowRight, Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { availableSections, services } from '../content/load';
import type { Category, Service } from '../content/types';
import { useCounts } from '../lib/progress';
import { Segmented } from './Segmented';

export const CATEGORY_LABEL: Record<Category, string> = {
  networking: 'Networking',
  compute: 'Compute',
  storage: 'Storage',
  analytics: 'Analytics',
  database: 'Databases',
  security: 'Security & Identity',
  integration: 'Integration',
  management: 'Monitoring & Mgmt',
  ml: 'Machine Learning',
  migration: 'Migration',
};
// Grid order from DESIGN_SPEC §9: neighbours were chosen so common relations are short.
const ROW1: Category[] = ['networking', 'compute', 'storage', 'analytics', 'database'];
const ROW2: Category[] = ['security', 'integration', 'management', 'ml', 'migration'];
const CATEGORIES = [...ROW1, ...ROW2];

const FRAME_W = 160;
const COL_STEP = 216;
const NODE_W = 136;
const NODE_H = 34;
const SLOT = 44;
const ROW1_TOP = 56;
const ROW_GAP = 88;
const DEFAULT_PER_CATEGORY = 6;
const WORLD_W = 20 + COL_STEP * 4 + FRAME_W + 20;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface NodeBox {
  service: Service;
  col: number;
  row: 0 | 1;
  x: number;
  y: number;
  degree: number;
}
interface Edge {
  id: string;
  from: string;
  to: string;
  label: string;
  points: [number, number][];
  labelAt: { x: number; y: number; vertical: boolean };
}

const frameX = (col: number) => 20 + COL_STEP * col;
const gutterX = (col: number) => (col < 0 ? 8 : frameX(col) + FRAME_W + (COL_STEP - FRAME_W) / 2);
const short = (name: string) => name.replace(/^(Amazon|AWS) /, '');

function useMapData(showAll: boolean) {
  return useMemo(() => {
    const relations = availableSections.flatMap((s) => (s.meta?.relations ?? []).map((r) => ({ ...r, sectionId: s.id })));
    const inContent = new Set(availableSections.flatMap((s) => s.meta?.services ?? []));
    const degree = new Map<string, number>();
    const seen = new Set<string>();
    const rels = relations.filter((r) => {
      const k = `${r.from}>${r.to}`;
      if (r.from === r.to || seen.has(k)) return false;
      seen.add(k);
      degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
      degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
      return true;
    });
    // Per category: the most connected services (core first); "show all" adds every service the course covers.
    const byCat = new Map<Category, Service[]>();
    for (const c of CATEGORIES) {
      const list = services
        .filter((s) => s.category === c && (degree.has(s.id) || (s.core && inContent.has(s.id)) || (showAll && inContent.has(s.id))))
        .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || Number(b.core) - Number(a.core) || a.name.localeCompare(b.name));
      byCat.set(c, showAll ? list : list.slice(0, DEFAULT_PER_CATEGORY));
    }
    const rowSlots = [Math.max(1, ...ROW1.map((c) => byCat.get(c)!.length)), Math.max(1, ...ROW2.map((c) => byCat.get(c)!.length))];
    const frameH = (n: number) => 40 + SLOT * n - 10 + 12;
    const row1H = frameH(rowSlots[0]);
    const row2Top = ROW1_TOP + row1H + ROW_GAP;
    const row2H = frameH(rowSlots[1]);
    const worldH = row2Top + row2H + 24;
    const gapY = ROW1_TOP + row1H + ROW_GAP / 2;

    const boxes = new Map<string, NodeBox>();
    CATEGORIES.forEach((c) => {
      const row: 0 | 1 = ROW1.includes(c) ? 0 : 1;
      const col = (row === 0 ? ROW1 : ROW2).indexOf(c);
      byCat.get(c)!.forEach((s, slot) => {
        const y = row === 0 ? ROW1_TOP + 40 + SLOT * slot : row2Top + 12 + SLOT * slot;
        boxes.set(s.id, { service: s, col, row, x: frameX(col) + 12, y, degree: degree.get(s.id) ?? 0 });
      });
    });

    const edges: Edge[] = [];
    rels.forEach((r, i) => {
      const a = boxes.get(r.from);
      const b = boxes.get(r.to);
      if (!a || !b) return;
      const lane = ((i % 5) - 2) * 4; // spread parallel lines in shared gutters
      const ay = a.y + NODE_H / 2;
      const by = b.y + NODE_H / 2;
      let pts: [number, number][];
      if (a.row === b.row && a.col === b.col) {
        const gx = gutterX(a.col) + lane;
        pts = [[a.x + NODE_W, ay], [gx, ay], [gx, by], [b.x + NODE_W + 2, by]];
      } else {
        const right = b.col >= a.col;
        const aSide = right ? a.x + NODE_W : a.x;
        const aGutter = right ? gutterX(a.col) : gutterX(a.col - 1);
        const bRight = b.col < a.col || b.col === a.col; // enter b from its right when coming from the right or same column
        const bSide = bRight ? b.x + NODE_W + 2 : b.x - 2;
        const bGutter = bRight ? gutterX(b.col) : gutterX(b.col - 1);
        const ga = aGutter + lane;
        const gb = bGutter + lane;
        if (a.row === b.row && aGutter === bGutter) {
          pts = [[aSide, ay], [ga, ay], [ga, by], [bSide, by]];
        } else {
          const gy = gapY + lane;
          pts = [[aSide, ay], [ga, ay], [ga, gy], [gb, gy], [gb, by], [bSide, by]];
        }
      }
      // Label at the middle of the longest segment.
      let best = 0;
      let at = { x: 0, y: 0, vertical: false };
      for (let k = 0; k < pts.length - 1; k++) {
        const [x1, y1] = pts[k];
        const [x2, y2] = pts[k + 1];
        const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        if (len > best) {
          best = len;
          at = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, vertical: x1 === x2 };
        }
      }
      edges.push({ id: `${r.from}>${r.to}`, from: r.from, to: r.to, label: r.label, points: pts, labelAt: at });
    });

    const covered = new Map<string, string[]>();
    for (const s of availableSections) for (const sid of s.meta?.services ?? []) covered.set(sid, [...(covered.get(sid) ?? []), s.id]);
    const frames = CATEGORIES.map((c) => {
      const row = ROW1.includes(c) ? 0 : 1;
      const col = (row === 0 ? ROW1 : ROW2).indexOf(c);
      return { category: c, x: frameX(col), y: row === 0 ? ROW1_TOP : row2Top, h: row === 0 ? row1H : row2H, row };
    });
    return { boxes, edges, frames, worldH, covered, total: [...byCat.values()].reduce((n, l) => n + l.length, 0) };
  }, [showAll]);
}

export function KnowledgeMap() {
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<Set<Category>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>(() => (window.matchMedia('(max-width: 767px)').matches ? 'list' : 'map'));
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const navigate = useNavigate();
  const counts = useCounts();
  const { boxes, edges, frames, worldH, covered, total } = useMapData(showAll);
  const focus = pinned ?? hover;
  // The map is one Tab stop (DESIGN_SPEC §9): only this node is tabbable; arrow keys move it.
  const [kbId, setKbId] = useState<string | null>(null);
  const reachable = [...boxes.values()].filter((b) => !hidden.has(b.service.category));
  const tabStop = kbId && reachable.some((b) => b.service.id === kbId) ? kbId : reachable[0]?.service.id;

  const neighbourInDirection = (from: NodeBox, key: string): NodeBox | undefined => {
    const sameColumn = (row: number, col: number) => reachable.filter((b) => b.row === row && b.col === col).sort((a, b) => a.y - b.y);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const list = sameColumn(from.row, from.col);
      const i = list.indexOf(from);
      const next = list[i + (key === 'ArrowDown' ? 1 : -1)];
      if (next) return next;
      // Off the end of a frame: continue into the frame above or below in the same column.
      const other = sameColumn(from.row === 0 ? 1 : 0, from.col);
      if (key === 'ArrowDown' && from.row === 0) return other[0];
      if (key === 'ArrowUp' && from.row === 1) return other[other.length - 1];
      return undefined;
    }
    const step = key === 'ArrowRight' ? 1 : -1;
    for (let col = from.col + step; col >= 0 && col <= 4; col += step) {
      const list = sameColumn(from.row, col);
      if (list.length) return list.reduce((best, b) => (Math.abs(b.y - from.y) < Math.abs(best.y - from.y) ? b : best));
    }
    return undefined;
  };

  const onNodeKey = (e: React.KeyboardEvent, b: NodeBox) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const next = neighbourInDirection(b, e.key);
    if (!next) return;
    setKbId(next.service.id);
    viewportRef.current?.querySelector<HTMLElement>(`[data-node="${next.service.id}"]`)?.focus();
  };

  const fit = () => {
    const vp = viewportRef.current;
    if (!vp || !zoomRef.current) return;
    const k = Math.min(1, vp.clientWidth / WORLD_W, vp.clientHeight / worldH);
    const x = (vp.clientWidth - WORLD_W * k) / 2;
    select(vp).call(zoomRef.current.transform, zoomIdentity.translate(x, 8).scale(k));
  };

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || view !== 'map') return;
    const z = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.4, 2.5])
      // Wheel zoom only with Ctrl/Cmd so the page still scrolls normally.
      .filter((e: Event) => (e.type === 'wheel' ? (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey : !(e as MouseEvent).button))
      .on('zoom', (e) => setT({ x: e.transform.x, y: e.transform.y, k: e.transform.k }));
    zoomRef.current = z;
    select(vp).call(z).on('dblclick.zoom', null);
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, worldH]);

  const zoomTo = (k: number) => viewportRef.current && zoomRef.current && select(viewportRef.current).call(zoomRef.current.scaleTo, k);
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= t.k - 0.01);
    const next = dir > 0 ? ZOOMS[Math.min(ZOOMS.length - 1, (ZOOMS[i] > t.k + 0.01 ? i : i + 1))] : ZOOMS[Math.max(0, i - 1)];
    zoomTo(next ?? 1);
  };

  const neighbours = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [focus, edges]);

  const visibleEdges = edges.filter((e) => !hidden.has(boxes.get(e.from)!.service.category) && !hidden.has(boxes.get(e.to)!.service.category));
  const showAllLabels = visibleEdges.length <= 16;
  const focusBox = focus ? boxes.get(focus) : undefined;
  const firstLesson = (id: string) => covered.get(id)?.[0];

  const relationsOf = (id: string) =>
    edges
      .filter((e) => e.from === id || e.to === id)
      .map((e) => (e.from === id ? { text: e.label, other: e.to, out: true } : { text: e.label, other: e.from, out: false }));

  const toggleCategory = (c: Category) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  return (
    <section className={`kmap${visibleEdges.length > 40 ? " kmap--dense" : ""}`} aria-label="Knowledge map">
      <header className="kmap__head">
        <MapIcon size={22} className="kmap__icon" aria-hidden />
        <div className="kmap__titles">
          <h2>Knowledge map</h2>
          <p className="caption">
            {total} services in 10 categories · hover a service to see what it connects to
          </p>
        </div>
        <div className="kmap__controls">
          <Segmented<'map' | 'list'>
            label="View"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'map', label: 'Map' },
              { value: 'list', label: 'List' },
            ]}
          />
          <label className="check kmap__all">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Every service
          </label>
          {view === 'map' && (
            <div className="zoom-group" role="group" aria-label="Zoom">
              <button type="button" aria-label="Zoom out" onClick={() => step(-1)}>
                <Minus size={18} aria-hidden />
              </button>
              <span className="zoom-group__value">{Math.round(t.k * 100)}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => step(1)}>
                <Plus size={18} aria-hidden />
              </button>
              <button type="button" aria-label="Fit to view" onClick={fit}>
                <Maximize size={18} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </header>

      {view === 'map' ? (
        <div
          className="kmap__viewport"
          ref={viewportRef}
          style={{ backgroundPosition: `${t.x}px ${t.y}px`, backgroundSize: `${16 * t.k}px ${16 * t.k}px` }}
          onClick={() => setPinned(null)}
          onKeyDown={(e) => e.key === 'Escape' && (setPinned(null), setHover(null))}
        >
          <div className="kmap__world" style={{ width: WORLD_W, height: worldH, transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
            {frames.map((f) => (
              <div key={f.category} className={`kmap__frame kmap__frame--row${f.row + 1}${hidden.has(f.category) ? ' is-off' : ''}`} style={{ left: f.x, top: f.y, width: FRAME_W, height: f.h }}>
                <span className={`kmap__frame-label cat--${f.category}`}>
                  <span className="cat-square" aria-hidden />
                  {CATEGORY_LABEL[f.category]}
                </span>
              </div>
            ))}
            <svg className="kmap__edges" width={WORLD_W} height={worldH} aria-hidden>
              <defs>
                <marker id="kmap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" className="kmap__arrow" />
                </marker>
                <marker id="kmap-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" className="kmap__arrow kmap__arrow--hot" />
                </marker>
              </defs>
              {visibleEdges.map((e) => {
                const hot = !!focus && (e.from === focus || e.to === focus);
                return (
                  <polyline
                    key={e.id}
                    points={e.points.map((p) => p.join(',')).join(' ')}
                    className={`kmap__edge${hot ? ' is-hot' : ''}${focus && !hot ? ' is-dim' : ''}`}
                    markerEnd={hot ? 'url(#kmap-arrow-hot)' : 'url(#kmap-arrow)'}
                  />
                );
              })}
            </svg>
            {visibleEdges
              .filter((e) => showAllLabels || (focus && (e.from === focus || e.to === focus)))
              .map((e) => {
                const hot = !!focus && (e.from === focus || e.to === focus);
                return (
                  <span
                    key={e.id}
                    className={`kmap__edge-label${hot ? ' is-hot' : ''}`}
                    style={e.labelAt.vertical ? { left: e.labelAt.x + 8, top: e.labelAt.y, transform: 'translateY(-50%)' } : { left: e.labelAt.x, top: e.labelAt.y - 26, transform: 'translateX(-50%)' }}
                    aria-hidden
                  >
                    {e.label}
                  </span>
                );
              })}
            {[...boxes.values()].map((b) => {
              const off = hidden.has(b.service.category);
              const isFocus = focus === b.service.id;
              const isNeighbour = !!neighbours?.has(b.service.id);
              return (
                <button
                  key={b.service.id}
                  type="button"
                  className={`kmap__node cat--${b.service.category}${isFocus ? ' is-focus' : ''}${isNeighbour ? ' is-neighbour' : ''}${off ? ' is-off' : ''}`}
                  style={{ left: b.x, top: b.y, width: NODE_W, height: NODE_H }}
                  aria-label={b.service.name}
                  data-node={b.service.id}
                  tabIndex={!off && b.service.id === tabStop ? 0 : -1}
                  onKeyDown={(ev) => onNodeKey(ev, b)}
                  onMouseEnter={() => setHover(b.service.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => {
                    setHover(b.service.id);
                    setKbId(b.service.id);
                  }}
                  onBlur={() => setHover(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setPinned((p) => (p === b.service.id ? null : b.service.id));
                  }}
                  onDoubleClick={() => {
                    const sid = firstLesson(b.service.id);
                    if (sid) navigate(`/section/${sid}`);
                  }}
                >
                  <span className="cat-square" aria-hidden />
                  <span className="kmap__node-label">{short(b.service.name)}</span>
                </button>
              );
            })}
            {focusBox && (
              <div
                className="kmap__card"
                role={pinned ? 'dialog' : 'tooltip'}
                aria-label={focusBox.service.name}
                style={{
                  left: focusBox.col >= 3 ? focusBox.x - 250 : focusBox.x + NODE_W + 10,
                  top: Math.min(focusBox.y, worldH - 240),
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setHover(focusBox.service.id)}
                onMouseLeave={() => setHover(null)}
              >
                <span className={`kmap__card-cat cat--${focusBox.service.category}`}>
                  <span className="cat-square" aria-hidden />
                  {CATEGORY_LABEL[focusBox.service.category]}
                </span>
                <p className="kmap__card-title">{focusBox.service.name}</p>
                <p className="kmap__card-summary">{focusBox.service.summary}</p>
                {relationsOf(focusBox.service.id).length > 0 && (
                  <ul className="kmap__card-rel">
                    {relationsOf(focusBox.service.id)
                      .slice(0, 5)
                      .map((r, i) => (
                        <li key={i}>
                          <ArrowRight size={14} aria-hidden className={r.out ? '' : 'is-in'} />
                          <span>
                            {r.out ? (
                              <>
                                {r.text} <strong>{short(boxes.get(r.other)?.service.name ?? r.other)}</strong>
                              </>
                            ) : (
                              <>
                                <strong>{short(boxes.get(r.other)?.service.name ?? r.other)}</strong> {r.text} it
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
                {(covered.get(focusBox.service.id) ?? []).length > 0 && (
                  <div className="kmap__card-links">
                    {(covered.get(focusBox.service.id) ?? []).slice(0, 3).map((sid) => {
                      const s = availableSections.find((x) => x.id === sid);
                      const c = counts?.[sid];
                      return (
                        <Link key={sid} to={`/section/${sid}`}>
                          {String(s?.order ?? '').padStart(2, '0')} {s?.meta?.title}
                          {c && <span className="caption"> · {c.cards} cards · {c.questions} questions</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="kmap__list">
          {CATEGORIES.filter((c) => !hidden.has(c)).map((c) => {
            const list = [...boxes.values()].filter((b) => b.service.category === c);
            if (!list.length) return null;
            return (
              <details key={c} className="kmap__list-group" open>
                <summary className={`cat--${c}`}>
                  <span className="cat-square" aria-hidden /> {CATEGORY_LABEL[c]} <span className="mono">{list.length}</span>
                </summary>
                <ul>
                  {list.map((b) => {
                    const sid = firstLesson(b.service.id);
                    const rel = relationsOf(b.service.id).filter((r) => r.out);
                    return (
                      <li key={b.service.id}>
                        {sid ? <Link to={`/section/${sid}`}>{b.service.name}</Link> : <span>{b.service.name}</span>}
                        {rel.length > 0 && (
                          <span className="caption">
                            {rel
                              .slice(0, 3)
                              .map((r) => `${r.text} ${short(boxes.get(r.other)?.service.name ?? r.other)}`)
                              .join(' · ')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      )}

      <footer className="kmap__legend" role="group" aria-label="Filter categories">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`kmap__legend-item cat--${c}${hidden.has(c) ? ' is-off' : ''}`} aria-pressed={!hidden.has(c)} onClick={() => toggleCategory(c)}>
            <span className="cat-square" aria-hidden />
            {CATEGORY_LABEL[c]}
          </button>
        ))}
        <span className="caption kmap__legend-note">Arrow = relationship · click to pin · double-click to open its lesson · Ctrl + scroll to zoom</span>
      </footer>

      <div className="sr-only">
        <h3>Services and relationships</h3>
        <ul>
          {edges.map((e) => (
            <li key={e.id}>
              {boxes.get(e.from)?.service.name} {e.label} {boxes.get(e.to)?.service.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
