import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { search, snippet, type ResultKind, type SearchHit } from '../lib/search';
import { sectionTitle } from '../content/load';
import { Highlight } from '../components/Highlight';
import { KIND_ICON, KIND_LABEL } from '../components/SearchPalette';
import { Segmented } from '../components/Segmented';

const KINDS: (ResultKind | 'all')[] = ['all', 'lesson', 'lab', 'question', 'flashcard'];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [kind, setKind] = useState<ResultKind | 'all'>('all');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    let alive = true;
    setHits(null);
    search(q, 200).then((h) => alive && setHits(h));
    return () => {
      alive = false;
    };
  }, [q]);

  const shown = (hits ?? []).filter((h) => kind === 'all' || h.kind === kind);

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Search</p>
        <h1>Results for “{q}”</h1>
        <input
          key={q}
          className="input input--lg"
          defaultValue={q}
          aria-label="Search query"
          placeholder="Search lessons, flashcards, questions and labs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParams({ q: (e.target as HTMLInputElement).value });
          }}
        />
        <Segmented<ResultKind | 'all'>
          label="Result type"
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({
            value: k,
            label: (
              <>
                {k === 'all' ? 'All' : KIND_LABEL[k]} {hits && <span className="muted">({k === 'all' ? hits.length : hits.filter((h) => h.kind === k).length})</span>}
              </>
            ),
          }))}
        />
      </header>
      {hits === null ? (
        <p className="muted">Searching…</p>
      ) : shown.length === 0 ? (
        <p className="muted">No matches.</p>
      ) : (
        <ol className="search-results">
          {shown.map((h) => {
            const Icon = KIND_ICON[h.kind];
            return (
              <li key={h.id} className="search-result">
                <Link to={h.path}>
                  <span className="search-result__kind">
                    <Icon size={14} aria-hidden /> {KIND_LABEL[h.kind]} · {sectionTitle(h.sectionId)}
                  </span>
                  <span className="search-result__title">
                    <Highlight text={h.title.length > 180 ? `${h.title.slice(0, 180)}…` : h.title} terms={h.terms} />
                  </span>
                  <span className="search-result__snippet">
                    <Highlight text={snippet(h.text, h.terms, 220)} terms={h.terms} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
