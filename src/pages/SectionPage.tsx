import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, CircleCheck, CircleQuestionMark, Clock, ExternalLink, FlaskConical, Layers, Presentation, ShieldCheck } from 'lucide-react';
import { availableSections, course, getSection, labCount, loadFlashcards, loadLabs, loadLesson, loadQuiz } from '../content/load';
import type { Flashcard, Lab, QuizQuestion, WithSection } from '../content/types';
import { markLessonRead, useProgress, visitLesson } from '../state/store';
import { Markdown } from '../components/Markdown';
import { Toc } from '../components/Toc';
import { FlashcardDeck } from '../components/FlashcardDeck';
import { QuizRunner } from '../components/QuizRunner';
import { LabView } from '../components/LabView';
import { DOMAIN_LABEL } from '../lib/quiz';
import { sectionState } from '../lib/progress';
import type { TocEntry } from '../lib/remark';
import { NotFoundPage } from './NotFoundPage';

type Tab = 'lesson' | 'flashcards' | 'quiz' | 'lab';
const TABS: Tab[] = ['lesson', 'flashcards', 'quiz', 'lab'];

export function SectionPage() {
  const { id = '', tab: rawTab } = useParams();
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'lesson';
  const entry = getSection(id);
  const progress = useProgress();
  const { pathname, search, hash } = useLocation();

  const [lesson, setLesson] = useState<string | null>(null);
  const [cards, setCards] = useState<WithSection<Flashcard>[] | null>(null);
  const [questions, setQuestions] = useState<WithSection<QuizQuestion>[] | null>(null);
  const [labs, setLabs] = useState<Lab[] | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);

  useEffect(() => {
    if (!entry?.meta) return;
    let alive = true;
    setLesson(null);
    setCards(null);
    setQuestions(null);
    setLabs(null);
    setToc([]);
    Promise.all([loadLesson(id), loadFlashcards(id), loadQuiz(id), loadLabs(id)]).then(([l, c, q, lb]) => {
      if (!alive) return;
      setLesson(l ?? '');
      setCards(c);
      setQuestions(q);
      setLabs(lb);
    });
    return () => {
      alive = false;
    };
  }, [id, entry?.meta]);

  useEffect(() => {
    if (entry?.meta) visitLesson(id, pathname, `${entry.order}. ${entry.meta.title}${tab === 'lesson' ? '' : ` · ${tab}`}`);
    // Only on navigation, not on every progress change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tab]);

  // Scroll to a heading anchor once the lesson has rendered.
  useEffect(() => {
    if (tab !== 'lesson' || lesson === null) return;
    if (hash) {
      const t = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }), 60);
      return () => clearTimeout(t);
    }
    window.scrollTo({ top: 0 });
  }, [tab, lesson, hash]);

  const onToc = useCallback((t: TocEntry[]) => setToc((prev) => (JSON.stringify(prev) === JSON.stringify(t) ? prev : t)), []);

  if (!entry) return <NotFoundPage />;
  const meta = entry.meta;
  if (!meta) {
    return (
      <div className="page">
        <p className="eyebrow">
          Section {entry.order} · {entry.partTitle}
        </p>
        <h1>{entry.id.replace(/^\d+-/, '').replace(/-/g, ' ')}</h1>
        <p className="muted">This section's content has not been written yet.</p>
      </div>
    );
  }

  const read = !!progress.lessons[id]?.readAt;
  const state = sectionState(id, progress);
  const idx = availableSections.findIndex((s) => s.id === id);
  const prev = idx > 0 ? availableSections[idx - 1] : undefined;
  const next = idx >= 0 && idx < availableSections.length - 1 ? availableSections[idx + 1] : undefined;
  const params = new URLSearchParams(search);
  const nLabs = labs?.length ?? labCount(id);
  const num = String(entry.order).padStart(2, '0');

  const tabMeta: Record<Tab, { label: string; Icon: typeof BookOpen; count?: number }> = {
    lesson: { label: 'Lesson', Icon: BookOpen },
    flashcards: { label: 'Flashcards', Icon: Layers, count: cards?.length },
    quiz: { label: 'Quiz', Icon: CircleQuestionMark, count: questions?.length },
    lab: { label: 'Lab', Icon: FlaskConical, count: nLabs },
  };

  return (
    <div className="page section-page">
      <header className="section-head">
        <p className="mono-label">
          Part {course.parts.findIndex((p) => p.id === entry.partId) + 1} · {entry.partTitle}
        </p>
        <div className="section-head__row">
          <h1 className="section-head__title">
            <span className="section-head__num" aria-hidden>
              {num}
            </span>
            <span>{meta.title}</span>
          </h1>
          <button type="button" className={`btn btn--secondary section-head__read${read ? ' is-read' : ''}`} onClick={() => markLessonRead(id, !read)} aria-pressed={read}>
            <CircleCheck size={18} aria-hidden />
            {read ? 'Read' : 'Mark as read'}
          </button>
        </div>
        <div className="section-head__chips">
          <span className="chip chip--neutral chip--mono" title="Slides in the course deck">
            <Presentation size={14} strokeWidth={2} aria-hidden /> Slides {meta.slides[0]}–{meta.slides[1]}
          </span>
          <span className="chip chip--neutral">
            <Clock size={14} strokeWidth={2} aria-hidden /> {meta.estimatedMinutes} min
          </span>
          <span className={`chip ${state === 'done' ? 'chip--free' : 'chip--accent'}`}>{state === 'done' ? 'Read' : state === 'in-progress' ? 'In progress' : 'Not started'}</span>
          <span className="chip chip--neutral" title="Facts checked against AWS documentation on this date">
            <ShieldCheck size={14} strokeWidth={2} aria-hidden /> Checked {meta.lastVerified}
          </span>
          {meta.examDomains.map((d) => (
            <span key={d} className={`chip chip--domain chip--domain-${d}`}>
              <span className="domain-square" aria-hidden /> {DOMAIN_LABEL[d]}
            </span>
          ))}
        </div>
        <p className="section-head__summary">{meta.summary}</p>
      </header>

      <nav className="tabs" aria-label="Section views">
        {TABS.map((t) => {
          const { label, Icon, count } = tabMeta[t];
          return (
            <NavLink
              key={t}
              to={t === 'lesson' ? `/section/${id}` : `/section/${id}/${t}`}
              end
              className={() => `tabs__tab${tab === t ? ' tabs__tab--active' : ''}`}
              aria-current={tab === t ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
              {count !== undefined && <span className="tabs__count">{count}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="section-body">
        {tab === 'lesson' && (
          <div className="lesson-layout">
            <article className="lesson">
              {lesson === null ? <p className="muted">Loading lesson…</p> : <Markdown markdown={lesson} onToc={onToc} />}
              {lesson !== null && (
                <>
                  <section className="sources" aria-labelledby="sources-title">
                    <h2 id="sources-title">Checked against AWS documentation</h2>
                    <p className="muted">Last verified {meta.lastVerified}. Pages used to confirm or update the slide content:</p>
                    <ul>
                      {meta.sources.map((s) => (
                        <li key={s.url}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer">
                            {s.title} <ExternalLink size={12} aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <div className="lesson-end">
                    {!read && (
                      <button type="button" className="btn btn--primary" onClick={() => markLessonRead(id, true)}>
                        <CircleCheck size={18} aria-hidden /> Mark lesson as read
                      </button>
                    )}
                    <Link className="btn btn--secondary" to={`/section/${id}/flashcards`}>
                      <Layers size={18} aria-hidden /> Practise flashcards
                    </Link>
                    <Link className="btn btn--secondary" to={`/section/${id}/quiz`}>
                      <CircleQuestionMark size={18} aria-hidden /> Take the quiz
                    </Link>
                  </div>
                </>
              )}
            </article>
            <Toc entries={toc} />
          </div>
        )}
        {tab === 'flashcards' &&
          (cards ? <FlashcardDeck key={id} cards={cards} title={meta.title} startCardId={params.get('card') ?? undefined} /> : <p className="muted">Loading cards…</p>)}
        {tab === 'quiz' &&
          (questions ? (
            <QuizRunner key={`${id}-${params.get('q') ?? ''}`} questions={questions} mode="section" sectionIds={[id]} title={`${meta.title} quiz`} startQuestionId={params.get('q') ?? undefined} />
          ) : (
            <p className="muted">Loading questions…</p>
          ))}
        {tab === 'lab' &&
          (labs ? (
            labs.length ? (
              <LabView key={`${id}-${params.get('lab') ?? ''}`} labs={labs} sectionId={id} initialLabId={params.get('lab') ?? undefined} />
            ) : (
              <div className="empty-state">
                <FlaskConical size={32} aria-hidden />
                <h2>No hands-on lab for this section</h2>
                <p className="muted">This topic is conceptual or cannot be practised safely in a personal account. Use the flashcards and quiz instead.</p>
              </div>
            )
          ) : (
            <p className="muted">Loading labs…</p>
          ))}
      </div>

      <nav className="pager" aria-label="Section navigation">
        {prev ? (
          <Link to={`/section/${prev.id}`} className="pager__link">
            <ArrowLeft size={18} aria-hidden />
            <span>
              <small>Previous</small>
              {String(prev.order).padStart(2, '0')} {prev.meta?.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/section/${next.id}`} className="pager__link pager__link--next">
            <span>
              <small>Next</small>
              {String(next.order).padStart(2, '0')} {next.meta?.title}
            </span>
            <ArrowRight size={18} aria-hidden />
          </Link>
        )}
      </nav>

      {tab === 'lesson' && (
        <div className="phone-bar" role="toolbar" aria-label="Lesson actions">
          {prev ? (
            <Link to={`/section/${prev.id}`} className="icon-btn" aria-label={`Previous: ${prev.meta?.title}`}>
              <ArrowLeft size={20} aria-hidden />
            </Link>
          ) : (
            <span className="icon-btn" aria-hidden />
          )}
          <button type="button" className={`btn ${read ? 'btn--secondary' : 'btn--primary'} phone-bar__main`} onClick={() => markLessonRead(id, !read)} aria-pressed={read}>
            <CircleCheck size={18} aria-hidden /> {read ? 'Read' : 'Mark as read'}
          </button>
          {next ? (
            <Link to={`/section/${next.id}`} className="icon-btn" aria-label={`Next: ${next.meta?.title}`}>
              <ArrowRight size={20} aria-hidden />
            </Link>
          ) : (
            <span className="icon-btn" aria-hidden />
          )}
        </div>
      )}
    </div>
  );
}

