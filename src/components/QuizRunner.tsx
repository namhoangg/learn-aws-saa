import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CircleQuestionMark, ListChecks, RotateCcw, SignalHigh, SignalLow, SignalMedium, X } from 'lucide-react';
import { recordAnswer, saveAttempt, useProgress, type AttemptAnswer, type QuizMode } from '../state/store';
import { correctIds, isCorrect, selectCount, type Question } from '../lib/quiz';
import { course, sectionTitle } from '../content/load';
import type { Difficulty } from '../content/types';
import { InlineMarkdown } from './Markdown';
import { BadgeNote } from './Badge';
import { isTyping } from './Layout';

const MODE_LABEL: Record<QuizMode, string> = {
  section: 'Section quiz',
  mixed: 'Mixed review',
  weak: 'Weak areas',
  exam: 'Exam',
};
const DIFFICULTY_ICON: Record<Difficulty, typeof SignalLow> = { easy: SignalLow, medium: SignalMedium, hard: SignalHigh };
const WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR'];

export function domainTitle(id: string): string {
  return course.exam.domains.find((d) => d.id === id)?.title ?? id;
}

interface Props {
  questions: Question[];
  mode: QuizMode;
  sectionIds: string[];
  title: string;
  startQuestionId?: string;
  showSection?: boolean;
}

