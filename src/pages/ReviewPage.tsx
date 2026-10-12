import { useEffect, useMemo, useState } from 'react';
import { course, loadAllFlashcards, sections } from '../content/load';
import type { Flashcard, WithSection } from '../content/types';
import { FlashcardDeck } from '../components/FlashcardDeck';

/** Flashcard review across the whole course, optionally narrowed to one part. */
export function ReviewPage() {
  const [cards, setCards] = useState<WithSection<Flashcard>[] | null>(null);
  const [part, setPart] = useState('all');

  useEffect(() => {
    loadAllFlashcards().then(setCards);
  }, []);

  const deck = useMemo(() => {
    if (!cards) return [];
    if (part === 'all') return cards;
    const ids = new Set(sections.filter((s) => s.partId === part).map((s) => s.id));
    return cards.filter((c) => ids.has(c.sectionId));
  }, [cards, part]);

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Spaced repetition</p>
        <h1>Flashcard review</h1>
        <p className="muted">Due cards from every section first, then up to 20 new ones. Rate each card Easy or Hard; Hard cards come back sooner.</p>
        <label className="field field--inline">
          <span>Deck</span>
          <select value={part} onChange={(e) => setPart(e.target.value)}>
            <option value="all">All sections</option>
            {course.parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </header>
      {cards ? (
        <FlashcardDeck key={part} cards={deck} title={part === 'all' ? 'All sections' : (course.parts.find((p) => p.id === part)?.title ?? '')} showSection />
      ) : (
        <p className="muted">Loading cards…</p>
      )}
    </div>
  );
}
