# Lamplight Study Chat — Broader Answers + Conversation History

**Date:** 2026-06-29
**Status:** Approved (design)
**Branch (proposed):** `feat/study-chat-broader-and-history`

## Problem

Lamplight Study chat is locked to the chapter the reader has open:

1. **Over-anchored answers.** Grounding is only the open chapter's text, its book
   apparatus, and its curated cross-references. A citation validator
   (`allowedVerseRefs`) rejects any cited verse outside the open chapter or those
   cross-refs. A reader asking a broader question ("how does this connect to
   Paul's argument in Romans?") gets an answer fenced to the current chapter, and
   the model cannot cite the verses it would need.
2. **No conversation history.** Threads persist (`lamplight_chat_threads` /
   `lamplight_chat_messages`, keyed by `passage_ref = book.chapter`, with an
   `archived` flag), but there is no UI to browse or reopen past conversations.
   Changing chapters or archiving makes a conversation vanish from view.

## Goals

- **A — Broader answers, still grounded.** The AI may answer questions that range
  beyond the open chapter and cite verses from anywhere in Scripture, while only
  ever citing real, translation-correct verse text the server supplied. The open
  chapter remains a *starting point*, not a fence.
- **B — Conversation history.** A global, newest-first browser of every past Study
  conversation across all passages. Reopening a conversation shows it read-only;
  sending a new message **resumes it in place** — grounded on that conversation's
  *original* chapter, regardless of which chapter the reader currently has open.
  A "New conversation" action is included.

## Non-goals

- Decoupling threads from passages at the schema level (no migration). `passage_ref`
  and the per-passage active-thread uniqueness stay as they are.
- Persisting one continuous conversation that follows the reader across chapters
  (explicitly *not* chosen — conversations stay anchored to their origin chapter).
- Changes to the journaling chat (`lamplight-chat`) behavior or to insight mode.
- Pagination / search within history (cap the list; revisit only if needed).

## Approach (decisions locked)

- **A1 — Retrieval-grounded expansion.** Reuse the whole-Bible semantic search
  (`searchBible` + rerank) that journaling chat already uses
  (`lamplight-chat/index.ts:297-310`). Inject top-K related verses into grounding
  and into `allowedVerseRefs`. The validator is unchanged; it simply now permits a
  larger, server-supplied set. Chosen over opening the gate to "any real verse"
  (would let the model quote verses from memory with wording/translation drift) and
  over prompt-only softening (would not actually unblock off-chapter citations).
- **B1 — Reuse existing threads, no migration.** The threads table already stores
  `user_id, book, chapter, passage_ref, title, archived, updated_at`. Add a list
  query, a "selected conversation" state in the panel, and an optional `thread_id`
  param on the edge function so a specific thread can be appended to and grounded
  on its own chapter. Chosen over a schema decoupling (bigger blast radius, not
  needed for resume-in-place).

---

## Backend changes

### `supabase/functions/lamplight-study/study-context.ts`

- Add whole-Bible retrieval inside `buildStudyContext`:
  - `const retrievedBible = await searchBible({ supabase, voyage, rerankEnabled }, { query: retrievalQuery, k: VERSE_K, translation })`.
  - Resolve `source_id`s → `{ ref, text }` via `fetchPassageText` and `formatVerseRef`
    (same pattern as journaling chat).
  - **Dedupe**: drop any retrieved ref already present in the open-chapter verse set
    or the curated cross-ref set, so a verse is never listed twice.
- Expose results as a new **optional** field `relatedPassages: Array<{ ref: string; text: string }>`
  on `BibleChatContext` (added to the shared interface in `bible-chat-pipeline.ts` as
  `relatedPassages?`). Journaling chat leaves it undefined → non-breaking.
- Add each related ref (lowercased) into `allowedVerseRefs`.
- New constant `VERSE_K = 6` (alongside existing `NOTE_K`, `CROSSREF_K`). `NOTE_K` /
  `CROSSREF_K` unchanged.
- **Graceful degradation:** if `searchBible` throws or returns empty, log and continue
  with `relatedPassages = []` (today's grounding). A retrieval failure must not fail
  the turn.

### `supabase/functions/lamplight-study/prompts/study-chat.ts`

- System prompt: add framing that the open chapter is the reader's *starting point,
  not a boundary*; the reader may ask broader questions; answer them by drawing on the
  related passages, cross-references, and book context; cite any **supplied** ref.
  Preserve the voice principle verbatim in spirit: never prophetic, state given facts
  as facts and cite them, offer interpretation as possibility, never invent refs/dates/
  etymologies.
- `buildMessages`: render a `Related passages from across Scripture:` block (rendered
  only when `relatedPassages` is non-empty), formatted like the cross-refs block.
- Bump `promptVersion` (e.g. `study-chat-2026-06-29-v2`).

### `supabase/functions/lamplight-study/parse-body.ts`

- Parse an optional `thread_id` (string; basic shape/UUID validation). Absent → today's
  behavior.

### `supabase/functions/lamplight-study/index.ts`

- When `thread_id` is present:
  - Load the thread row `where id = thread_id AND user_id = userId AND surface = 'study'`.
    Not found → `{ ok: false, reason: 'thread_not_found' }` (403/404). This is the
    server-side ownership check.
  - Use the thread's stored `book` / `chapter` / `passage_ref` for grounding and
    `buildStudyContext` (**resume in place** — ignore any body `book`/`chapter` for the
    grounding chapter).
  - Append messages to this `thread_id`; **do not** call `upsertStudyThread`.
- When `thread_id` is absent: unchanged (upsert active thread for the body's passage).
- Apply to **both** branches:
  - Streaming: replace the `upsertThread` dep with a resolver that returns the verified
    `thread_id` (and skips create); `loadHistory` / `persistUserMessage` /
    `persistAssistant` already operate by `threadId`.
  - Buffered: branch the `upsertStudyThread` call.
- Gates (opt-in, entitlement, quota) run identically on resumed sends.
- Insight mode (`mode: 'insight'`) ignores `thread_id` — unchanged.

---

## Frontend changes

### `src/notepad/study/useStudyChatHistory.ts` (new)

- `useStudyChatHistory(userId: string | null)` →
  `{ items, loading, error, reload }` where each item is
  `{ threadId, book, chapter, title, updatedAt }`.
- Query `lamplight_chat_threads` where `user_id = userId AND surface = 'study'`,
  ordered `updated_at desc`, limit ~50. RLS already scopes to the user.
- Display label (`"Romans 8 · 2 days ago"`) computed in the component using the
  existing client book-name resolution + a relative-time helper (confirm exact util in
  planning).

### `src/notepad/study/useStudyChatThread.ts`

- Add an optional `threadId?: string` argument. When provided, load that thread's
  messages directly (skip the passage→active-thread lookup); the thread's `book`/
  `chapter` are supplied by the caller (from the history item). When absent, behavior is
  exactly as today. `archiveAndReset` is unchanged (operates on the passage).

### `src/notepad/study/panes/LamplightStudyPanel.tsx`

- Introduce **selected-conversation** state:
  - `{ mode: 'passage' }` — default; conversation = reader's open `book`/`chapter`
    (today's behavior).
  - `{ mode: 'thread', threadId, book, chapter }` — reopened from history; carries its
    own chapter.
- Drive `useStudyChatThread` from the selection (passing `threadId` + the selected
  `book`/`chapter`).
- Slim header row inside the chat panel:
  - Left: passage/title label for the active conversation.
  - Right: **New conversation** (+) and **History** (clock) buttons.
- **History view:** in-panel list (overlay or replace-content) rendered from
  `useStudyChatHistory`. Clicking an item sets `{ mode: 'thread', … }`, closes the list,
  shows messages read-only until the user types (→ resume in place).
- **New conversation:** runs `archiveAndReset` for the reader's current passage and
  returns to an empty `{ mode: 'passage' }` conversation.
- **Reader navigation:** when the `book`/`chapter` props change, reset selection to
  `{ mode: 'passage' }` for the new chapter (drop any reopened thread).
- Sending uses the selected conversation's `book`/`chapter`, and includes `threadId`
  when `mode === 'thread'`.

### `src/notepad/study/study-chat-client.ts` and `study-stream-client.ts`

- Add optional `threadId` to the send args; include it in the request body when present.
  Default passage-mode sends omit it (unchanged wire shape).

---

## Data flow

**Default (passage mode), unchanged:** reader open on `book.chapter` → panel loads that
passage's active thread → send (no `thread_id`) → edge upserts active thread, grounds on
the open chapter **plus** A1 related passages → reply cites from chapter + cross-refs +
related passages.

**Resume in place:** user opens History → picks "Romans 8 · 2 days ago" → panel selects
that thread, loads its messages read-only → user types → send includes `thread_id` →
edge verifies ownership, grounds on **Romans 8** (the thread's chapter) + A1 related
passages for the new message → appends to that thread → `updated_at` bumped (rises to top
of history).

## Error handling

- `searchBible` failure/empty → `relatedPassages = []`, turn proceeds on chapter grounding.
- `thread_id` not owned / wrong surface → `thread_not_found`, surfaced via the panel's
  existing `friendlyError` mapping.
- Streaming interruption, quota, opt-in, entitlement → existing handling, unchanged.
- History query error → inline error in the history view; the active conversation is
  unaffected.

## Testing

**Backend (Deno):**
- `study-context`: related passages added to `allowedVerseRefs`; dedupe against open
  chapter + cross-refs; empty/throwing `searchBible` degrades to chapter grounding.
- `parse-body`: accepts and validates `thread_id`; tolerates its absence.
- `index`: with `thread_id`, grounds on the thread's chapter and appends to it; rejects a
  thread owned by another user / wrong surface; without `thread_id`, unchanged upsert path.

**Frontend (Vitest):**
- `useStudyChatHistory`: query shape + ordering + mapping to items.
- `LamplightStudyPanel`: renders history list; reopen sets selection and loads read-only;
  "New conversation" archives + resets; reader-navigation resets selection; resume send
  carries `threadId` + the thread's `book`/`chapter`.
- Existing `lamplight_chat_threads` RLS test covers history-query scoping.

**Baseline:** changes must add **zero** new lint/tsc/test errors against the known red
baseline; do not gate on repo-wide green. Typecheck with `tsc -b`.

## Deploy notes

- No migration.
- `lamplight-study` edge function must be deployed manually
  (`supabase functions deploy lamplight-study --use-api`) — not carried by a frontend
  deploy.
