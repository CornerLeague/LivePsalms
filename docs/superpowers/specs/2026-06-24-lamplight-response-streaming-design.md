# Lamplight Response Streaming — Design

**Date:** 2026-06-24
**Status:** Approved (design); implementation plan pending
**Surfaces:** Lamplight Chat, Today's Lamp (daily devotion)

## Goal

Show text *while the user waits* for a Lamplight response to generate, instead of
a static "Lamplight is reflecting…" line followed by an all-at-once render. The
wait should read as one honest arc: real retrieval narration → response pieces
appearing in order as Claude writes them.

## Background — why this is non-trivial

Both surfaces generate responses through the Anthropic Messages API in **forced
tool-use mode** (`tool_choice: { type: 'tool', name }`), via the shared adapter
`supabase/functions/_shared/anthropic.ts`. The visible text is a *field inside a
structured JSON tool argument*, not a top-level text stream:

- **Chat** (`lamplight-chat`, tool `emit_chat_reply`) returns
  `{ reply: string, citations: [{ type, ref }] }`.
- **Today's Lamp** (`lamplight-generate`, kind `daily_devotion`, tool
  `emit_daily_devotion`) returns a multi-field artifact:
  `{ opening, scripture: { ref, text }, reflection, prompt, note_citations[] }`,
  with strict per-field length validators (e.g. `reflection` 400–900 chars,
  `opening` 80–280).

There is **no streaming anywhere today**: every call is a single buffered
`await fetch(...)` → `await res.json()`, wrapped in a **validate-then-retry-once
loop** (`supabase/functions/_shared/generate-with-retry.ts`) that needs the
complete parsed object before deciding to accept or regenerate. The edge
functions return buffered `new Response(JSON.stringify(...))`, and the client
uses `supabase.functions.invoke(...)`, which cannot read a streaming body.

Today's Lamp is additionally **cached one-per-day** per user
(`lamplight_artifacts`, keyed `(user_id, 'daily_devotion', local_date)`); after
the first generation each day it loads instantly from the table. Its current
"Reading your recent notes… / Searching Scripture…" progress steps are **fake** —
a timer (`startInterval` in `todays-lamp-controller.ts`), not wired to real work.

## Decisions (the experience)

| Decision | Choice |
|---|---|
| Reveal model | Pieces reveal **in order** (structured), driven by JSON field completion |
| Within a piece | **Pops in whole** (no typewriter); Chat reply uses **chunked pop-in** at sentence/paragraph boundaries |
| Source | **Genuine live streaming** — text appears *during* generation, not paced after |
| Pre-text wait | **Honest micro-narration** tied to real retrieval stages ("Reading your recent notes…" → "Searching Scripture…") |
| Rare validation-retry | **Gentle "refining…" beat**, then pieces re-settle to the validated version |
| Today's Lamp layout | Card **unfolds/grows** downward as pieces arrive |
| Motion | Gentle fade + slight rise per piece; **respects `prefers-reduced-motion`** |

## Approach

**Stream the forced-tool-use JSON (chosen).** Keep today's generation strategy.
Set `stream: true`, read Anthropic's SSE, accumulate the partial JSON
(`input_json_delta` events). Because the schema is fixed and Claude emits fields
in schema order, detect a field is complete by **key-boundary scanning** against
the known schema (value closed + next key started, or object ended), then emit
that field to the client. This preserves typed citations, per-field length
validators, and the multi-piece Today's Lamp structure.

*Rejected — switch prompts to plain text with section markers.* Simpler
streaming, but loses the typed `citations[]` array and structured validation,
re-parses sections from raw text, and discards the validate-retry safety net.
Too risky for the daily devotion's strict structure.

## Architecture

```
[ Retrieval: embed query · search notes · search Scripture ]  ──SSE──▶ stage events
                          │
                          ▼
[ Anthropic stream (stream:true, tool-use) ]
   accumulate input_json_delta → detect field boundary (key-boundary scan)
                          │
        per-field validate (length/format) BEFORE emit
                          │
                          ▼
   ──SSE──▶ piece events  (opening → scripture → reflection → prompt → citations)
                          │
        cross-field validate at end (citations real? voice ok?)
              │ pass → "done"        │ fail → "refining" → retry → "replace"
```

