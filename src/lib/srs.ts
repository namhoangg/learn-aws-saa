// Two-button spaced repetition. "Easy" grows the interval by the card's ease factor;
// "Hard" brings the card back in 10 minutes (and later in the same session) and lowers its
// ease, so hard cards return sooner and grow more slowly afterwards.

export type Rating = 'easy' | 'hard';

export interface SrsCard {
  /** ISO time the card is next due. */
  due: string;
  /** Current interval in days (0 while relearning). */
  interval: number;
  ease: number;
  reps: number;
  easyCount: number;
  hardCount: number;
  lastRating: Rating;
  lastReviewedAt: string;
}

const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
const START_EASE = 2.5;
const HARD_DELAY_MIN = 10;
const DAY_MS = 86_400_000;
/** A card rated Hard comes back after this many other cards in the same session. */
export const HARD_REQUEUE_GAP = 3;

export function schedule(card: SrsCard | undefined, rating: Rating, now = new Date()): SrsCard {
  const prev = card ?? { interval: 0, ease: START_EASE, reps: 0, easyCount: 0, hardCount: 0 };
  if (rating === 'hard') {
    return {
      due: new Date(now.getTime() + HARD_DELAY_MIN * 60_000).toISOString(),
      interval: 0,
      ease: Math.max(MIN_EASE, prev.ease - 0.2),
      reps: prev.reps + 1,
      easyCount: prev.easyCount,
      hardCount: prev.hardCount + 1,
      lastRating: 'hard',
      lastReviewedAt: now.toISOString(),
    };
  }
  let interval: number;
  if (prev.interval < 1) interval = prev.reps === 0 ? 2 : 1;
  else if (prev.interval < 3) interval = 4;
  else interval = Math.round(prev.interval * prev.ease);
  interval = Math.min(interval, 365);
  return {
    due: new Date(now.getTime() + interval * DAY_MS).toISOString(),
    interval,
    ease: Math.min(MAX_EASE, prev.ease + 0.05),
    reps: prev.reps + 1,
    easyCount: prev.easyCount + 1,
    hardCount: prev.hardCount,
    lastRating: 'easy',
    lastReviewedAt: now.toISOString(),
  };
}

export type CardStatus = 'new' | 'due' | 'learning' | 'learned';

/** One Easy is enough: a card is learned while its last rating is Easy, due for review or not. */
export function isLearned(card: SrsCard | undefined): boolean {
  return card?.lastRating === 'easy';
}

export function cardStatus(card: SrsCard | undefined, now = new Date()): CardStatus {
  if (!card) return 'new';
  if (new Date(card.due) <= now) return 'due';
  return isLearned(card) ? 'learned' : 'learning';
}

/** Cards the learner keeps finding hard: rated Hard at least twice and not yet mastered. */
export function isWeakCard(card: SrsCard | undefined): boolean {
  if (!card) return false;
  return card.hardCount >= 2 && (card.lastRating === 'hard' || card.hardCount > card.easyCount);
}

export function describeInterval(card: SrsCard | undefined, rating: Rating): string {
  const next = schedule(card, rating);
  if (next.interval === 0) return `${HARD_DELAY_MIN} min`;
  return next.interval === 1 ? '1 day' : `${next.interval} days`;
}
