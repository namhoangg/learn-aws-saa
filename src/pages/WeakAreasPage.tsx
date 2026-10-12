import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleQuestionMark, Layers, Play, Target } from 'lucide-react';
import { getSection, loadAllFlashcards, loadAllQuestions, sections, sectionTitle } from '../content/load';
import type { Flashcard, WithSection } from '../content/types';
import { setQuizSession, useProgress, type ProgressState, type QuizSession } from '../state/store';
import { isWeakQuestion, sessionQuestions, weakScore, type Question } from '../lib/quiz';
import { isWeakCard } from '../lib/srs';
import { QuizRunner, ResumeBanner } from '../components/QuizRunner';
import { FlashcardDeck } from '../components/FlashcardDeck';
import { Sparkline } from '../components/Sparkline';
import { Segmented } from '../components/Segmented';

type View = { kind: 'overview' } | { kind: 'quiz'; questions: Question[]; resume?: QuizSession } | { kind: 'cards'; cards: WithSection<Flashcard>[] };
type Filter = 'all' | 'questions' | 'cards';
type Sort = 'weakest' | 'missed' | 'order';

/** Accuracy per attempt for one section, oldest first, from attempts that included it. */
function sectionTrend(p: ProgressState, sectionId: string, last = 6): number[] {
  const out: number[] = [];
  for (const a of p.attempts) {
    const mine = a.answers.filter((x) => x.sectionId === sectionId);
    if (mine.length) out.push(Math.round((mine.filter((x) => x.correct).length / mine.length) * 100));
  }
  return out.slice(-last);
}