### Three layers change

1. **`supabase/functions/_shared/anthropic.ts`** — new streaming generate path
   (the chokepoint both surfaces share). Sets `stream: true`, reads the SSE,
   accumulates `input_json_delta`, surfaces field-complete callbacks. Propagates
   an abort signal into the Anthropic fetch so an aborted stream stops spend.
2. **`supabase/functions/_shared/generate-with-retry.ts`** — restructure the
   validate-retry loop:
   - **Attempt 1 streams optimistically.** Each field is validated against its
     *own* rules (length/format) **before** it is emitted — so a per-field
     failure produces a "refining" beat *before* that field would have shown
     (never a visible rewrite).
   - **Cross-field validators** (citations point at real notes; no
     prophetic/pronouncement voice) run once the object is complete. Pass →
     `done`. Fail → emit `refining`, run attempt 2, emit `replace` with the
     validated object (the affected pieces re-settle).
3. **Transport** — `supabase.functions.invoke` can't read a streaming body, so
   add a small streaming client: a direct `fetch` to the function URL with the
   session Bearer token, parsing SSE events. Both edge functions
   (`lamplight-chat/index.ts`, `lamplight-generate/index.ts`) return a
   `ReadableStream`/SSE `Response` instead of buffered JSON, carrying the same
   CORS headers. Entitlement/opt-in gates run **before** the stream opens and
   return a normal JSON error if blocked (no SSE for blocked requests).

### SSE event vocabulary (shared)

- `stage` — `{ stage: 'notes' | 'scripture' | 'composing' }` (drives narration)
- `piece` — `{ field, value }` (a completed, per-field-validated field)
- `refining` — `{}` (rare; a cross-field/per-field check failed, regenerating)
- `replace` — `{ payload }` (the validated result after a retry — a chat
  `{ reply, citations }` or a daily-devotion `artifact`, per surface)
- `done` — `{ ...final payload, meta }`
- `error` — `{ reason }`

## Per-surface behavior

### Chat — `LamplightChat.tsx`, `ChatMessage.tsx`, `lamplight-chat-client.ts`, `useChatThread.ts`

- New streaming client fn (`streamChatMessage`) exposing callbacks: `onStage`,
  `onChunk`, `onCitations`, `onRefining`, `onDone`, `onError`. The buffered
  `sendChatMessage` remains as the transport fallback.
- **`send()`**: optimistically append the user message **and** an empty assistant
  placeholder flagged `streaming`.
  - `onStage` → placeholder shows honest narration.
  - `onChunk` → **chunked pop-in**: buffer raw text deltas, flush a chunk on a
    sentence terminator (`. ! ?` + space/newline), a paragraph break, or stream
    end → append to the message `content`. `ChatMessage` already renders
    `content`, so incremental updates "just work"; add a subtle in-progress
    caret/pulse while `streaming`.
  - `onCitations` → attach typed citations.
  - `onDone` → clear the streaming flag.
- `requestReflection()` (insight mode) uses the same streaming path.
- **Stale-guard / abort:** keep the existing `mounted` + `livePassageKey` refs;
  wire an `AbortController` so a passage change or unmount aborts the fetch.

### Today's Lamp — `todays-lamp-controller.ts`, `useTodaysLamp.ts`, `TodaysLampCard.tsx`, `TodaysLampLoading.tsx`, `supabase-lamplight-adapter.ts`

- **Controller state machine** — delete the fake `startInterval`/`loadingStep`.
  Phases: `idle` → `retrieving { stage }` → `generating { pieces: Partial<DailyDevotion> }`
  → `ready { artifact }`, with `refining { pieces }` as the rare branch and
  `error { reason }`.
- **Cache hit unchanged:** `getExisting` → `ready` immediately, no streaming, no
  artificial delay. Only a cache **miss** streams.
- **`TodaysLampCard` `Devotion`** renders from the *partial* artifact — only
  pieces present so far, the card **unfolding/growing** downward as each lands
  (opening → scripture → reflection → prompt → citations), with a gentle settle.
- `TodaysLampLoading` narration is driven by the real `stage` until the first
  piece appears.
- **Persistence:** still write the final validated artifact + keep the
  INSERT-race handling at stream end. An aborted mid-generation stream isn't
  persisted → next visit regenerates (acceptable).

