import { Link } from 'react-router-dom';
import { ArrowRight, Award, BookOpen, CircleQuestionMark, FlaskConical, Layers, Play } from 'lucide-react';
import { availableSections, course, getSection, sections } from '../content/load';
import { useProgress } from '../state/store';
import { overallProgress, sectionProgress, useCounts } from '../lib/progress';
import { cardStatus } from '../lib/srs';
import { KnowledgeMap } from '../components/KnowledgeMap';
import { MiniRing } from '../components/ProgressDot';

export function HomePage() {
  const progress = useProgress();
  const counts = useCounts();
  const o = overallProgress(progress, counts);
  const totals = counts ? Object.values(counts).reduce((t, c) => ({ cards: t.cards + c.cards, questions: t.questions + c.questions, labs: t.labs + c.labs }), { cards: 0, questions: 0, labs: 0 }) : null;

  // "Continue": the section last visited, else the first unread one.
  const lastId = progress.lastLocation?.path.match(/^\/section\/([^/?#]+)/)?.[1];
  const current = (lastId && getSection(lastId)?.meta ? getSection(lastId) : undefined) ?? availableSections.find((s) => !progress.lessons[s.id]?.readAt) ?? availableSections[0];
  const currentProgress = current ? sectionProgress(current.id, progress, counts) : null;
  const nextUp = current ? availableSections.find((s) => s.order > current.order && !progress.lessons[s.id]?.readAt) : undefined;
  const dueHere = current ? Object.entries(progress.cards).filter(([id, c]) => id.startsWith(`${current.id}-fc-`) && cardStatus(c) === 'due').length : 0;

  return (
    <div className="page home">
      <header className="home__hero">
        <p className="mono-label">
          {course.code} · {course.title}
        </p>
        <h1>Your study dashboard</h1>
        <p className="muted">
          {o.sectionsAvailable} of {o.sectionsTotal} sections ready{totals && ` · ${totals.cards} flashcards · ${totals.questions} questions · ${totals.labs} labs`}
        </p>
      </header>

      <section className="stats" aria-label="Progress">
        <div className="stat-tile stat-tile--ring">
          <span className="stat-tile__label">Course complete</span>
          <div className="stat-tile__ring">
            <MiniRing value={o.completion} size={44} stroke={6} label={`${Math.round(o.completion * 100)}% complete`} />
            <strong>{Math.round(o.completion * 100)}%</strong>
          </div>
          <span className="stat-tile__sub">Lessons 40% · quizzes 30% · cards 30%</span>
        </div>
        <Link to={current ? `/section/${current.id}` : '/'} className="stat-tile">
          <span className="stat-tile__label">Lessons read</span>
          <BookOpen size={18} className="stat-tile__icon" aria-hidden />
          <strong>
            {o.lessonsRead}
            <small> / {o.sectionsTotal}</small>
          </strong>
          <span className="stat-tile__sub">{o.sectionsTotal - o.lessonsRead} to go</span>
        </Link>
        <Link to="/review" className="stat-tile">
          <span className="stat-tile__label">Flashcards due</span>
          <Layers size={18} className="stat-tile__icon" aria-hidden />
          <strong>{o.cardsDue}</strong>
          <span className="stat-tile__sub">
            {o.cardsNew} new · {o.cardsLearned} learned
          </span>
        </Link>
        <Link to="/practice" className="stat-tile">
          <span className="stat-tile__label">Average quiz score</span>
          <CircleQuestionMark size={18} className="stat-tile__icon" aria-hidden />
          <strong>{o.avgQuiz === null ? '—' : `${Math.round(o.avgQuiz * 100)}%`}</strong>
          <span className="stat-tile__sub">
            {o.quizAttempts} quiz{o.quizAttempts === 1 ? '' : 'zes'} taken
          </span>
        </Link>
        <div className="stat-tile">
          <span className="stat-tile__label">Labs completed</span>
          <FlaskConical size={18} className="stat-tile__icon" aria-hidden />
          <strong>
            {o.labsDone}
            <small> / {o.labsTotal}</small>
          </strong>
          <span className="stat-tile__sub">Cleanup checklist required</span>
        </div>
        <Link to="/exam" className="stat-tile">
          <span className="stat-tile__label">Best exam score</span>
          <Award size={18} className="stat-tile__icon" aria-hidden />
          <strong>{o.bestExam ?? '—'}</strong>
          <span className="stat-tile__sub">
            Pass {course.exam.passScore} · {o.examAttempts} attempt{o.examAttempts === 1 ? '' : 's'}
          </span>
        </Link>
      </section>

      <div className="home__grid">
        {current && current.meta && currentProgress && (
          <section className="card continue">
            <p className="mono-label">{progress.lastLocation ? 'Continue where you left off' : 'Start here'}</p>
            <div className="continue__main">
              <span className="num-tile num-tile--accent" aria-hidden>
                {String(current.order).padStart(2, '0')}
              </span>
              <div>
                <h3 className="continue__title">{current.meta.title}</h3>
                <p className="caption">
                  {current.partTitle} · {current.meta.estimatedMinutes} min · slides {current.meta.slides[0]}–{current.meta.slides[1]}
                </p>
              </div>
            </div>
            <div className="continue__bar">
              <span className="progress-bar" aria-hidden>
                <span style={{ width: `${currentProgress.completion * 100}%` }} />
              </span>
              <span className="mono">{Math.round(currentProgress.completion * 100)}% done</span>
            </div>
            {nextUp && (
              <Link to={`/section/${nextUp.id}`} className="continue__next">
                <ArrowRight size={16} aria-hidden />
                <span>
                  Next up: <strong>{nextUp.meta?.title}</strong>
                </span>
              </Link>
            )}
            <div className="button-row">
              <Link to={progress.lastLocation?.path.startsWith(`/section/${current.id}`) ? progress.lastLocation.path : `/section/${current.id}`} className="btn btn--primary">
                <Play size={18} aria-hidden /> {progress.lastLocation ? 'Resume lesson' : 'Start lesson'}
              </Link>
              <Link to={`/section/${current.id}/flashcards`} className="btn btn--secondary">
                <Layers size={18} aria-hidden /> {dueHere ? `${dueHere} cards due here` : 'Flashcards'}
              </Link>
            </div>
          </section>
        )}

        <section className="card parts">
          <div className="parts__head">
            <h3>Progress by part</h3>
            <span className="caption">sections read</span>
          </div>
          <ul className="part-rows">
            {course.parts.map((p, i) => {
              const list = sections.filter((s) => s.partId === p.id);
              const read = list.filter((s) => progress.lessons[s.id]?.readAt).length;
              const first = list.find((s) => s.meta);
              const inner = (
                <>
                  <span className="part-row__name">
                    <span className="mono">P{i + 1}</span> {p.title}
                  </span>
                  <span className="progress-bar progress-bar--sm" aria-hidden>
                    <span className={read === list.length ? 'is-good' : ''} style={{ width: `${(read / list.length) * 100}%` }} />
                  </span>
                  <span className="mono part-row__value">
                    {read}/{list.length}
                  </span>
                </>
              );
              return (
                <li key={p.id}>
                  {first ? (
                    <Link className="part-row" to={`/section/${first.id}`}>
                      {inner}
                    </Link>
                  ) : (
                    <span className="part-row part-row--pending">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="home__map">
        <KnowledgeMap />
      </div>
    </div>
  );
}
