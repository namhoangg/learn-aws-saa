import { useState, type RefObject } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, CircleQuestionMark, House, Layers, Target, Timer, X } from 'lucide-react';
import { course, sections } from '../content/load';
import { useProgress } from '../state/store';
import { overallProgress, sectionState, useCounts } from '../lib/progress';
import { MiniRing, ProgressDot } from './ProgressDot';
import { Logo } from './Logo';

const COLLAPSE_KEY = 'learnaws:collapsedParts';

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function Sidebar({ onNavigate, onClose, navRef }: { onNavigate: () => void; onClose: () => void; navRef?: RefObject<HTMLElement | null> }) {
  const progress = useProgress();
  const counts = useCounts();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const overall = overallProgress(progress, counts);
  const readCount = sections.filter((s) => progress.lessons[s.id]?.readAt).length;

  const toggle = (id: string, open: boolean) => {
    const next = { ...collapsed, [id]: !open };
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    } catch {
      // Not critical: the panel just won't remember its state.
    }
  };

  const weak = overall.weakQuestions + overall.weakCards;

  return (
    <nav ref={navRef} className="sidebar" aria-label="Course">
      <div className="sidebar__drawer-head">
        <span className="brand">
          <Logo size={26} />
          <span className="brand__name">SAA-C03 Study</span>
        </span>
        <button type="button" className="icon-btn" aria-label="Close navigation" onClick={onClose}>
          <X size={20} aria-hidden />
        </button>
      </div>
      <div className="sidebar__drawer-progress">
        <span>
          <strong>Course {Math.round(overall.completion * 100)}% complete</strong> · {readCount} of {sections.length} read
        </span>
        <span className="progress-bar progress-bar--sm" aria-hidden>
          <span style={{ width: `${overall.completion * 100}%` }} />
        </span>
      </div>

      <ul className="sidebar__primary">
        <li>
          <NavLink to="/" end className="sidebar__link" onClick={onNavigate}>
            <House size={20} strokeWidth={1.75} aria-hidden /> <span>Home</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/review" className="sidebar__link" onClick={onNavigate}>
            <Layers size={20} strokeWidth={1.75} aria-hidden /> <span>Review flashcards</span>
            {overall.cardsDue > 0 && <span className="count-pill" aria-label={`${overall.cardsDue} due`}>{overall.cardsDue}</span>}
          </NavLink>
        </li>
        <li>
          <NavLink to="/practice" className="sidebar__link" onClick={onNavigate}>
            <CircleQuestionMark size={20} strokeWidth={1.75} aria-hidden /> <span>Practice quiz</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/weak" className="sidebar__link" onClick={onNavigate}>
            <Target size={20} strokeWidth={1.75} aria-hidden /> <span>Weak areas</span>
            {weak > 0 && <span className="count-pill" aria-label={`${weak} weak items`}>{weak}</span>}
          </NavLink>
        </li>
        <li>
          <NavLink to="/exam" className="sidebar__link" onClick={onNavigate}>
            <Timer size={20} strokeWidth={1.75} aria-hidden /> <span>Exam simulation</span>
            {progress.exam && <span className="count-pill">live</span>}
          </NavLink>
        </li>
      </ul>

      <div className="sidebar__course-head">
        <span className="mono-label">Course</span>
        <span>
          {readCount} of {sections.length} read
        </span>
      </div>

      <div className="sidebar__parts">
        {course.parts.map((part, pi) => {
          const partSections = sections.filter((s) => s.partId === part.id);
          const read = partSections.filter((s) => progress.lessons[s.id]?.readAt).length;
          const containsActive = partSections.some((s) => pathname.startsWith(`/section/${s.id}`));
          const open = containsActive || !collapsed[part.id];
          return (
            <section key={part.id} className="sidebar__part">
              <button type="button" className="sidebar__part-head" aria-expanded={open} onClick={() => toggle(part.id, open)}>
                <ChevronDown size={16} strokeWidth={2} className="sidebar__chevron" aria-hidden />
                <span className="sidebar__part-text">
                  <span className="sidebar__part-num">Part {pi + 1}</span>
                  <span className="sidebar__part-title">{part.title}</span>
                </span>
                <span className="sidebar__part-count">
                  {read}/{partSections.length}
                </span>
                <MiniRing value={read / partSections.length} />
              </button>
              {open && (
                <ol className="sidebar__sections">
                  {partSections.map((s) => {
                    const title = s.meta?.title ?? s.id.replace(/^\d+-/, '').replace(/-/g, ' ');
                    const num = String(s.order).padStart(2, '0');
                    if (!s.meta) {
                      return (
                        <li key={s.id}>
                          <span className="sidebar__section sidebar__section--pending" title={`${title} (content not written yet)`}>
                            <ProgressDot state="not-started" pending />
                            <span className="sidebar__section-num">{num}</span>
                            <span className="sidebar__section-title">{title}</span>
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={s.id}>
                        <NavLink to={`/section/${s.id}`} className="sidebar__section" onClick={onNavigate} title={title}>
                          <ProgressDot state={sectionState(s.id, progress)} />
                          <span className="sidebar__section-num">{num}</span>
                          <span className="sidebar__section-title">{title}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      <div className="sidebar__foot">
        <NavLink to="/settings" className="sidebar__link sidebar__link--quiet" onClick={onNavigate}>
          <span>Progress &amp; settings</span>
        </NavLink>
      </div>
    </nav>
  );
}
