// supabase/functions/_shared/chat-mode.ts
// The two shapes a chat request can take, and the one place that reads the wire.
//
// `chat`   — the reader asked something.
// `opener` — the reader has just opened a passage and asked nothing yet, so the
//            surface offers one short grounded observation to start from.
//
// RENAMED FROM `insight` (parent design §10). "Insight" had come to mean three
// different things — this opening observation, the cached etymology word study,
// and the Insights feature itself. The feature keeps the name; the mode gives
// it up.
//
// ⚠️ THE LEGACY SPELLING IS STILL ACCEPTED, and deliberately, not as a leftover.
// `requestOpeningInsight` fires on every journaling passage open and sends
// `mode: 'insight'`; a function that stopped understanding it would fall
// through to `chat`, find an empty message, and return `400 bad payload` to
// every reader. Vercel deploys the client automatically on merge while edge
// functions deploy by hand, so the client reaches production FIRST. Tolerating
// both spellings is what lets the rename land in one PR instead of a
// choreographed two.
//
// Shared rather than copied because there are two chat functions — study and
// journaling — and "accept both spellings" written twice is two things to
// drift.
export type ChatMode = 'chat' | 'opener';

export function parseChatMode(raw: unknown): ChatMode {
  return raw === 'opener' || raw === 'insight' ? 'opener' : 'chat';
}