### Shared motion & the "refining" beat

- Each piece reveals with a gentle fade + slight rise; the Today's Lamp card
  grows with a settle. **All motion respects `prefers-reduced-motion`** (instant,
  no transition).
- On the rare retry: a soft inline "Lamplight is refining this…" cue over the
  affected area, then pieces re-settle to validated values on `replace`.

## Edge cases, errors, safety

- **Mid-stream drop (after pieces shown):**
  - *Chat* — mark the partial assistant message errored with a retry affordance;
    **keep** the text already shown.
  - *Today's Lamp* — reset to `error { reason }` with retry (a half-written
    devotion isn't usable).
- **Transport fallback:** if the streaming `fetch` can't initialize (no
  `response.body`), fall back to the existing buffered `invoke` path — content
  still arrives, just without the staged reveal. No hard dependency on streaming.
- **Gates pre-stream:** chat `hasChatAccess` + opt-in; Today's Lamp "has notes"
  are checked before the stream opens and return a normal JSON error (handled as
  today). Blocked requests never open an SSE.
- **Voice principle preserved:** the no-prophetic-voice check is a cross-field
  validator that runs at stream end before `done`; streaming never bypasses it.
  (Load-bearing per the Lamplight voice rule.)
- **Quota:** unchanged accounting — chat spends on the LLM call as today; Today's
  Lamp cache hits don't spend. The abort signal is propagated into the Anthropic
  fetch so a user-aborted stream stops backend spend.
- **Out of scope (untouched, stays buffered):** the `connection_card_why` kind in
  `lamplight-generate`.
- **CORS:** the SSE `Response` carries the same CORS headers (mind the existing
  CORS-on-every-response note in `lamplight-generate/index.ts`).

## Testing

- **Backend unit:** the partial-JSON field-boundary detector (fixtures of
  Anthropic `input_json_delta` sequences → correct field-complete points); the
  restructured `generate-with-retry` (attempt-1 pass; cross-field fail → refining
  → replace; per-field fail *before* emit → refining → retry); per-field
  validators still enforced.
- **Edge-function:** SSE event sequence for chat + Today's Lamp; gate-blocked →
  JSON error (no stream); cache hit → `ready` with no streaming; mid-stream error
  event.
- **Frontend:** chat chunk-boundary buffering (tokens → sentence chunks);
  controller phase transitions (`idle→retrieving→generating→ready`,
  `→refining→ready`, `→error`); `TodaysLampCard` incremental partial render;
  reduced-motion path; abort-on-passage-change. TDD throughout.
- **Manual smoke:** first-of-day Today's Lamp generation; a chat send;
  reduced-motion on; a forced validator failure to watch the refining beat.

## Shipping

- The two edge functions deploy **manually**:
  `supabase functions deploy lamplight-chat` and
  `supabase functions deploy lamplight-generate` (via `--use-api`). They are not
  in CI, so a Vercel/frontend deploy will **not** carry the function changes.
- Verify **zero new** lint/tsc/test errors against the known pre-existing red
  baseline. Typecheck with `tsc -b` (the real build command), not bare
  `tsc --noEmit`.

## Key files touched

| Layer | File |
|---|---|
| Backend chokepoint | `supabase/functions/_shared/anthropic.ts` |
| Validate/retry loop | `supabase/functions/_shared/generate-with-retry.ts` |
| Chat edge fn | `supabase/functions/lamplight-chat/index.ts` |
| Daily devotion edge fn | `supabase/functions/lamplight-generate/index.ts` |
| Chat client | `src/notepad/bible/lamplight-chat-client.ts` |
| Chat UI | `src/notepad/components/lamplight/chat/LamplightChat.tsx`, `ChatMessage.tsx` |
| Daily lamp adapter | `src/notepad/storage/supabase-lamplight-adapter.ts` |
| Daily lamp controller | `src/notepad/lamplight/todays-lamp-controller.ts` |
| Daily lamp UI | `src/notepad/components/lamplight/TodaysLampCard.tsx`, `TodaysLampLoading.tsx` |
| Transport seam | `src/components/sections/Notepad.tsx`, `src/components/sections/notepad/mobile/useMobileWorkspaceModel.ts` |