function ago(iso?: string): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Questions answered wrong and not yet answered right twice in a row, plus cards rated Hard repeatedly. */
export function WeakAreasPage() {
  const progress = useProgress();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [cards, setCards] = useState<WithSection<Flashcard>[] | null>(null);
  const [view, setView] = useState<View>({ kind: 'overview' });
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('weakest');

  useEffect(() => {
    Promise.all([loadAllQuestions(), loadAllFlashcards()]).then(([q, c]) => {
      setQuestions(q);
      setCards(c);
    });
  }, []);

  const weakQs = useMemo(
    () => (questions ?? []).filter((q) => isWeakQuestion(progress.questions[q.id])).sort((a, b) => weakScore(progress.questions[b.id]) - weakScore(progress.questions[a.id])),
    [questions, progress.questions],
  );
  const weakCards = useMemo(() => (cards ?? []).filter((c) => isWeakCard(progress.cards[c.id])), [cards, progress.cards]);
  const saved = progress.quizzes.weak;
  const savedQuestions = useMemo(() => (questions && saved ? sessionQuestions(saved, questions) : null), [questions, saved]);

  const groups = useMemo(() => {
    const m = new Map<string, { qs: Question[]; cards: WithSection<Flashcard>[] }>();
    const add = (sid: string) => m.get(sid) ?? m.set(sid, { qs: [], cards: [] }).get(sid)!;
    if (filter !== 'cards') for (const q of weakQs) add(q.sectionId).qs.push(q);
    if (filter !== 'questions') for (const c of weakCards) add(c.sectionId).cards.push(c);
    const order = new Map(sections.map((s) => [s.id, s.order]));
    const misses = (g: { qs: Question[] }) => g.qs.reduce((n, q) => n + progress.questions[q.id].wrong, 0);
    const accuracy = (sid: string) => {
      const t = sectionTrend(progress, sid);
      return t.length ? t[t.length - 1] : 100;
    };
    return [...m.entries()].sort((a, b) => {
      if (sort === 'order') return (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0);
      if (sort === 'missed') return misses(b[1]) - misses(a[1]);
      return accuracy(a[0]) - accuracy(b[0]) || b[1].qs.length + b[1].cards.length - (a[1].qs.length + a[1].cards.length);
    });
  }, [weakQs, weakCards, filter, sort, progress]);

  if (view.kind === 'quiz') {
    return (
      <div className="page">
        <header className="page-head page-head--compact">
          <p className="eyebrow">Weak areas</p>
          <h1>Practise missed questions</h1>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView({ kind: 'overview' })}>
            Back to weak areas
          </button>
        </header>
        <QuizRunner
          questions={view.questions}
          mode="weak"
          sectionIds={[...new Set(view.questions.map((q) => q.sectionId))]}
          title="Weak areas"
          sessionKey="weak"
          resume={view.resume}
          showSection
        />
      </div>
    );
  }
  if (view.kind === 'cards') {
    return (
      <div className="page">
        <header className="page-head page-head--compact">
          <p className="eyebrow">Weak areas</p>
          <h1>Review hard cards</h1>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView({ kind: 'overview' })}>
            Back to weak areas
          </button>
        </header>
        <FlashcardDeck cards={view.cards} title="Hard cards" showSection initialMode="all" />
      </div>
    );
  }

  const total = weakQs.length + weakCards.length;

  return (
    <div className="page weak">
      <header className="weak__head">
        <div>
          <h1>Weak areas</h1>
          <p className="muted">Questions you missed stay here until you answer them right twice in a row. Cards stay while you keep rating them Hard.</p>
        </div>
        <button type="button" className="btn btn--primary btn--lg" aria-disabled={!weakQs.length} onClick={() => weakQs.length && setView({ kind: 'quiz', questions: weakQs })}>
          <Play size={18} aria-hidden /> Practice all questions ({weakQs.length})
        </button>
      </header>

      {saved && savedQuestions && (
        <ResumeBanner
          session={saved}
          label="Weak-area practice"
          onResume={() => setView({ kind: 'quiz', questions: savedQuestions, resume: saved })}
          onDiscard={() => setQuizSession('weak', undefined)}
        />
      )}

      {!questions || !cards ? (
        <p className="muted">Loading…</p>
      ) : total === 0 ? (
        <div className="empty-state card">
          <Target size={32} aria-hidden />
          <h3>No weak areas yet</h3>
          <p>Answer some quiz questions and review flashcards; anything you keep missing shows up here.</p>
          <Link className="btn btn--secondary" to="/practice">
            Start a practice quiz
          </Link>
        </div>
      ) : (
        <>
          <div className="weak__tools">
            <Segmented<Filter>
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All · ${total}` },
                { value: 'questions', label: `Questions · ${weakQs.length}` },
                { value: 'cards', label: `Flashcards · ${weakCards.length}` },
              ]}
            />
            <label className="field field--inline">
              <span className="field-label">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="weakest">Weakest first</option>
                <option value="missed">Most missed</option>
                <option value="order">Section order</option>
              </select>
            </label>
            {weakCards.length > 0 && (
              <button type="button" className="btn btn--secondary" onClick={() => setView({ kind: 'cards', cards: weakCards })}>
                <Layers size={18} aria-hidden /> Review all hard cards ({weakCards.length})
              </button>
            )}
          </div>

          <div className="weak__groups">
            {groups.map(([sid, g]) => {
              const trend = sectionTrend(progress, sid);
              const last = trend[trend.length - 1];
              const delta = trend.length > 1 ? last - trend[0] : 0;
              return (
                <section key={sid} className="weak-group card">
                  <header className="weak-group__head">
                    <span className="num-tile" aria-hidden>
                      {String(getSection(sid)?.order ?? '').padStart(2, '0')}
                    </span>
                    <div className="weak-group__title">
                      <h3>
                        <Link to={`/section/${sid}`}>{sectionTitle(sid)}</Link>
                      </h3>
                      <div className="weak-group__chips">
                        {g.qs.length > 0 && (
                          <span className="chip chip--notfree">
                            <CircleQuestionMark size={14} strokeWidth={2} aria-hidden /> {g.qs.length} missed question{g.qs.length === 1 ? '' : 's'}
                          </span>
                        )}
                        {g.cards.length > 0 && (
                          <span className="chip chip--verify">
                            <Layers size={14} strokeWidth={2} aria-hidden /> {g.cards.length} hard card{g.cards.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                    {trend.length > 1 && (
                      <div className="weak-group__trend">
                        <Sparkline values={trend} width={96} height={32} />
                        <span className="mono weak-group__acc">{last}%</span>
                        <span className="caption">
                          {delta >= 0 ? '+' : ''}
                          {delta} pts
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => (g.qs.length ? setView({ kind: 'quiz', questions: g.qs }) : setView({ kind: 'cards', cards: g.cards }))}
                    >
                      <Play size={18} aria-hidden /> Practice these ({g.qs.length + g.cards.length})
                    </button>
                  </header>
                  <div className="weak-group__body">
                    {g.qs.length > 0 && (
                      <div>
                        <p className="mono-label">Questions you keep missing</p>
                        <ul className="weak-list">
                          {g.qs.slice(0, 6).map((q) => {
                            const st = progress.questions[q.id];
                            return (
                              <li key={q.id}>
                                <Link to={`/section/${sid}/quiz?q=${encodeURIComponent(q.id)}`}>{q.question}</Link>
                                <span className="caption">
                                  Missed {st.wrong} of {st.seen} · last seen {ago(st.lastAnsweredAt)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {g.cards.length > 0 && (
                      <div>
                        <p className="mono-label">Cards you rate Hard</p>
                        <ul className="weak-list">
                          {g.cards.slice(0, 6).map((c) => (
                            <li key={c.id}>
                              <Link to={`/section/${sid}/flashcards?card=${encodeURIComponent(c.id)}`}>{c.front}</Link>
                              <span className="badge badge--verify">Hard ×{progress.cards[c.id].hardCount}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