/** Practice quiz: answer, check, read every option's explanation, move on. */
export function QuizRunner({ questions: initial, mode, sectionIds, title, startQuestionId, showSection }: Props) {
  const progress = useProgress();
  const shortcuts = progress.settings.shortcuts !== false;
  const ordered = useMemo(() => {
    if (!startQuestionId) return initial;
    const first = initial.find((q) => q.id === startQuestionId);
    return first ? [first, ...initial.filter((q) => q.id !== startQuestionId)] : initial;
  }, [initial, startQuestionId]);
  const [questions, setQuestions] = useState(ordered);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [overLimit, setOverLimit] = useState(false);
  const [checked, setChecked] = useState(false);
  const [answers, setAnswers] = useState<AttemptAnswer[]>([]);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [finished, setFinished] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const q = questions[index];
  const need = q ? selectCount(q) : 1;
  const score = answers.filter((a) => a.correct).length;

  const restart = (qs: Question[]) => {
    setQuestions(qs);
    setIndex(0);
    setChosen([]);
    setChecked(false);
    setAnswers([]);
    setFinished(false);
    setStartedAt(new Date().toISOString());
  };

  const toggle = (optId: string) => {
    if (checked || !q) return;
    if (q.type === 'single') {
      setChosen([optId]);
      return;
    }
    setChosen((c) => {
      if (c.includes(optId)) {
        setOverLimit(false);
        return c.filter((x) => x !== optId);
      }
      if (c.length >= need) {
        setOverLimit(true);
        return c;
      }
      return [...c, optId];
    });
  };

  const check = () => {
    if (!q || chosen.length !== need || checked) return;
    const ok = isCorrect(q, chosen);
    recordAnswer(q.id, ok);
    setAnswers((a) => [...a, { questionId: q.id, sectionId: q.sectionId, chosen, correct: ok }]);
    setChecked(true);
    setOverLimit(false);
  };

  const next = () => {
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setChosen([]);
      setChecked(false);
      headingRef.current?.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const finishedAt = new Date();
      saveAttempt({
        id: `${mode}-${finishedAt.getTime()}`,
        mode,
        sectionIds,
        startedAt,
        finishedAt: finishedAt.toISOString(),
        total: answers.length,
        correct: answers.filter((a) => a.correct).length,
        durationSec: Math.round((finishedAt.getTime() - new Date(startedAt).getTime()) / 1000),
        answers,
      });
      setFinished(true);
    }
  };

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || !q || finished) return;
      const k = e.key.toUpperCase();
      const byLetter = q.options.find((o) => o.id === k);
      const byNumber = /^[1-6]$/.test(k) ? q.options[Number(k) - 1] : undefined;
      if (byLetter || byNumber) {
        e.preventDefault();
        toggle((byLetter ?? byNumber)!.id);
      } else if (e.key === 'Enter') {
        const tag = document.activeElement?.tagName;
        if (tag === 'BUTTON' || tag === 'A') return;
        e.preventDefault();
        if (checked) next();
        else check();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!questions.length) {
    return (
      <div className="empty-state">
        <h2>No questions here yet</h2>
      </div>
    );
  }

  if (finished) {
    const wrong = answers
      .filter((a) => !a.correct)
      .map((a) => questions.find((x) => x.id === a.questionId)!)
      .filter(Boolean);
    const pct = answers.length ? Math.round((score / answers.length) * 100) : 0;
    const pass = pct >= 72;
    return (
      <div className="quiz-result">
        <p className="mono-label">{title}</p>
        <div className="quiz-result__score">
          <strong className={pass ? 'is-pass' : 'is-fail'}>{pct}%</strong>
          <span>
            {score} of {answers.length} correct
          </span>
          <span className={`chip ${pass ? 'chip--free' : 'chip--notfree'}`}>
            {pass ? <Check size={14} strokeWidth={2} aria-hidden /> : <X size={14} strokeWidth={2} aria-hidden />}
            {pass ? 'Above the pass line' : 'Below the pass line'}
          </span>
        </div>
        <p className="muted">{pass ? 'Above the ~72% the real exam needs.' : 'Below the ~72% the real exam needs; read the traps again and retry the ones you missed.'}</p>
        <div className="button-row">
          {wrong.length > 0 && (
            <button type="button" className="btn btn--primary" onClick={() => restart(wrong)}>
              <RotateCcw size={18} aria-hidden /> Retry the {wrong.length} I missed
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={() => restart(ordered)}>
            Retake all
          </button>
          <Link className="btn btn--ghost" to="/weak">
            Weak areas
          </Link>
        </div>
        <ol className="quiz-result__list">
          {answers.map((a) => {
            const qq = questions.find((x) => x.id === a.questionId);
            if (!qq) return null;
            return (
              <li key={a.questionId} className={a.correct ? 'is-correct' : 'is-wrong'}>
                {a.correct ? <Check size={16} strokeWidth={2.5} aria-label="Correct" /> : <X size={16} strokeWidth={2.5} aria-label="Wrong" />}
                <span>{qq.question.length > 160 ? `${qq.question.slice(0, 160)}…` : qq.question}</span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  const correctSet = new Set(correctIds(q));
  const wasRight = checked && isCorrect(q, chosen);
  const DiffIcon = DIFFICULTY_ICON[q.difficulty] ?? SignalMedium;
  const rightLetters = [...correctSet].join(' and ');

  return (
    <div className="quiz">
      <div className="quiz__bar">
        <span className="quiz__pos">
          Question {index + 1} / {questions.length}
        </span>
        <span className="progress-bar" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index}>
          <span style={{ width: `${(index / questions.length) * 100}%` }} />
        </span>
        <span className="quiz__score">
          Score <strong>
            {score} / {answers.length}
          </strong>{' '}
          correct
        </span>
        <span className="chip chip--neutral">
          <CircleQuestionMark size={14} strokeWidth={2} aria-hidden /> {MODE_LABEL[mode]}
        </span>
      </div>

      <div className="question-card">
        <div className="question-card__meta">
          <span className="chip chip--accent">{domainTitle(q.domain)}</span>
          <span className="chip chip--neutral">
            <DiffIcon size={14} strokeWidth={2} aria-hidden /> {q.difficulty[0].toUpperCase() + q.difficulty.slice(1)}
          </span>
          {showSection && <span className="chip chip--neutral chip--wrap">{sectionTitle(q.sectionId)}</span>}
        </div>
        <h2 className="question-card__stem" tabIndex={-1} ref={headingRef}>
          <InlineMarkdown markdown={q.question} />
        </h2>
        {q.updated && <BadgeNote kind="updated" note={q.updated} />}
        {q.verify && <BadgeNote kind="verify" note={q.verify} />}

        {q.type === 'multi' && (
          <p className="question-card__multi">
            <span className="chip chip--accent">
              <ListChecks size={14} strokeWidth={2} aria-hidden /> Choose {WORDS[need] ?? need}
            </span>
          </p>
        )}

        {checked && (
          <div className={`result-banner ${wasRight ? 'result-banner--right' : 'result-banner--wrong'}`} role="status">
            {wasRight ? <Check size={20} strokeWidth={2.5} aria-hidden /> : <X size={20} strokeWidth={2.5} aria-hidden />}
            <span>
              {wasRight ? (
                <>
                  <strong>Correct.</strong> Read why each option is right or wrong.
                </>
              ) : (
                <>
                  <strong>Not quite.</strong> The correct answer is <strong>{rightLetters}</strong>. Read why each option is right or wrong.
                </>
              )}
            </span>
          </div>
        )}

        <fieldset className="options">
          <legend className="sr-only">{q.type === 'multi' ? `Choose ${need} answers` : 'Choose one answer'}</legend>
          {q.options.map((o) => {
            const selected = chosen.includes(o.id);
            const isRight = correctSet.has(o.id);
            const state = !checked ? (selected ? 'selected' : 'idle') : isRight ? 'correct' : selected ? 'incorrect' : 'disabled';
            return (
              <div key={o.id} className={`option option--${state}`}>
                <label className="option__main">
                  <input
                    type={q.type === 'multi' ? 'checkbox' : 'radio'}
                    name={`q-${q.id}`}
                    checked={selected}
                    aria-disabled={checked}
                    onChange={() => toggle(o.id)}
                  />
                  <span className={`option__indicator option__indicator--${q.type === 'multi' ? 'box' : 'radio'}`} aria-hidden>
                    {checked && isRight && <Check size={16} strokeWidth={3} />}
                    {checked && !isRight && selected && <X size={16} strokeWidth={3} />}
                    {!checked && selected && q.type === 'multi' && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className="option__letter" aria-hidden>
                    {o.id}
                  </span>
                  <span className="option__text">
                    <InlineMarkdown markdown={o.text} />
                  </span>
                  {checked && isRight && (
                    <span className="chip chip--free option__chip">
                      <Check size={14} strokeWidth={2} aria-hidden /> {selected ? 'Your answer · correct' : 'Correct answer'}
                    </span>
                  )}
                  {checked && !isRight && selected && (
                    <span className="chip chip--notfree option__chip">
                      <X size={14} strokeWidth={2} aria-hidden /> Your answer
                    </span>
                  )}
                </label>
                {checked && (
                  <div className={`option__why${isRight ? ' option__why--right' : selected ? ' option__why--wrong' : ''}`}>
                    <span className="option__why-label">{isRight ? "Why it's right" : "Why it's wrong"}</span>
                    <InlineMarkdown markdown={o.explanation} />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>

        {checked && (
          <div className="takeaway">
            <span className="mono-label">Takeaway</span>
            <InlineMarkdown markdown={q.explanation} />
          </div>
        )}

        <div className="question-card__actions">
          {q.type === 'multi' && !checked && (
            <span className={`question-card__count${overLimit ? ' is-over' : ''}`} aria-live="polite">
              {overLimit ? `Choose only ${need}` : `${chosen.length} of ${need} selected`}
            </span>
          )}
          <span className="question-card__keys">A–{q.options[q.options.length - 1].id} or 1–{q.options.length} to choose</span>
          {!checked ? (
            <button type="button" className="btn btn--primary" onClick={check} aria-disabled={chosen.length !== need}>
              Check answer <kbd className="kbd kbd--inverse">Enter</kbd>
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={next}>
              {index + 1 < questions.length ? 'Next question' : 'See results'} <ArrowRight size={18} aria-hidden />
              <kbd className="kbd kbd--inverse">Enter</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
