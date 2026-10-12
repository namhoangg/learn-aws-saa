// Derived progress numbers for the sidebar, dashboard and section headers.
import { useEffect, useState } from 'react';
import { availableSections, loadCounts, sections } from '../content/load';
import type { ProgressState } from '../state/store';
import { cardStatus, isWeakCard } from './srs';
import { isWeakQuestion } from './quiz';

export type Counts = Record<string, { cards: number; questions: number; labs: number }>;

let countsPromise: Promise<Counts> | null = null;

/** Per-section totals of cards, questions and labs (loaded once). */
export function useCounts(): Counts | null {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    countsPromise ??= loadCounts();
    let alive = true;
    countsPromise.then((c) => alive && setCounts(c));
    return () => {
      alive = false;
    };
  }, []);
  return counts;
}

const sectionOfCard = (cardId: string) => cardId.replace(/-fc-\d+$/, '');
const sectionOfQuestion = (qid: string) => qid.replace(/-q\d+$/, '');

export interface SectionProgress {
  read: boolean;
  /** Best per-section quiz score, 0–1, or null when never attempted. */
  bestQuiz: number | null;
  cardsTotal: number;
  /** Cards last rated Easy. */
  cardsKnown: number;
  labsTotal: number;
  labsDone: number;
  /** Weighted completion, 0–1: lesson 40 %, quiz 30 %, flashcards 30 %. */
  completion: number;
}

export function sectionProgress(id: string, p: ProgressState, counts: Counts | null): SectionProgress {
  const c = counts?.[id] ?? { cards: 0, questions: 0, labs: 0 };
  const read = !!p.lessons[id]?.readAt;
  const quizAttempts = p.attempts.filter((a) => a.mode === 'section' && !a.retry && a.sectionIds.length === 1 && a.sectionIds[0] === id && a.total > 0);
  const bestQuiz = quizAttempts.length ? Math.max(...quizAttempts.map((a) => a.correct / a.total)) : null;
  let cardsKnown = 0;
  for (const [cid, card] of Object.entries(p.cards)) if (sectionOfCard(cid) === id && card.lastRating === 'easy') cardsKnown++;
  cardsKnown = Math.min(cardsKnown, c.cards || cardsKnown);
  const labsDone = Object.entries(p.labs).filter(([lid, l]) => lid.startsWith(`${id}-lab-`) && l.completedAt).length;
  const cardPart = c.cards ? cardsKnown / c.cards : 0;
  const completion = (read ? 0.4 : 0) + 0.3 * (bestQuiz ?? 0) + 0.3 * cardPart;
  return { read, bestQuiz, cardsTotal: c.cards, cardsKnown, labsTotal: c.labs, labsDone, completion };
}

export interface Overall {
  completion: number;
  lessonsRead: number;
  sectionsAvailable: number;
  sectionsTotal: number;
  cardsDue: number;
  cardsNew: number;
  cardsLearned: number;
  cardsTotal: number;
  avgQuiz: number | null;
  quizAttempts: number;
  labsDone: number;
  labsTotal: number;
  bestExam: number | null;
  examAttempts: number;
  weakQuestions: number;
  weakCards: number;
}

export function overallProgress(p: ProgressState, counts: Counts | null): Overall {
  const now = new Date();
  let completion = 0;
  let lessonsRead = 0;
  let labsDone = 0;
  let labsTotal = 0;
  let cardsTotal = 0;
  for (const s of sections) {
    const sp = sectionProgress(s.id, p, counts);
    completion += sp.completion;
    if (sp.read) lessonsRead++;
    labsDone += sp.labsDone;
    labsTotal += sp.labsTotal;
    cardsTotal += sp.cardsTotal;
  }
  let cardsDue = 0;
  let cardsLearned = 0;
  let weakCards = 0;
  let seenCards = 0;
  for (const card of Object.values(p.cards)) {
    seenCards++;
    const st = cardStatus(card, now);
    if (st === 'due') cardsDue++;
    if (st === 'learned') cardsLearned++;
    if (isWeakCard(card)) weakCards++;
  }
  const practice = p.attempts.filter((a) => a.mode !== 'exam' && a.total > 0);
  const exams = p.attempts.filter((a) => a.mode === 'exam');
  return {
    completion: completion / sections.length,
    lessonsRead,
    sectionsAvailable: availableSections.length,
    sectionsTotal: sections.length,
    cardsDue,
    cardsNew: Math.max(0, cardsTotal - seenCards),
    cardsLearned,
    cardsTotal,
    avgQuiz: practice.length ? practice.reduce((n, a) => n + a.correct / a.total, 0) / practice.length : null,
    quizAttempts: practice.length,
    labsDone,
    labsTotal,
    bestExam: exams.length ? Math.max(...exams.map((a) => a.scaled ?? 0)) : null,
    examAttempts: exams.length,
    weakQuestions: Object.entries(p.questions).filter(([, s]) => isWeakQuestion(s)).length,
    weakCards,
  };
}

export type SectionState = 'done' | 'in-progress' | 'not-started';

/**
 * Sidebar state (DESIGN_SPEC §6): done once "Mark as read" was pressed; in progress after the
 * section was opened or any of its cards, questions or labs was used.
 */
export function sectionState(id: string, p: ProgressState): SectionState {
  if (p.lessons[id]?.readAt) return 'done';
  if (p.lessons[id]?.lastVisitedAt) return 'in-progress';
  if (Object.keys(p.cards).some((c) => sectionOfCard(c) === id)) return 'in-progress';
  if (Object.keys(p.questions).some((q) => sectionOfQuestion(q) === id)) return 'in-progress';
  if (Object.keys(p.labs).some((l) => l.startsWith(`${id}-lab-`))) return 'in-progress';
  return 'not-started';
}
