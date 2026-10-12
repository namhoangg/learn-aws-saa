import type { Course, Domain, QuizQuestion, WithSection } from '../content/types';
import type { QuestionStats, QuizSession } from '../state/store';

export type Question = WithSection<QuizQuestion>;

export function correctIds(q: QuizQuestion): string[] {
  return q.options.filter((o) => o.correct).map((o) => o.id);
}

export function isCorrect(q: QuizQuestion, chosen: string[]): boolean {
  const want = correctIds(q);
  return chosen.length === want.length && want.every((id) => chosen.includes(id));
}

export function selectCount(q: QuizQuestion): number {
  return q.type === 'multi' ? correctIds(q).length : 1;
}

/** A saved quiz's questions in order, or null when content changed and one no longer exists. */
export function sessionQuestions(session: QuizSession, pool: Question[]): Question[] | null {
  // Imported files are only checked at the top level, so treat a malformed session as absent.
  const wellFormed =
    Array.isArray(session.questionIds) &&
    Number.isInteger(session.index) &&
    Array.isArray(session.chosen) &&
    Array.isArray(session.answers) &&
    session.answers.every((a) => Array.isArray(a?.chosen));
  if (!wellFormed) return null;
  const byId = new Map(pool.map((q) => [q.id, q]));
  const qs = session.questionIds.map((id) => byId.get(id));
  if (!qs.length || session.index >= qs.length || qs.some((q) => !q)) return null;
  return qs as Question[];
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A question the learner has missed and not yet answered right twice in a row. */
export function isWeakQuestion(stats: QuestionStats | undefined): boolean {
  return !!stats && stats.wrong > 0 && stats.streak < 2;
}

export function weakScore(stats: QuestionStats): number {
  return stats.wrong * 2 - stats.correct - stats.streak;
}

/**
 * Picks exam questions in proportion to the SAA-C03 domain weights, favouring questions
 * the learner has seen least, and fills any domain shortfall from the other domains.
 */
export function buildExam(pool: Question[], course: Course, stats: Record<string, QuestionStats>): Question[] {
  const total = Math.min(course.exam.questions, pool.length);
  const bySeen = (qs: Question[]) => shuffle(qs).sort((a, b) => (stats[a.id]?.seen ?? 0) - (stats[b.id]?.seen ?? 0));
  const picked: Question[] = [];
  const used = new Set<string>();
  const weights = course.exam.domains;
  const sumW = weights.reduce((n, d) => n + d.weight, 0);
  for (const d of weights) {
    const want = Math.round((d.weight / sumW) * total);
    for (const q of bySeen(pool.filter((q) => q.domain === d.id)).slice(0, want)) {
      picked.push(q);
      used.add(q.id);
    }
  }
  for (const q of bySeen(pool.filter((q) => !used.has(q.id)))) {
    if (picked.length >= total) break;
    picked.push(q);
  }
  return shuffle(picked.slice(0, total));
}

/**
 * AWS reports a scaled score from 100 to 1000 and does not publish the conversion; a linear
 * map of the raw percentage is a reasonable stand-in for practice.
 */
export function scaledScore(correct: number, total: number, course: Course): number {
  if (!total) return 100;
  return Math.round(100 + (course.exam.maxScore - 100) * (correct / total));
}

export function domainBreakdown(questions: Question[], answers: Record<string, string[]>) {
  const out: Record<Domain, { total: number; correct: number }> = {
    secure: { total: 0, correct: 0 },
    resilient: { total: 0, correct: 0 },
    performant: { total: 0, correct: 0 },
    cost: { total: 0, correct: 0 },
  };
  for (const q of questions) {
    const d = out[q.domain];
    if (!d) continue;
    d.total++;
    if (isCorrect(q, answers[q.id] ?? [])) d.correct++;
  }
  return out;
}

export function sectionBreakdown(questions: Question[], answers: Record<string, string[]>) {
  const out = new Map<string, { total: number; correct: number }>();
  for (const q of questions) {
    const s = out.get(q.sectionId) ?? { total: 0, correct: 0 };
    s.total++;
    if (isCorrect(q, answers[q.id] ?? [])) s.correct++;
    out.set(q.sectionId, s);
  }
  return out;
}

export const DOMAIN_LABEL: Record<Domain, string> = {
  secure: 'Secure',
  resilient: 'Resilient',
  performant: 'High-performing',
  cost: 'Cost-optimized',
};

/** MM:SS with minutes allowed past 60 ("129:59"), as the exam timer shows it. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
