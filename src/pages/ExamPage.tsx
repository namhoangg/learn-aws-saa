import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Flag, Send, Timer, TriangleAlert, X } from 'lucide-react';
import { course, loadAllQuestions } from '../content/load';
import { recordAnswer, saveAttempt, setExam, useProgress, type ExamSession } from '../state/store';
import { buildExam, formatClock, isCorrect, scaledScore, selectCount, type Question } from '../lib/quiz';
import { InlineMarkdown } from '../components/Markdown';
import { isTyping } from '../components/Layout';
import { useDialogFocus } from '../lib/useDialogFocus';

const WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR'];

export function ExamPage() {
  const progress = useProgress();
  const navigate = useNavigate();
  const [pool, setPool] = useState<Question[] | null>(null);
  const exam = progress.exam;

  useEffect(() => {
    loadAllQuestions().then(setPool);
  }, []);

  const byId = useMemo(() => new Map((pool ?? []).map((q) => [q.id, q])), [pool]);

  if (!pool) return <div className="page muted">Loading questions…</div>;

  const start = () => {
    const qs = buildExam(pool, course, progress.questions);
    const now = Date.now();
    const session: ExamSession = {
      id: `exam-${now}`,
      questionIds: qs.map((q) => q.id),
      answers: {},
      flagged: [],
      current: 0,
      startedAt: new Date(now).toISOString(),
      deadline: now + course.exam.minutes * 60_000,
    };
    setExam(session);
  };

  if (!exam) {
    const short = pool.length < course.exam.questions;
    const pastExams = progress.attempts.filter((a) => a.mode === 'exam');
    return (
      <div className="page exam-intro">
        <header className="page-head">
          <p className="eyebrow">Timed practice</p>
          <h1>Exam simulation</h1>
          <p className="muted">
            Questions are drawn from every section in proportion to the four SAA-C03 domains, favouring ones you have seen least. There is no feedback until you submit, just like the real
            exam.
          </p>
        </header>
        <div className="exam-intro__facts">
          <div className="stat-tile">
            <span className="stat-tile__label">Questions</span>
            <strong>{Math.min(course.exam.questions, pool.length)}</strong>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__label">Minutes</span>
            <strong>{course.exam.minutes}</strong>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__label">Pass mark</span>
            <strong>
              {course.exam.passScore}
              <small> / {course.exam.maxScore}</small>
            </strong>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__label">Attempts so far</span>
            <strong>{pastExams.length}</strong>
          </div>
        </div>
        <div className="card">
          <h2>Domains</h2>
          <ul className="exam-intro__domains">
            {course.exam.domains.map((d) => (
              <li key={d.id}>
                <span className={`domain-square domain-square--${d.id}`} aria-hidden />
                <span>{d.title}</span>
                <span className="chip chip--neutral chip--mono">{d.weight}% of exam</span>
              </li>
            ))}
          </ul>
        </div>
        {short && (
          <p className="callout-inline">
            <TriangleAlert size={18} aria-hidden /> Only {pool.length} questions exist so far, so this exam uses all of them.
          </p>
        )}
        <p className="muted exam-intro__note">The timer keeps running if you leave this page; answers are saved as you go. Keys: 1–6 choose, N next, P previous, F flag.</p>
        <button type="button" className="btn btn--primary btn--lg" onClick={start} disabled={!pool.length}>
          <Timer size={18} aria-hidden /> Start the exam
        </button>
      </div>
    );
  }

  return <ExamRunner exam={exam} byId={byId} onSubmitted={(id) => navigate(`/exam/results/${id}`)} />;
}

const ANNOUNCE_AT = [30, 10, 5, 1];

