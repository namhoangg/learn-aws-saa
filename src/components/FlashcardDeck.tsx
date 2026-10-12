import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CircleCheck, Info, RotateCcw, Shuffle } from 'lucide-react';
import type { Flashcard, WithSection } from '../content/types';
import { setCard, useProgress } from '../state/store';
import { cardStatus, describeInterval, HARD_REQUEUE_GAP, schedule, type CardStatus, type Rating } from '../lib/srs';
import { shuffle } from '../lib/quiz';
import { getSection } from '../content/load';
import { InlineMarkdown } from './Markdown';
import { BadgeNote } from './Badge';
import { isTyping } from './Layout';
import { Segmented } from './Segmented';

type Mode = 'study' | 'all';
const NEW_PER_SESSION = 20;

const STATE_CHIP: Record<CardStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'chip--accent' },
  due: { label: 'Due', cls: 'chip--verify' },
  learning: { label: 'Learning', cls: 'chip--neutral' },
  learned: { label: 'Learned', cls: 'chip--free' },
};

interface Props {
  cards: WithSection<Flashcard>[];
  title: string;
  /** Show which section each card comes from (global decks). */
  showSection?: boolean;
  startCardId?: string;
  /** Start in "all cards" mode, e.g. for weak-card practice. */
  initialMode?: Mode;
}

