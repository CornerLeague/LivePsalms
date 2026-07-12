// src/notepad/study/memorize/mastery.ts
// Per-card mastery: a simple EMA a future Level-3 scheduler will also consume.
import type { AttemptUpdate, MemorizeCard } from './memorize-types';

/** mastery' = round(0.6*prev + 0.4*attemptScore). Inputs assumed 0–100. */
export function nextMastery(prev: number, attemptScore: number): number {
  return Math.round(0.6 * prev + 0.4 * attemptScore);
}

/** Compute the write-back for one attempt: new mastery, +1 attempt, timestamp. */
export function applyAttempt(
  card: Pick<MemorizeCard, 'mastery' | 'attempts'>,
  attemptScore: number,
  nowIso: string,
): AttemptUpdate {
  return {
    mastery: nextMastery(card.mastery, attemptScore),
    attempts: card.attempts + 1,
    lastPracticedAt: nowIso,
  };
}
