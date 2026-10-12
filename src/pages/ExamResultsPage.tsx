import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ChevronDown, RotateCcw, X } from 'lucide-react';
import { course, getSection, loadAllQuestions, sectionTitle } from '../content/load';
import { useProgress } from '../state/store';
import { correctIds, domainBreakdown, formatClock, sectionBreakdown, type Question } from '../lib/quiz';
import { InlineMarkdown } from '../components/Markdown';
import { ScoreDial } from '../components/ScoreDial';
import type { Domain } from '../content/types';

function barClass(pct: number): string {
  return pct >= 0.8 ? 'is-good' : pct >= 0.5 ? 'is-mid' : 'is-bad';
}

export function ExamResultsPage() {
  const { attemptId } = useParams();
  const progress = useProgress();
  const exams = progress.attempts.filter((a) => a.mode === 'exam');
  const attempt = exams.find((a) => a.id === attemptId);
  const [pool, setPool] = useState<Question[] | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(true);

  useEffect(() => {
    loadAllQuestions().then(setPool);
  }, []);

  const byId = useMemo(() => new Map((pool ?? []).map((q) => [q.id, q])), [pool]);

  if (!attempt) {
    return (
      <div className="page empty-state">
        <h1>Result not found</h1>
        <Link to="/exam" className="btn btn--primary">
          Exam simulation
        </Link>
      </div>
    );
  }
  if (!pool) return <div className="page muted">Loading…</div>;

  const attemptNo = exams.indexOf(attempt) + 1;
  const previousBest = Math.max(0, ...exams.slice(0, attemptNo - 1).map((a) => a.scaled ?? 0));
  const questions = attempt.answers.map((a) => byId.get(a.questionId)).filter((q): q is Question => !!q);
  const answers = Object.fromEntries(attempt.answers.map((a) => [a.questionId, a.chosen]));
  const domains = domainBreakdown(questions, answers);
  const bySection = [...sectionBreakdown(questions, answers).entries()].sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total);
  const scaled = attempt.scaled ?? 0;
  const passed = scaled >= course.exam.passScore;
  const margin = Math.abs(scaled - course.exam.passScore);
  const wrongCount = attempt.answers.filter((a) => !a.correct).length;
  const list = attempt.answers.filter((a) => !onlyWrong || !a.correct);
  const minutesUsed = Math.round(attempt.durationSec / 60);

  return (
    <div className="page exam-results">
      <header className="results-head">
        <div>
          <p className="mono-label">Exam simulation · attempt {attemptNo}</p>
          <h1>Results</h1>
          <p className="muted">
            Finished {new Date(attempt.finishedAt).toLocaleDateString()} · {minutesUsed} of {course.exam.minutes} minutes used · {attempt.correct} of {attempt.total} correct
          </p>
        </div>
        <div className="button-row">
          <Link to="/exam" className="btn btn--secondary">
            <RotateCcw size={18} aria-hidden /> Retake exam
          </Link>
          {wrongCount > 0 && (
            <a href="#review" className="btn btn--primary" onClick={() => setOnlyWrong(true)}>
              Review wrong answers ({wrongCount})
            </a>
          )}
        </div>
      </header>

      <section className="card results-top">
        <ScoreDial value={scaled} max={course.exam.maxScore} pass={course.exam.passScore} passed={passed} />
        <div className="results-top__facts">
          <h3>{passed ? `You passed, ${margin} points above the line` : `Not yet, ${margin} points below the line`}</h3>
          <div className="results-top__tiles">
            <div className="summary-tile">
              <span>Correct</span>
              <strong>
                {attempt.correct}/{attempt.total}
              </strong>
            </div>
            <div className="summary-tile">
              <span>Pass mark</span>
              <strong>{course.exam.passScore}</strong>
            </div>
            <div className="summary-tile">
              <span>Time used</span>
              <strong>{formatClock(attempt.durationSec * 1000)}</strong>
            </div>
            <div className="summary-tile">
              <span>Previous best</span>
              <strong>{previousBest || '—'}</strong>
            </div>
          </div>
          <p className="caption">Practice estimate. The real exam scales scores from 100 to 1000 and includes unscored questions; this maps your percentage linearly onto that range.</p>
        </div>
      </section>

      <div className="results-grid">
        <section className="card">
          <h2>By exam domain</h2>
          <ul className="domain-rows">
            {course.exam.domains.map((d) => {
              const r = domains[d.id as Domain];
              const pct = r.total ? r.correct / r.total : 0;
              return (
                <li key={d.id} className="domain-row">
                  <div className="domain-row__name">
                    <span className={`domain-square domain-square--${d.id}`} aria-hidden />
                    <span>{d.title}</span>
                    <span className="chip chip--neutral chip--mono">{d.weight}% of exam</span>
                  </div>
                  <div className="domain-row__bar">
                    <span
                      className={`progress-bar progress-bar--lg progress-bar--domain-${d.id}`}
                      role="progressbar"
                      aria-label={`${d.title} score`}
                      aria-valuemin={0}
                      aria-valuemax={r.total}
                      aria-valuenow={r.correct}
                    >
                      <span style={{ width: `${pct * 100}%` }} />
                    </span>
                    <span className="mono domain-row__value">
                      {r.correct}/{r.total} · {Math.round(pct * 100)}%
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card">
          <h2>By section</h2>
          <p className="caption">Weakest first</p>
          <ul className="section-rows">
            {bySection.map(([sid, r]) => {
              const pct = r.correct / r.total;
              return (
                <li key={sid}>
                  <Link className="section-row" to={`/section/${sid}`}>
                    <span className="mono section-row__num">{String(getSection(sid)?.order ?? '').padStart(2, '0')}</span>
                    <span className="section-row__name">{sectionTitle(sid)}</span>
                    <span className="progress-bar progress-bar--sm" aria-hidden>
                      <span className={barClass(pct)} style={{ width: `${pct * 100}%` }} />
                    </span>
                    <span className="mono section-row__value">
                      {r.correct}/{r.total}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="card review-list" id="review">
        <div className="review-list__head">
          <h2>Review answers</h2>
          <label className="check">
            <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} /> Only wrong answers
          </label>
        </div>
        {list.length === 0 && <p className="muted">Nothing wrong. Well done.</p>}
        {list.map((a) => {
          const q = byId.get(a.questionId);
          if (!q) return null;
          const right = correctIds(q);
          const n = attempt.answers.indexOf(a) + 1;
          return (
            <details key={a.questionId} className={`review-item ${a.correct ? 'is-correct' : 'is-wrong'}`}>
              <summary>
                <span className="mono review-item__n">Q{n}</span>
                <span className="review-item__main">
                  <span className="review-item__q">{q.question}</span>
                  <span className="review-item__meta">
                    {course.exam.domains.find((d) => d.id === q.domain)?.title} · You chose{' '}
                    <strong className={a.correct ? 'is-right' : 'is-wrong'}>{a.chosen.join(', ') || 'nothing'}</strong> · correct <strong className="is-right">{right.join(', ')}</strong>
                  </span>
                </span>
                {a.correct ? <Check size={18} strokeWidth={2.5} className="review-item__icon is-right" aria-label="Correct" /> : <X size={18} strokeWidth={2.5} className="review-item__icon is-wrong" aria-label="Wrong" />}
                <ChevronDown size={18} className="review-item__chev" aria-hidden />
              </summary>
              <div className="review-item__body">
                <InlineMarkdown markdown={q.question} />
                <ul className="review-item__options">
                  {q.options.map((o) => {
                    const isRight = right.includes(o.id);
                    const mine = a.chosen.includes(o.id);
                    return (
                      <li key={o.id} className={isRight ? 'is-right' : mine ? 'is-chosen-wrong' : ''}>
                        <div className="review-item__opt">
                          <strong>{o.id}.</strong> <InlineMarkdown markdown={o.text} />
                        </div>
                        <div className={`option__why${isRight ? ' option__why--right' : mine ? ' option__why--wrong' : ''}`}>
                          <span className="option__why-label">{isRight ? "Why it's right" : mine ? "Your choice · why it's wrong" : "Why it's wrong"}</span>
                          <InlineMarkdown markdown={o.explanation} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="takeaway">
                  <span className="mono-label">Takeaway</span>
                  <InlineMarkdown markdown={q.explanation} />
                </div>
                <Link to={`/section/${q.sectionId}`}>Open the {sectionTitle(q.sectionId)} lesson</Link>
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}
