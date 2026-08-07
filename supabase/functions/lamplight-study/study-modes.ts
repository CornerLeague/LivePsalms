// supabase/functions/lamplight-study/study-modes.ts
// Per-mode generation settings for Lamplight Study.
//
// Extracted from the Deno shell in B4 for the same reason `parse-body.ts` and
// `lamplight-chat/chat-context.ts` were: a module that calls `serve()` at
// module scope cannot be imported by vitest, so anything left inside it is
// unguarded by the gate.
//
// These matter to B4 specifically because they are keyed BY MODE, which makes
// them the part of the `insight` → `opener` rename that no byte gate reaches:
// the prompt can be provably identical while the opener quietly starts running
// at chat's effort, chat's ceiling, or chat's library budget — the last of
// which would change its GROUNDING without changing a character of its prompt.
import type { ChatMode } from '../_shared/chat-mode.ts';

/**
 * Study runs the flagship tier; effort differs by mode. Chat streams while the
 * reader waits, so it stays low to protect first-token latency; the opener
 * fires on passage-open with nobody typing, so it can afford to think longer.
 */
export const STUDY_EFFORT: Record<ChatMode, 'low' | 'medium'> = { chat: 'low', opener: 'medium' };

/** Reasoning tokens share the output budget, hence the raised ceilings. */
export const STUDY_MAX_TOKENS: Record<ChatMode, number> = { chat: 4096, opener: 3072 };

/**
 * Library excerpts per turn (design §Retrieval budgets). Chat carries a real
 * question worth answering from the church's study; the opener is one opening
 * observation, so it takes half. 0 would disable the library for a mode.
 */
export const LIBRARY_K: Record<ChatMode, number> = { chat: 4, opener: 2 };
