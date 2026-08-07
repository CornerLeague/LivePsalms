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
// Two reasons, and the first one has already expired — which is exactly why the
// second is written down.
//
//  1. SPENT. It let the rename land in one PR instead of a choreographed two.
//     Vercel deploys the client on merge while edge functions deploy by hand,
//     so the client reaches production FIRST; the clients therefore kept
//     sending `'insight'` until these functions shipped on 2026-08-07, and
//     flipped to `'opener'` afterwards.
//
//  2. STANDING. **Old client bundles keep sending the old spelling.** There is
//     no service worker, but a reader with the app open in a tab runs whatever
//     bundle they loaded until they reload — and the journaling opener fires on
//     every passage open. Dropping `'insight'` would make those requests fall
//     through to `chat`, find an empty message, and return `400 bad payload`.
//
// So: do not delete this on the grounds that every client now sends `'opener'`.
// Every client that has RELOADED does.
//
// Shared rather than copied because there are two chat functions — study and
// journaling — and "accept both spellings" written twice is two things to
// drift.
export type ChatMode = 'chat' | 'opener';

export function parseChatMode(raw: unknown): ChatMode {
  return raw === 'opener' || raw === 'insight' ? 'opener' : 'chat';
}
