// Waymarks tunable constants — the single source of truth (spec §17).
// The React client mirrors these in src/notepad/lamplight/reflection-constants.ts.
// Never inline these literals; import them.

export const ARRIVAL_HOUR_LOCAL = 7;        // reveal a sealed letter at ≥7am local on the 1st (§7)
export const BACKFILL_CAP = 12;             // first-open backfill horizon (§8)
export const MARKER_MIN = 1;                // output shape + validator 1 (§4.3/§6.2)
export const MARKER_MAX = 6;
export const LETTER_WORD_MIN = 60;          // validator 1 — tuned to the §2.2 exemplar (§6.2/§17)
export const LETTER_WORD_MAX = 350;
export const VERBATIM_RUN_MAX_WORDS = 8;    // witnessed-not-reopened lint, validator 5 (§6.2)
export const RETRY_ATTEMPT_CAP = 3;         // scheduled retry → deferred (§9)
export const CANDIDATE_POOL_MIN = 8;        // per-marker candidate pool target (§5)
export const CANDIDATE_POOL_MAX = 12;
export const MONTHLY_PROMPT_VERSION = 'monthly-reflection-v1'; // prompt + artifact provenance (§6.1)
