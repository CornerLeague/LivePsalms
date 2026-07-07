// Client mirror of spec §17 (source of truth). Values MUST equal the Deno
// supabase/functions/_shared/reflection-constants.ts — the co-located drift test enforces it.
export const ARRIVAL_HOUR_LOCAL = 7;      // arrival rule: sealed newest month appears at 07:00 local on the 1st (§7)
export const BACKFILL_CAP = 12;           // first-open backfill horizon, in months (§8)
export const MARKER_MIN = 1;              // markers per letter, lower bound (§4.3)
export const MARKER_MAX = 6;              // markers per letter, upper bound (§4.3)
export const LETTER_WORD_MIN = 60;        // letter length floor, words (§6.2)
export const LETTER_WORD_MAX = 350;       // letter length ceiling, words (§6.2)
export const VERBATIM_RUN_MAX_WORDS = 8;  // witnessed-not-reopened lint (§6.2)
export const RETRY_ATTEMPT_CAP = 3;       // scheduled retry → deferred (§9)
export const CANDIDATE_POOL_MIN = 8;      // per-month candidate pool floor (§5)
export const CANDIDATE_POOL_MAX = 12;     // per-month candidate pool ceiling (§5)
export const MONTHLY_PROMPT_VERSION = 'monthly-reflection-v1'; // artifact provenance (§6.1)