export function FlashcardDeck({ cards, title, showSection, startCardId, initialMode }: Props) {
  const progress = useProgress();
  const shortcuts = progress.settings.shortcuts !== false;
  const [mode, setMode] = useState<Mode>(initialMode ?? (startCardId ? 'all' : 'study'));
  const [queue, setQueue] = useState<string[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ easy: 0, hard: 0 });
  const [sessionSize, setSessionSize] = useState(0);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const cardRef = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => {
    const now = new Date();
    const c = { new: 0, due: 0, learning: 0, learned: 0 };
    for (const card of cards) c[cardStatus(progress.cards[card.id], now)]++;
    return c;
  }, [cards, progress.cards]);

  const startSession = (ids: string[], nextMode: Mode) => {
    setMode(nextMode);
    setQueue(ids);
    setSessionSize(ids.length);
    setFlipped(false);
    setStats({ easy: 0, hard: 0 });
  };

  // Build the session queue when the deck or mode changes (not on every rating).
  useEffect(() => {
    const now = new Date();
    let ids: string[];
    if (mode === 'all') {
      ids = cards.map((c) => c.id);
      if (startCardId && byId.has(startCardId)) ids = [startCardId, ...ids.filter((i) => i !== startCardId)];
    } else {
      const due = cards
        .filter((c) => cardStatus(progress.cards[c.id], now) === 'due')
        .sort((a, b) => progress.cards[a.id].due.localeCompare(progress.cards[b.id].due))
        .map((c) => c.id);
      const fresh = cards.filter((c) => !progress.cards[c.id]).slice(0, NEW_PER_SESSION).map((c) => c.id);
      ids = [...due, ...fresh];
    }
    setQueue(ids);
    setSessionSize(ids.length);
    setFlipped(false);
    setStats({ easy: 0, hard: 0 });
    // progress.cards is read once per session on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, mode, startCardId]);

  const current = queue.length ? byId.get(queue[0]) : undefined;

  const rate = (rating: Rating) => {
    if (!current || !flipped) return;
    setCard(current.id, schedule(progress.cards[current.id], rating));
    setStats((s) => ({ ...s, [rating]: s[rating] + 1 }));
    setQueue((q) => {
      const rest = q.slice(1);
      if (rating === 'hard') rest.splice(Math.min(HARD_REQUEUE_GAP, rest.length), 0, current.id);
      return rest;
    });
    setFlipped(false);
    cardRef.current?.focus();
  };

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        const active = document.activeElement;
        if (active?.tagName === 'BUTTON' && active !== cardRef.current) return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === '1') rate('hard');
      else if (e.key === '2') rate('easy');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reviewed = stats.easy + stats.hard;
  const doneInSession = Math.max(0, sessionSize - queue.length);
  const section = current ? getSection(current.sectionId) : undefined;
  const state = current ? cardStatus(progress.cards[current.id]) : 'new';
  const dueNow = counts.due + Math.min(counts.new, NEW_PER_SESSION);

  return (
    <div className="deck">
      <div className="deck__bar">
        <Segmented<Mode>
          label="Deck"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'study', label: `Due & new · ${dueNow}` },
            { value: 'all', label: `All cards · ${cards.length}` },
          ]}
        />
        <div className="deck__counts" aria-label="Deck status">
          <span className="chip chip--accent">New {counts.new}</span>
          <span className="chip chip--verify">Due {counts.due}</span>
          <span className="chip chip--free">Learned {counts.learned}</span>
        </div>
      </div>

      {current ? (
        <>
          <div className="deck__progress">
            <span className="deck__progress-count">
              {Math.min(doneInSession + 1, sessionSize)} / {sessionSize}
            </span>
            <span className="progress-bar" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={sessionSize} aria-valuenow={doneInSession}>
              <span style={{ width: `${sessionSize ? (doneInSession / sessionSize) * 100 : 0}%` }} />
            </span>
            <span className="deck__progress-left">{queue.length} left in this session</span>
          </div>

          <button
            ref={cardRef}
            type="button"
            className={`flashcard${flipped ? ' flashcard--flipped' : ''}`}
            onClick={() => setFlipped((f) => !f)}
            aria-describedby="flashcard-hint"
          >
            <span className="flashcard__inner">
              <span className="flashcard__face flashcard__face--front" aria-hidden={flipped}>
                <span className="flashcard__head">
                  <span className="mono-label">
                    {section ? `${String(section.order).padStart(2, '0')} · ${section.meta?.title ?? ''}` : title}
                  </span>
                  <span className={`chip ${STATE_CHIP[state].cls}`}>{STATE_CHIP[state].label}</span>
                </span>
                <span className="flashcard__question">
                  <span className="sr-only">Question: </span>
                  <InlineMarkdown markdown={current.front} />
                </span>
                <span className="flashcard__hint">Click the card or press Space to show the answer</span>
              </span>
              <span className="flashcard__face flashcard__face--back" aria-hidden={!flipped}>
                <span className="flashcard__head">
                  <span className="mono-label">{showSection && section ? `${String(section.order).padStart(2, '0')} · ${section.meta?.title ?? ''}` : 'Answer'}</span>
                  <span className={`chip ${STATE_CHIP[state].cls}`}>{STATE_CHIP[state].label}</span>
                </span>
                <span className="flashcard__recap">
                  <InlineMarkdown markdown={current.front} />
                </span>
                <span className="flashcard__answer">
                  <span className="sr-only">Answer: </span>
                  <InlineMarkdown markdown={current.back} />
                </span>
                {current.updated && <BadgeNote kind="updated" note={current.updated} />}
                {current.verify && <BadgeNote kind="verify" note={current.verify} />}
                <span className="flashcard__hint">Click the card or press Space to flip back</span>
              </span>
            </span>
          </button>

          <div className="deck__rate" aria-live="polite">
            {flipped ? (
              <>
                <button type="button" className="rate-btn rate-btn--hard" onClick={() => rate('hard')}>
                  <RotateCcw size={22} strokeWidth={2} aria-hidden />
                  <span className="rate-btn__text">
                    <strong>Hard</strong>
                    <small>Again in {describeInterval(progress.cards[current.id], 'hard')}</small>
                  </span>
                  <kbd className="kbd">1</kbd>
                </button>
                <button type="button" className="rate-btn rate-btn--easy" onClick={() => rate('easy')}>
                  <Check size={22} strokeWidth={2} aria-hidden />
                  <span className="rate-btn__text">
                    <strong>Easy</strong>
                    <small>Next in {describeInterval(progress.cards[current.id], 'easy')}</small>
                  </span>
                  <kbd className="kbd">2</kbd>
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--primary btn--lg" onClick={() => setFlipped(true)}>
                Show answer <kbd className="kbd kbd--inverse">Space</kbd>
              </button>
            )}
          </div>
          <span id="flashcard-hint" className="sr-only">
            {flipped ? 'Press Space to flip back, 1 for Hard, 2 for Easy.' : 'Press Space to show the answer.'}
          </span>
          <p className="hint-box">
            <Info size={18} aria-hidden />
            <span>
              <strong>Hard cards return sooner:</strong> after {HARD_REQUEUE_GAP} more cards in this session and again in 10 minutes. Easy cards wait longer each time.
            </span>
          </p>
        </>
      ) : (
        <div className="deck__done">
          <CircleCheck size={36} aria-hidden />
          {reviewed ? (
            <>
              <h2>Session complete</h2>
              <p>
                You reviewed {reviewed} card{reviewed === 1 ? '' : 's'}: {stats.easy} easy, {stats.hard} hard.
              </p>
            </>
          ) : (
            <>
              <h2>{cards.length ? 'Nothing due right now' : 'No cards in this deck'}</h2>
              {cards.length > 0 && <p className="muted">Every card is scheduled for later. Come back when cards are due, or review the whole deck now.</p>}
            </>
          )}
          <div className="deck__done-actions">
            {cards.length > 0 && (
              <button type="button" className="btn btn--secondary" onClick={() => startSession(cards.map((c) => c.id), 'all')}>
                <RotateCcw size={18} aria-hidden /> Review all {cards.length} cards
              </button>
            )}
            {cards.length > 1 && (
              <button type="button" className="btn btn--ghost" onClick={() => startSession(shuffle(cards.map((c) => c.id)), 'all')}>
                <Shuffle size={18} aria-hidden /> Shuffle and review
              </button>
            )}
            <Link to="/review" className="btn btn--ghost">
              All due cards
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
