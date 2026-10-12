import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CircleQuestionMark, CornerDownLeft, FlaskConical, Layers, Search } from 'lucide-react';
import { search, snippet, type ResultKind, type SearchHit } from '../lib/search';
import { getSection } from '../content/load';
import { useDialogFocus } from '../lib/useDialogFocus';
import { Highlight } from './Highlight';

export const KIND_LABEL: Record<ResultKind, string> = {
  lesson: 'Lessons',
  flashcard: 'Flashcards',
  question: 'Quiz questions',
  lab: 'Labs',
};
export const KIND_ICON: Record<ResultKind, typeof BookOpen> = {
  lesson: BookOpen,
  flashcard: Layers,
  question: CircleQuestionMark,
  lab: FlaskConical,
};
const ORDER: ResultKind[] = ['lesson', 'flashcard', 'question', 'lab'];
const RECENT_KEY = 'learnaws:recentSearch';
const PER_GROUP = 5;

function loadRecent(): SearchHit[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRecent(hit: SearchHit) {
  try {
    const list = [hit, ...loadRecent().filter((h) => h.id !== hit.id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Recent items are a convenience only.
  }
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [kinds, setKinds] = useState<Set<ResultKind>>(new Set());
  const [expanded, setExpanded] = useState<ResultKind | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const recent = useMemo(loadRecent, []);
  const searching = query.trim().length >= 2;

  // Focus starts in the input, Tab stays inside the palette, and focus returns on close.
  useDialogFocus(dialogRef, true);

  // Escape closes the palette wherever focus is, even if a click moved it to the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    if (!searching) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await search(query, 80);
      if (alive) {
        setHits(r);
        setActive(0);
        setLoading(false);
      }
    }, 80);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, searching]);

  const countBy = (k: ResultKind) => hits.filter((h) => h.kind === k).length;
  const groups = useMemo(() => {
    const source = searching ? hits : recent;
    return ORDER.filter((k) => !kinds.size || kinds.has(k))
      .map((kind) => {
        const all = source.filter((h) => h.kind === kind);
        return { kind, all, items: searching && expanded !== kind ? all.slice(0, PER_GROUP) : all };
      })
      .filter((g) => g.items.length);
  }, [hits, recent, kinds, expanded, searching]);
  const flat = groups.flatMap((g) => g.items);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    saveRecent(hit);
    onClose();
    navigate(hit.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if ((e.key === 'PageDown' || e.key === 'PageUp') && flat.length) {
      // Jump between result groups (Tab stays free for the filter pills and buttons).
      e.preventDefault();
      const starts: number[] = [];
      let offset = 0;
      for (const grp of groups) {
        starts.push(offset);
        offset += grp.items.length;
      }
      const cur = starts.findLastIndex((s) => s <= active);
      const nextGroup = e.key === 'PageUp' ? (cur - 1 + starts.length) % starts.length : (cur + 1) % starts.length;
      setActive(starts[nextGroup]);
    } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
      e.preventDefault();
      if (flat[active]) go(flat[active]);
      else if (searching) {
        onClose();
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const toggleKind = (k: ResultKind) =>
    setKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  let index = -1;
  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(e) => {
          e.stopPropagation();
          // Keep focus in the input when clicking results or text; buttons and the input still take focus.
          if (!(e.target as HTMLElement).closest('input, button')) e.preventDefault();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="palette__input">
          <Search size={22} strokeWidth={2} aria-hidden />
          <input
            ref={inputRef}
            data-autofocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setExpanded(null);
            }}
            placeholder="Search everything… e.g. sticky sessions, gp3, NAT gateway"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="palette-results"
            aria-activedescendant={flat[active] ? `hit-${flat[active].id}` : undefined}
            aria-label="Search query"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        {searching && hits.length > 0 && (
          <div className="palette__filters" role="group" aria-label="Filter results">
            {ORDER.map((k) => (
              <button key={k} type="button" className="filter-pill" aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}>
                {KIND_LABEL[k]} {countBy(k)}
              </button>
            ))}
          </div>
        )}
        <div className="palette__results" id="palette-results" role="listbox" aria-label="Results">
          {!searching && !recent.length && <p className="palette__empty">Type at least two characters. Try a service name like S3 or a term like failover.</p>}
          {!searching && recent.length > 0 && <p className="palette__group-title">Recent</p>}
          {searching && !loading && !hits.length && (
            <p className="palette__empty">
              No matches for “{query}”. Try a service name like S3 or a term like failover.
            </p>
          )}
          {groups.map((g) => {
            const Icon = KIND_ICON[g.kind];
            return (
              <div key={g.kind} className="palette__group" role="group" aria-label={KIND_LABEL[g.kind]}>
                {searching && (
                  <div className="palette__group-title">
                    <span>{KIND_LABEL[g.kind]}</span>
                    <span className="mono">{g.all.length}</span>
                  </div>
                )}
                {g.items.map((h) => {
                  index++;
                  const i = index;
                  const isActive = i === active;
                  const section = getSection(h.sectionId);
                  return (
                    <div
                      key={h.id}
                      id={`hit-${h.id}`}
                      role="option"
                      aria-selected={isActive}
                      className={`palette__item${isActive ? ' palette__item--active' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h)}
                    >
                      <span className="palette__item-icon" aria-hidden>
                        <Icon size={18} />
                      </span>
                      <span className="palette__item-body">
                        <span className="palette__item-title">
                          <Highlight text={h.title} terms={h.terms ?? []} />
                        </span>
                        <span className="palette__item-snippet">
                          <Highlight text={snippet(h.text, h.terms ?? [], 130)} terms={h.terms ?? []} />
                        </span>
                      </span>
                      <span className="palette__item-meta">
                        {isActive ? (
                          <>
                            Open <CornerDownLeft size={14} aria-hidden />
                          </>
                        ) : (
                          <span className="mono">{String(section?.order ?? '').padStart(2, '0')}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {searching && g.all.length > g.items.length && (
                  <button type="button" className="palette__more" onClick={() => setExpanded(g.kind)}>
                    Show all {g.all.length}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> open
          </span>
          <span>
            <kbd className="kbd">PgDn</kbd> next group
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> close
          </span>
          {searching && (
            <button
              type="button"
              className="link-btn palette__all"
              onClick={() => {
                onClose();
                navigate(`/search?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              All results page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
