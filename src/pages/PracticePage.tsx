import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Target, Timer } from 'lucide-react';
import { course, loadAllQuestions, sections } from '../content/load';
import type { Domain } from '../content/types';
import { useProgress } from '../state/store';
import { DOMAIN_LABEL, shuffle, type Question } from '../lib/quiz';
import { QuizRunner } from '../components/QuizRunner';
import { Segmented } from '../components/Segmented';

const SIZES = [10, 20, 30, 50];
type Filter = 'all' | 'unseen' | 'missed';

/** Mixed review: pick sections, a size and a filter, then practise with instant feedback. */
export function PracticePage() {
  const progress = useProgress();
  const [pool, setPool] = useState<Question[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [size, setSize] = useState(20);
  const [domain, setDomain] = useState<Domain | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [run, setRun] = useState<{ questions: Question[]; key: number } | null>(null);

  useEffect(() => {
    loadAllQuestions().then((qs) => {
      setPool(qs);
      setPicked(new Set(qs.map((q) => q.sectionId)));
    });
  }, []);

  const bySection = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of pool ?? []) m.set(q.sectionId, (m.get(q.sectionId) ?? 0) + 1);
    return m;
  }, [pool]);

  const candidates = useMemo(() => {
    return (pool ?? []).filter((q) => {
      if (!picked.has(q.sectionId)) return false;
      if (domain !== 'all' && q.domain !== domain) return false;
      const st = progress.questions[q.id];
      if (filter === 'unseen') return !st;
      if (filter === 'missed') return !!st && st.wrong > 0;
      return true;
    });
  }, [pool, picked, domain, filter, progress.questions]);

  if (run) {
    return (
      <div className="page">
        <header className="page-head page-head--compact">
          <p className="eyebrow">Mixed review</p>
          <h1>Practice quiz</h1>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRun(null)}>
            Change settings
          </button>
        </header>
        <QuizRunner key={run.key} questions={run.questions} mode="mixed" sectionIds={[...new Set(run.questions.map((q) => q.sectionId))]} title="Mixed review" showSection />
      </div>
    );
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="page practice">
      <header className="page-head">
        <p className="eyebrow">Quiz modes</p>
        <h1>Practice</h1>
        <p className="muted">Mix questions from any sections with instant feedback, or switch to the timed exam simulation.</p>
      </header>

      <div className="mode-cards">
        <div className="mode-card mode-card--active">
          <ClipboardCheck size={22} aria-hidden />
          <h2>Mixed review</h2>
          <p>Random questions from the sections you choose, explained as you go.</p>
        </div>
        <Link to="/exam" className="mode-card">
          <Timer size={22} aria-hidden />
          <h2>Exam simulation</h2>
          <p>
            {course.exam.questions} questions, {course.exam.minutes} minutes, scored out of {course.exam.maxScore} like the real exam.
          </p>
        </Link>
        <Link to="/weak" className="mode-card">
          <Target size={22} aria-hidden />
          <h2>Weak areas</h2>
          <p>Only the questions and cards you keep getting wrong.</p>
        </Link>
      </div>

      {!pool ? (
        <p className="muted">Loading questions…</p>
      ) : (
        <div className="practice__setup card">
          <div className="practice__row">
            <span className="field-label">Questions</span>
            <Segmented<number> label="Number of questions" value={size} onChange={setSize} options={SIZES.map((n) => ({ value: n, label: n }))} />
          </div>
          <div className="practice__row">
            <span className="field-label">Domain</span>
            <Segmented<Domain | 'all'>
              label="Exam domain"
              value={domain}
              onChange={setDomain}
              options={[{ value: 'all', label: 'All' }, ...(Object.keys(DOMAIN_LABEL) as Domain[]).map((d) => ({ value: d, label: DOMAIN_LABEL[d] }))]}
            />
          </div>
          <div className="practice__row">
            <span className="field-label">Include</span>
            <Segmented<Filter>
              label="Question filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All questions' },
                { value: 'unseen', label: 'Not seen yet' },
                { value: 'missed', label: 'Missed before' },
              ]}
            />
          </div>

          <fieldset className="practice__sections">
            <legend className="field-label">
              Sections{' '}
              <button type="button" className="link-btn" onClick={() => setPicked(new Set(bySection.keys()))}>
                all
              </button>{' '}
              ·{' '}
              <button type="button" className="link-btn" onClick={() => setPicked(new Set())}>
                none
              </button>
            </legend>
            {course.parts.map((part) => {
              const list = sections.filter((s) => s.partId === part.id && bySection.has(s.id));
              if (!list.length) return null;
              return (
                <div key={part.id} className="practice__part">
                  <p className="practice__part-title">{part.title}</p>
                  {list.map((s) => (
                    <label key={s.id} className="check">
                      <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                      <span>
                        {s.order}. {s.meta?.title} <span className="muted">({bySection.get(s.id)})</span>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
          </fieldset>

          <div className="practice__start">
            <span className="muted">{candidates.length} questions match.</span>
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!candidates.length}
              onClick={() => setRun({ questions: shuffle(candidates).slice(0, size), key: Date.now() })}
            >
              Start {Math.min(size, candidates.length)} questions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