function ExamRunner({ exam, byId, onSubmitted }: { exam: ExamSession; byId: Map<string, Question>; onSubmitted: (attemptId: string) => void }) {
  const progress = useProgress();
  const shortcuts = progress.settings.shortcuts !== false;
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [announce, setAnnounce] = useState('');
  // Thresholds already behind us when the page opens (e.g. resuming) are never announced.
  const announced = useRef(new Set(ANNOUNCE_AT.filter((m) => Math.ceil((exam.deadline - Date.now()) / 60_000) <= m)));
  const submitted = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef, confirming);
  const questions = exam.questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q);
  const q = questions[exam.current];
  const remaining = exam.deadline - now;
  const isAnswered = (x: Question) => (exam.answers[x.id]?.length ?? 0) === selectCount(x);
  const answered = questions.filter(isAnswered).length;
  const unanswered = questions.length - answered;

  const submit = () => {
    if (submitted.current) return;
    submitted.current = true;
    const finishedAt = new Date();
    const answers = questions.map((x) => {
      const chosen = exam.answers[x.id] ?? [];
      const correct = isCorrect(x, chosen);
      recordAnswer(x.id, correct);
      return { questionId: x.id, sectionId: x.sectionId, chosen, correct };
    });
    const correct = answers.filter((a) => a.correct).length;
    saveAttempt({
      id: exam.id,
      mode: 'exam',
      sectionIds: [...new Set(questions.map((x) => x.sectionId))],
      startedAt: exam.startedAt,
      finishedAt: finishedAt.toISOString(),
      total: questions.length,
      correct,
      scaled: scaledScore(correct, questions.length, course),
      durationSec: Math.min(course.exam.minutes * 60, Math.round((finishedAt.getTime() - new Date(exam.startedAt).getTime()) / 1000)),
      answers,
    });
    setExam(undefined);
    onSubmitted(exam.id);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Screen-reader announcements only at a few thresholds, not every second.
  useEffect(() => {
    const mins = Math.ceil(remaining / 60_000);
    for (const m of ANNOUNCE_AT) {
      if (mins <= m && !announced.current.has(m) && remaining > 0) {
        announced.current.add(m);
        setAnnounce(`${m} minute${m === 1 ? '' : 's'} left`);
      }
    }
  }, [remaining]);

  // Time is up: submit what is there.
  useEffect(() => {
    if (remaining <= 0) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);

  const go = (i: number) => setExam({ ...exam, current: Math.max(0, Math.min(questions.length - 1, i)) });
  const choose = (optId: string) => {
    if (!q) return;
    const prev = exam.answers[q.id] ?? [];
    const need = selectCount(q);
    let next: string[];
    if (q.type === 'single') next = [optId];
    else next = prev.includes(optId) ? prev.filter((x) => x !== optId) : prev.length < need ? [...prev, optId] : prev;
    setExam({ ...exam, answers: { ...exam.answers, [q.id]: next } });
  };
  const toggleFlag = () => {
    if (!q) return;
    const flagged = exam.flagged.includes(q.id) ? exam.flagged.filter((x) => x !== q.id) : [...exam.flagged, q.id];
    setExam({ ...exam, flagged });
  };

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || confirming || !q) return;
      const k = e.key.toUpperCase();
      const byNumber = /^[1-6]$/.test(k) ? q.options[Number(k) - 1] : undefined;
      const handled = !!byNumber || ['N', 'P', 'F'].includes(k) || e.key === 'ArrowRight' || e.key === 'ArrowLeft';
      // Stop a focused radio from also moving its own selection on arrow keys.
      if (handled) e.preventDefault();
      if (byNumber) choose(byNumber.id);
      else if (k === 'N' || e.key === 'ArrowRight') go(exam.current + 1);
      else if (k === 'P' || e.key === 'ArrowLeft') go(exam.current - 1);
      else if (k === 'F') toggleFlag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConfirming(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  if (!q) {
    return (
      <div className="page">
        <p>This exam refers to questions that no longer exist.</p>
        <button type="button" className="btn btn--secondary" onClick={() => setExam(undefined)}>
          Discard it
        </button>
      </div>
    );
  }

  const chosen = exam.answers[q.id] ?? [];
  const need = selectCount(q);
  const flagged = exam.flagged.includes(q.id);
  const timerState = remaining <= 5 * 60_000 ? 'critical' : remaining <= 10 * 60_000 ? 'warning' : '';
  const shown = questions.map((x, i) => ({ x, i })).filter(({ x }) => !onlyFlagged || exam.flagged.includes(x.id));

  return (
    <div className="page exam">
      <div className="exam__head">
        <div className={`timer-pill${timerState ? ` timer-pill--${timerState}` : ''}`} role="timer" aria-label="Time left">
          <Timer size={20} aria-hidden />
          <span className="timer-pill__time">{formatClock(remaining)}</span>
          <span className="timer-pill__caption">left of {course.exam.minutes}:00</span>
        </div>
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>
        <div className="exam__head-right">
          <span className="exam__pos">
            Question {exam.current + 1} / {questions.length}
          </span>
          <button type="button" className={`btn btn--secondary${flagged ? ' btn--flagged' : ''}`} aria-pressed={flagged} onClick={toggleFlag}>
            <Flag size={18} aria-hidden fill={flagged ? 'currentColor' : 'none'} /> Flag for review
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setConfirming(true)}>
            <Send size={18} aria-hidden /> Submit exam
          </button>
        </div>
      </div>

      <div className="exam__layout">
        <div className="question-card">
          <div className="question-card__meta">
            <span className="mono-label">
              Question {exam.current + 1} of {questions.length}
            </span>
            <span className="chip chip--neutral">Choose {WORDS[need] ?? need}</span>
          </div>
          <h2 className="question-card__stem">
            <InlineMarkdown markdown={q.question} />
          </h2>
          <fieldset className="options">
            <legend className="sr-only">{q.type === 'multi' ? `Choose ${need} answers` : 'Choose one answer'}</legend>
            {q.options.map((o) => {
              const selected = chosen.includes(o.id);
              return (
                <div key={o.id} className={`option option--${selected ? 'selected' : 'idle'}`}>
                  <label className="option__main">
                    <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={`exam-${q.id}`} checked={selected} onChange={() => choose(o.id)} />
                    <span className={`option__indicator option__indicator--${q.type === 'multi' ? 'box' : 'radio'}`} aria-hidden />
                    <span className="option__letter" aria-hidden>
                      {o.id}
                    </span>
                    <span className="option__text">
                      <InlineMarkdown markdown={o.text} />
                    </span>
                  </label>
                </div>
              );
            })}
          </fieldset>
          <div className="question-card__actions question-card__actions--split">
            <button type="button" className="btn btn--secondary" onClick={() => go(exam.current - 1)} aria-disabled={exam.current === 0}>
              <ArrowLeft size={18} aria-hidden /> Previous
            </button>
            <button type="button" className="btn btn--ghost" aria-pressed={flagged} onClick={toggleFlag}>
              <Flag size={18} aria-hidden fill={flagged ? 'currentColor' : 'none'} /> Flag for review
            </button>
            {exam.current < questions.length - 1 ? (
              <button type="button" className="btn btn--primary" onClick={() => go(exam.current + 1)}>
                Next <ArrowRight size={18} aria-hidden />
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => setConfirming(true)}>
                Review &amp; submit
              </button>
            )}
          </div>
        </div>

        <aside className="navigator" aria-label="Question navigator">
          <div className="navigator__head">
            <h4>Questions</h4>
            <span className="muted">
              {answered} of {questions.length} answered
            </span>
            <span className="progress-bar progress-bar--sm" aria-hidden>
              <span style={{ width: `${(answered / questions.length) * 100}%` }} />
            </span>
          </div>
          <ol className="navigator__grid">
            {shown.map(({ x, i }) => {
              const done = isAnswered(x);
              const isFlagged = exam.flagged.includes(x.id);
              const cls = ['navigator__cell', i === exam.current ? 'is-current' : isFlagged ? 'is-flagged' : done ? 'is-answered' : 'is-unanswered'].join(' ');
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    className={cls}
                    onClick={() => go(i)}
                    aria-label={`Question ${i + 1}, ${done ? 'answered' : 'unanswered'}${isFlagged ? ', flagged' : ''}`}
                    aria-current={i === exam.current ? 'step' : undefined}
                  >
                    {i + 1}
                    {isFlagged && <Flag size={11} strokeWidth={2.5} className="navigator__flag" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          <ul className="navigator__legend">
            <li>
              <span className="navigator__swatch is-answered" aria-hidden /> Answered <span className="mono">{answered}</span>
            </li>
            <li>
              <span className="navigator__swatch is-flagged" aria-hidden /> Flagged <span className="mono">{exam.flagged.length}</span>
            </li>
            <li>
              <span className="navigator__swatch is-current" aria-hidden /> Current <span className="mono">1</span>
            </li>
            <li>
              <span className="navigator__swatch is-unanswered" aria-hidden /> Unanswered <span className="mono">{unanswered}</span>
            </li>
          </ul>
          <button
            type="button"
            className="btn btn--secondary navigator__filter"
            aria-pressed={onlyFlagged}
            aria-disabled={!exam.flagged.length && !onlyFlagged}
            onClick={() => (exam.flagged.length || onlyFlagged) && setOnlyFlagged((f) => !f)}
          >
            <Flag size={18} aria-hidden /> {onlyFlagged ? 'Show all questions' : `Review flagged (${exam.flagged.length})`}
          </button>
        </aside>
      </div>

      {confirming && (
        <div className="modal-scrim" onClick={() => setConfirming(false)}>
          <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="submit-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2 id="submit-title">Submit the exam?</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setConfirming(false)}>
                <X size={20} aria-hidden />
              </button>
            </div>
            <p>
              {unanswered > 0 ? (
                <>
                  <strong>
                    {unanswered} question{unanswered === 1 ? ' is' : 's are'} unanswered
                  </strong>{' '}
                  and {exam.flagged.length} {exam.flagged.length === 1 ? 'is' : 'are'} flagged for review. Unanswered questions count as wrong.
                </>
              ) : (
                <>All {questions.length} questions are answered.</>
              )}{' '}
              You cannot change answers after you submit.
            </p>
            <div className="modal__tiles">
              <div className="summary-tile">
                <span>Answered</span>
                <strong>{answered}</strong>
              </div>
              <div className="summary-tile">
                <span>Flagged</span>
                <strong className="is-warning">{exam.flagged.length}</strong>
              </div>
              <div className="summary-tile">
                <span>Unanswered</span>
                <strong className="is-danger">{unanswered}</strong>
              </div>
              <div className="summary-tile">
                <span>Time left</span>
                <strong>{formatClock(remaining)}</strong>
              </div>
            </div>
            <div className="modal__actions">
              {exam.flagged.length > 0 && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    setOnlyFlagged(true);
                    setConfirming(false);
                    const first = questions.findIndex((x) => exam.flagged.includes(x.id));
                    if (first >= 0) go(first);
                  }}
                >
                  Review flagged ({exam.flagged.length})
                </button>
              )}
              <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)} autoFocus>
                Keep working
              </button>
              <button type="button" className="btn btn--primary" onClick={submit}>
                Submit exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
