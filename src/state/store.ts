// All learner progress lives in one localStorage entry so it can be exported and imported
// as a single JSON file. Components read it through useProgress() and change it through
// the update functions below, which persist and notify subscribers.
import { useSyncExternalStore } from 'react';
import type { SrsCard } from '../lib/srs';

export const STORAGE_KEY = 'learnaws:v1';

export type Theme = 'light' | 'dark' | 'system';
export type QuizMode = 'section' | 'mixed' | 'exam' | 'weak';

export interface QuestionStats {
  seen: number;
  correct: number;
  wrong: number;
  /** Consecutive correct answers; reset by a wrong answer. */
  streak: number;
  lastAnsweredAt?: string;
  lastWrongAt?: string;
}

export interface AttemptAnswer {
  questionId: string;
  sectionId: string;
  chosen: string[];
  correct: boolean;
}

export interface QuizAttempt {
  id: string;
  mode: QuizMode;
  sectionIds: string[];
  startedAt: string;
  finishedAt: string;
  total: number;
  correct: number;
  /** Exam simulation only: approximate scaled score out of 1000. */
  scaled?: number;
  durationSec: number;
  answers: AttemptAnswer[];
}

export interface ExamSession {
  id: string;
  questionIds: string[];
  answers: Record<string, string[]>;
  flagged: string[];
  current: number;
  startedAt: string;
  /** Wall-clock deadline in ms since epoch. */
  deadline: number;
}

export interface LabState {
  checked: Record<string, boolean>;
  completedAt?: string;
  /** Not-Free-Tier labs: the learner confirmed they understand the cost. */
  costAcknowledgedAt?: string;
}

export interface ProgressState {
  version: 1;
  lessons: Record<string, { readAt?: string; lastVisitedAt?: string }>;
  questions: Record<string, QuestionStats>;
  attempts: QuizAttempt[];
  cards: Record<string, SrsCard>;
  labs: Record<string, LabState>;
  exam?: ExamSession;
  lastLocation?: { path: string; label: string; at: string };
  settings: {
    theme: Theme;
    /** Single-key shortcuts (/, 1, 2, A–F, F, N, P); Ctrl/Cmd+K always works. */
    shortcuts?: boolean;
    /** Preferred lab instruction format, applied to every lab. */
    labMode?: 'console' | 'cli';
  };
}

const empty = (): ProgressState => ({
  version: 1,
  lessons: {},
  questions: {},
  attempts: [],
  cards: {},
  labs: {},
  settings: { theme: 'system', shortcuts: true, labMode: 'console' },
});

function read(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    return normalize(JSON.parse(raw));
  } catch {
    return empty();
  }
}

/** Fills in fields missing from older or hand-edited files. */
function normalize(value: unknown): ProgressState {
  const base = empty();
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<ProgressState>;
  return {
    ...base,
    ...v,
    version: 1,
    lessons: v.lessons ?? {},
    questions: v.questions ?? {},
    attempts: Array.isArray(v.attempts) ? v.attempts : [],
    cards: v.cards ?? {},
    labs: v.labs ?? {},
    settings: { ...base.settings, ...(v.settings ?? {}) },
  };
}

let state: ProgressState = read();
const listeners = new Set<() => void>();

function commit(next: ProgressState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: keep working in memory for this session.
  }
  listeners.forEach((l) => l());
}

export function update(fn: (draft: ProgressState) => ProgressState) {
  commit(fn(state));
}

export function getProgress(): ProgressState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab changed progress: pick it up so both stay in sync.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    state = read();
    listeners.forEach((l) => l());
  }
});

export function useProgress(): ProgressState {
  return useSyncExternalStore(subscribe, getProgress);
}

const now = () => new Date().toISOString();

export function markLessonRead(sectionId: string, read = true) {
  update((s) => ({
    ...s,
    lessons: { ...s.lessons, [sectionId]: { ...s.lessons[sectionId], readAt: read ? now() : undefined } },
  }));
}

export function visitLesson(sectionId: string, path: string, label: string) {
  update((s) => ({
    ...s,
    lessons: { ...s.lessons, [sectionId]: { ...s.lessons[sectionId], lastVisitedAt: now() } },
    lastLocation: { path, label, at: now() },
  }));
}

export function setLastLocation(path: string, label: string) {
  update((s) => ({ ...s, lastLocation: { path, label, at: now() } }));
}

/** Records one answered question in the per-question stats used by weak areas. */
export function recordAnswer(questionId: string, correct: boolean) {
  update((s) => {
    const prev = s.questions[questionId] ?? { seen: 0, correct: 0, wrong: 0, streak: 0 };
    const at = now();
    const next: QuestionStats = {
      seen: prev.seen + 1,
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      streak: correct ? prev.streak + 1 : 0,
      lastAnsweredAt: at,
      lastWrongAt: correct ? prev.lastWrongAt : at,
    };
    return { ...s, questions: { ...s.questions, [questionId]: next } };
  });
}

export function saveAttempt(attempt: QuizAttempt) {
  // Keep the newest 300 attempts so storage stays small.
  update((s) => ({ ...s, attempts: [...s.attempts, attempt].slice(-300) }));
}

export function setCard(cardId: string, card: SrsCard) {
  update((s) => ({ ...s, cards: { ...s.cards, [cardId]: card } }));
}

export function setLabItem(labId: string, key: string, checked: boolean) {
  update((s) => {
    const lab = s.labs[labId] ?? { checked: {} };
    return { ...s, labs: { ...s.labs, [labId]: { ...lab, checked: { ...lab.checked, [key]: checked } } } };
  });
}

export function setLabComplete(labId: string, complete: boolean) {
  update((s) => {
    const lab = s.labs[labId] ?? { checked: {} };
    return { ...s, labs: { ...s.labs, [labId]: { ...lab, completedAt: complete ? now() : undefined } } };
  });
}

export function setExam(exam: ExamSession | undefined) {
  update((s) => ({ ...s, exam }));
}

export function setTheme(theme: Theme) {
  update((s) => ({ ...s, settings: { ...s.settings, theme } }));
}

export function setSetting<K extends keyof ProgressState['settings']>(key: K, value: ProgressState['settings'][K]) {
  update((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
}

export function acknowledgeLabCost(labId: string) {
  update((s) => {
    const lab = s.labs[labId] ?? { checked: {} };
    return { ...s, labs: { ...s.labs, [labId]: { ...lab, costAcknowledgedAt: now() } } };
  });
}

export function exportProgress(): string {
  return JSON.stringify(state, null, 1);
}

export function importProgress(json: string) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) throw new Error('Not a progress file from this site.');
  commit(normalize(parsed));
}

export function resetProgress() {
  commit({ ...empty(), settings: state.settings });
}
