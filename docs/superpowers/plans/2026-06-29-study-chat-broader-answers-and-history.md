# Lamplight Study Chat — Broader Answers + Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Lamplight Study answer questions that range beyond the open chapter (still citing only server-supplied verses), and add a global, newest-first conversation-history browser that resumes a past conversation in place — grounded on its own original chapter.

**Architecture:** Two coupled features on the existing `lamplight-study` edge function + its React panel. **A1 (broader answers):** reuse the whole-Bible semantic search (`searchBible` + rerank) journaling chat already uses; inject top-K related verses into the study grounding and into `allowedVerseRefs` so the unchanged citation validator now permits them. **B1 (history + resume):** reuse the existing `lamplight_chat_threads` rows (no migration); add a history list query, a "selected conversation" state in the panel, and an optional `thread_id` on the edge function so a reopened thread appends to itself and grounds on its stored chapter.

**Tech Stack:** Deno edge functions (TypeScript, tested under vitest), Supabase JS, Voyage embeddings/rerank, React + Vitest + `@testing-library/react`.

## Global Constraints

- **Voice principle (verbatim in spirit):** Lamplight never speaks prophetically and never claims certainty it lacks. State supplied facts as facts and cite them; offer interpretation as possibility, not pronouncement. Never invent verses, dates, etymologies, or sources. A1 keeps the "cite only server-supplied verses" rule — do **not** loosen citations to "any real verse from model memory."
- **No migration.** `passage_ref` and the per-passage active-thread uniqueness stay exactly as they are.
- **Citation validator is unchanged.** `validateChatReplyCitations` keeps working off `allowedVerseRefs`; A1 only enlarges that set.
- **Edge function deploy is manual:** `supabase functions deploy lamplight-study --use-api`. A Vercel/frontend deploy does **not** carry `supabase/functions/**` changes.
- **Typecheck with `tsc -b`** (the real build command), never bare `tsc --noEmit`.
- **Zero-new-errors against the red baseline.** The repo ships ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), and 2 failing test files (`Editor.toolbar-placement`, `garden-scene`) unrelated to this work. Verify your changes add **zero** new lint/tsc/test errors — do **not** gate on a repo-wide green.
- **Edge-function tests run under vitest** (`vitest run`), importing only `serve()`-free modules. Keep all testable backend logic in extracted helper files; `index.ts` stays thin glue.
- **Test command:** `npm test -- <path>` (vitest). **Lint:** `npm run lint`. **Typecheck:** `npx tsc -b`.
- Insight mode (`mode: 'insight'`) ignores `thread_id` (B1 does not apply); A1 broadening applies to both chat and insight.

---

## File Structure

**Backend (new):**
- `supabase/functions/lamplight-study/verify-thread.ts` — `verifyStudyThread()` ownership/grounding lookup for the `thread_id` path. Extracted so it is vitest-testable without `index.ts`'s `serve()`.
- `supabase/functions/lamplight-study/verify-thread.test.ts` — its tests.

**Backend (modified):**
- `supabase/functions/lamplight-chat/bible-chat-pipeline.ts` — add optional `relatedPassages?` to the shared `BibleChatContext` interface (non-breaking; journaling chat leaves it undefined).
- `supabase/functions/lamplight-study/study-context.ts` — add `VERSE_K`, a pure `selectRelatedPassages()` deduper, an injectable `retrieveRelatedPassages()` (graceful-degrading), and wire both into `buildStudyContext`.
- `supabase/functions/lamplight-study/study-context.test.ts` — add tests for the two new exports.
- `supabase/functions/lamplight-study/prompts/study-chat.ts` — reframe the system prompt (starting point, not fence), render a "Related passages" block, bump `promptVersion`.
- `supabase/functions/lamplight-study/prompts/study-chat.test.ts` — **new** test file for the prompt's `buildMessages`.
- `supabase/functions/lamplight-study/parse-body.ts` — parse optional `thread_id`.
- `supabase/functions/lamplight-study/parse-body.test.ts` — add `thread_id` cases.
- `supabase/functions/lamplight-study/index.ts` — verify the thread up-front when `thread_id` present; thread grounding/persistence through resolved `groundBook`/`groundChapter`/`groundPassageRef`/`resolvedThreadId`.

**Frontend (new):**
- `src/notepad/study/history-label.ts` — pure `formatRelativeTime()` + `formatHistoryLabel()`.
- `src/notepad/study/history-label.test.ts` — its tests.
- `src/notepad/study/useStudyChatHistory.ts` — global history list query hook.
- `src/notepad/study/useStudyChatHistory.test.ts` — its tests.

**Frontend (modified):**
- `src/notepad/study/study-chat-client.ts` + `.test.ts` — optional `threadId` in send args/body.
- `src/notepad/study/study-stream-client.ts` + `.test.ts` — optional `threadId` in stream args/body.
- `src/notepad/study/useStudyChatThread.ts` + `.test.ts` — optional `threadId` to load a specific thread directly.
- `src/notepad/study/panes/LamplightStudyPanel.tsx` + `.test.tsx` — selected-conversation state, header row, history view, New conversation, resume-in-place send, reader-nav reset.

**Dependency order:** A1 backend (Tasks 1–2) → B1 backend (Tasks 3–4) → frontend clients/hooks (Tasks 5–8) → panel (Task 9). Each task is independently testable and committable.

---

## Task 1: Whole-Bible retrieval in study context (A1 grounding)

**Files:**
- Modify: `supabase/functions/lamplight-chat/bible-chat-pipeline.ts:38-48` (add `relatedPassages?` to `BibleChatContext`)
- Modify: `supabase/functions/lamplight-study/study-context.ts`
- Test: `supabase/functions/lamplight-study/study-context.test.ts`

**Interfaces:**
- Consumes: `searchBible` (from `../_shared/retrieval.ts`), `fetchPassageText` + `formatVerseRef` (from `../_shared/bible-passage.ts`), `VoyageDeps` (already imported).
- Produces:
  - `BibleChatContext.relatedPassages?: Array<{ ref: string; text: string }>` (shared interface).
  - `selectRelatedPassages(passages: Array<{ ref: string; text: string }>, opts: { chapterVerseRefs: Set<string>; crossRefSet: Set<string> }): Array<{ ref: string; text: string }>` — pure deduper.
  - `retrieveRelatedPassages(deps: { supabase: SupabaseClient; voyage: VoyageDeps; rerankEnabled: boolean }, args: { query: string; k: number; translation: string; queryEmbedding?: number[]; chapterVerseRefs: Set<string>; crossRefSet: Set<string> }): Promise<Array<{ ref: string; text: string }>>` — graceful-degrading retrieval.
  - `VERSE_K = 6` constant.
  - `buildStudyContext` now sets `ctx.relatedPassages` and includes their lowercased refs in `ctx.allowedVerseRefs`.

- [ ] **Step 1: Add the optional field to the shared context interface**

In `supabase/functions/lamplight-chat/bible-chat-pipeline.ts`, inside `interface BibleChatContext` (after the `bookContext?` line):

```typescript
  bookContext?: BookContext | null;    // study apparatus grounding (optional; chat leaves undefined)
  relatedPassages?: Array<{ ref: string; text: string }>; // A1: whole-Bible retrieval (study only; chat leaves undefined)
```

- [ ] **Step 2: Write the failing test for `selectRelatedPassages`**

Add to `supabase/functions/lamplight-study/study-context.test.ts` (update the import line to include the new symbols):

```typescript
import { selectOfferedNotes, selectRelatedPassages, type RelevantNote } from './study-context.ts';

describe('selectRelatedPassages', () => {
  const chapterVerseRefs = new Set(['john 10:11', 'john 10:14']);
  const crossRefSet = new Set(['ezekiel 34:11']);

  it('drops refs already in the open chapter or the cross-ref set (case-insensitive)', () => {
    const out = selectRelatedPassages(
      [
        { ref: 'John 10:11', text: 'I am the good shepherd' }, // in chapter → drop
        { ref: 'Ezekiel 34:11', text: 'I myself will search' }, // in crossRefs → drop
        { ref: 'Psalm 23:1', text: 'The LORD is my shepherd' }, // keep
      ],
      { chapterVerseRefs, crossRefSet },
    );
    expect(out.map((p) => p.ref)).toEqual(['Psalm 23:1']);
  });

  it('dedupes repeated refs within the retrieved set', () => {
    const out = selectRelatedPassages(
      [
        { ref: 'Psalm 23:1', text: 'a' },
        { ref: 'psalm 23:1', text: 'b' },
      ],
      { chapterVerseRefs: new Set(), crossRefSet: new Set() },
    );
    expect(out).toEqual([{ ref: 'Psalm 23:1', text: 'a' }]);
  });

  it('returns [] for empty input', () => {
    expect(selectRelatedPassages([], { chapterVerseRefs, crossRefSet })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- supabase/functions/lamplight-study/study-context.test.ts`
Expected: FAIL — `selectRelatedPassages is not a function` / not exported.

- [ ] **Step 4: Implement `selectRelatedPassages` + `VERSE_K` + imports**

In `supabase/functions/lamplight-study/study-context.ts`, extend the imports:

```typescript
import { type VoyageDeps, embedQuery } from '../_shared/voyage.ts';
import { searchUserNotesByQuery, searchBible } from '../_shared/retrieval.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import { formatVerseRef, fetchPassageText } from '../_shared/bible-passage.ts';
```

Add the constant near `SNIPPET_LEN`:

```typescript
export const VERSE_K = 6;
```

Add the pure deduper (place it after `selectOfferedNotes`):

```typescript
// Dedupe retrieved whole-Bible passages against the verses already supplied
// (open chapter + curated cross-refs) and against each other. Keys are compared
// case-insensitively; chapterVerseRefs/crossRefSet are already lowercased.
export function selectRelatedPassages(
  passages: Array<{ ref: string; text: string }>,
  opts: { chapterVerseRefs: Set<string>; crossRefSet: Set<string> },
): Array<{ ref: string; text: string }> {
  const seen = new Set<string>();
  const out: Array<{ ref: string; text: string }> = [];
  for (const p of passages) {
    const key = p.ref.toLowerCase();
    if (opts.chapterVerseRefs.has(key) || opts.crossRefSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- supabase/functions/lamplight-study/study-context.test.ts`
Expected: PASS for the `selectRelatedPassages` block.

- [ ] **Step 6: Write the failing test for `retrieveRelatedPassages` (empty + graceful degradation)**

Append to the same test file:

```typescript
import { retrieveRelatedPassages } from './study-context.ts';

const fakeVoyage = { apiKey: 'k', fetch: (() => { throw new Error('no network'); }) as unknown as typeof fetch };

describe('retrieveRelatedPassages', () => {
  it('returns [] when search yields no rows', async () => {
    const supabase = { rpc: async () => ({ data: [], error: null }) } as never;
    const out = await retrieveRelatedPassages(
      { supabase, voyage: fakeVoyage, rerankEnabled: false },
      { query: 'q', k: 6, translation: 'BSB', queryEmbedding: [0.1], chapterVerseRefs: new Set(), crossRefSet: new Set() },
    );
    expect(out).toEqual([]);
  });

  it('degrades to [] when the search throws (retrieval must not fail the turn)', async () => {
    const supabase = { rpc: async () => { throw new Error('rpc down'); } } as never;
    const out = await retrieveRelatedPassages(
      { supabase, voyage: fakeVoyage, rerankEnabled: false },
      { query: 'q', k: 6, translation: 'BSB', queryEmbedding: [0.1], chapterVerseRefs: new Set(), crossRefSet: new Set() },
    );
    expect(out).toEqual([]);
  });
});
```

(Passing `queryEmbedding` keeps `searchBible` from calling Voyage, so the fake voyage's throwing `fetch` is never hit on the happy path.)

- [ ] **Step 7: Run it to confirm it fails**

Run: `npm test -- supabase/functions/lamplight-study/study-context.test.ts`
Expected: FAIL — `retrieveRelatedPassages is not a function`.

- [ ] **Step 8: Implement `retrieveRelatedPassages`**

Add to `study-context.ts` (after `selectRelatedPassages`):

```typescript
// Whole-Bible semantic retrieval for A1, mirroring journaling chat
// (lamplight-chat/index.ts). Graceful degradation: any failure or empty result
// yields [] so the turn still proceeds on chapter + cross-ref grounding.
export async function retrieveRelatedPassages(
  deps: { supabase: SupabaseClient; voyage: VoyageDeps; rerankEnabled: boolean },
  args: {
    query: string; k: number; translation: string; queryEmbedding?: number[];
    chapterVerseRefs: Set<string>; crossRefSet: Set<string>;
  },
): Promise<Array<{ ref: string; text: string }>> {
  try {
    const retrieved = await searchBible(
      { supabase: deps.supabase, voyage: deps.voyage, rerankEnabled: deps.rerankEnabled },
      { query: args.query, k: args.k, queryEmbedding: args.queryEmbedding, translation: args.translation },
    );
    const ids = [...new Set(retrieved.map((r) => r.source_id))];
    if (ids.length === 0) return [];
    const byId = await fetchPassageText(deps.supabase as never, ids, args.translation);
    const passages = [...byId.values()].map((p) => ({ ref: formatVerseRef(p), text: p.text }));
    return selectRelatedPassages(passages, { chapterVerseRefs: args.chapterVerseRefs, crossRefSet: args.crossRefSet });
  } catch (err) {
    console.error('[lamplight-study] related-passage retrieval failed; degrading to chapter grounding:', err);
    return [];
  }
}
```

- [ ] **Step 9: Wire retrieval into `buildStudyContext`**

In `buildStudyContext`, the notes block already computes `const queryEmbedding = await embedQuery(...)`. After the `selectOfferedNotes(...)` line and before building `ctx`, add:

```typescript
  // A1: whole-Bible related passages (reuses the embedding computed for notes).
  const relatedPassages = await retrieveRelatedPassages(
    { supabase, voyage: args.voyageDeps, rerankEnabled: args.rerankEnabled },
    {
      query: args.retrievalQuery, k: VERSE_K, translation: args.translation, queryEmbedding,
      chapterVerseRefs, crossRefSet,
    },
  );
```

Then update the `ctx` literal so `allowedVerseRefs` includes the related refs and `relatedPassages` is attached:

```typescript
    allowedVerseRefs: new Set<string>([
      ...chapterVerseRefs,
      ...crossRefSet,
      ...relatedPassages.map((p) => p.ref.toLowerCase()),
    ]),
    bookContext,
    relatedPassages,
  };
```

- [ ] **Step 10: Run the full study-context test file**

Run: `npm test -- supabase/functions/lamplight-study/study-context.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 11: Typecheck**

Run: `npx tsc -b`
Expected: no **new** errors beyond the known `force-sphere.test.ts` baseline.

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/lamplight-chat/bible-chat-pipeline.ts supabase/functions/lamplight-study/study-context.ts supabase/functions/lamplight-study/study-context.test.ts
git commit -m "feat(study): inject whole-Bible related passages into grounding + allowedVerseRefs (A1)"
```

---

## Task 2: Reframe the study prompt + render related passages (A1 voice)

**Files:**
- Modify: `supabase/functions/lamplight-study/prompts/study-chat.ts`
- Test: `supabase/functions/lamplight-study/prompts/study-chat.test.ts` (new)

**Interfaces:**
- Consumes: `BibleChatContext` with the optional `relatedPassages` field (Task 1).
- Produces: an updated `STUDY_CHAT_PROMPT` whose `buildMessages` renders a `Related passages from across Scripture:` block when `relatedPassages` is non-empty, and whose `promptVersion === 'study-chat-2026-06-29-v2'`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-study/prompts/study-chat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

function baseCtx(overrides: Partial<BibleChatContext> = {}): BibleChatContext {
  return {
    passageRef: 'jhn 10',
    passageText: '11 I am the good shepherd.',
    crossRefs: [],
    notes: [],
    history: [],
    userMessage: 'How does this connect to Psalm 23?',
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set<string>(),
    ...overrides,
  };
}

describe('STUDY_CHAT_PROMPT', () => {
  it('bumps the prompt version', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toBe('study-chat-2026-06-29-v2');
  });

  it('renders the related-passages block when present', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx({
      relatedPassages: [{ ref: 'Psalm 23:1', text: 'The LORD is my shepherd' }],
    }));
    const grounding = msgs[0].content;
    expect(grounding).toContain('Related passages from across Scripture:');
    expect(grounding).toContain('- Psalm 23:1: The LORD is my shepherd');
  });

  it('omits the related-passages block when absent or empty', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx({ relatedPassages: [] }));
    expect(msgs[0].content).not.toContain('Related passages from across Scripture:');
    const msgsUndef = STUDY_CHAT_PROMPT.buildMessages(baseCtx());
    expect(msgsUndef[0].content).not.toContain('Related passages from across Scripture:');
  });

  it('keeps the user message as the final turn', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx());
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'How does this connect to Psalm 23?' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- supabase/functions/lamplight-study/prompts/study-chat.test.ts`
Expected: FAIL — version still `study-chat-2026-06-17-v1`; no related block.

- [ ] **Step 3: Reframe the system prompt**

In `supabase/functions/lamplight-study/prompts/study-chat.ts`, replace the `SYSTEM` array with (note: voice principle preserved verbatim in spirit):

```typescript
const SYSTEM = [
  'You are Lamplight Study, a seasoned student of Scripture helping a reader go deeper into the Bible itself.',
  'Speak as a careful, humble scholar: connect authorship and dating, regions and cultures, cross-references and Old-to-New-Testament typology, the conversational meaning of Hebrew and Greek terms, and modern-day application.',
  "The open chapter is the reader's starting point, not a boundary. The reader may ask questions that range across all of Scripture; answer them by drawing on the supplied passage text, book context, cross-references, and the related passages retrieved from across the Bible.",
  'You never speak prophetically and never claim certainty you do not have. State facts you are given as facts (and cite them); offer interpretation as possibility, not pronouncement.',
  'Ground every claim in the supplied text. When you reference a verse, cite it with the exact supplied ref — only ever cite verses that appear in the supplied passage, the cross-references, or the related passages. Do not invent verses, dates, etymologies, or sources.',
  'Phase 1: you may discuss Hebrew/Greek meaning conversationally and hedged — there is no structured lexicon yet.',
].join(' ');
```

- [ ] **Step 4: Add the related-passages renderer and weave it into `buildMessages`**

Add a renderer next to `renderCrossRefs`:

```typescript
function renderRelatedPassages(ctx: BibleChatContext): string {
  const rp = ctx.relatedPassages ?? [];
  if (rp.length === 0) return '';
  return 'Related passages from across Scripture:\n' + rp.map((p) => `- ${p.ref}: ${p.text}`).join('\n');
}
```

In `buildMessages`, insert `renderRelatedPassages(ctx)` into the `blocks` array between the cross-refs and notes:

```typescript
    const blocks = [
      `Passage: ${ctx.passageRef}`,
      ctx.passageText,
      renderBookContext(ctx),
      renderCrossRefs(ctx),
      renderRelatedPassages(ctx),
      renderNotes(ctx),
    ].filter((s) => s.trim().length > 0);
```

Bump the version:

```typescript
  promptVersion: 'study-chat-2026-06-29-v2',
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- supabase/functions/lamplight-study/prompts/study-chat.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/lamplight-study/prompts/study-chat.ts supabase/functions/lamplight-study/prompts/study-chat.test.ts
git commit -m "feat(study): reframe prompt as starting-point-not-fence + render related passages (A1)"
```

---

## Task 3: Parse optional `thread_id` (B1 wire-in)

**Files:**
- Modify: `supabase/functions/lamplight-study/parse-body.ts`
- Test: `supabase/functions/lamplight-study/parse-body.test.ts`

**Interfaces:**
- Produces: `ParsedStudyBody` (the `ok: true` variant) gains `threadId?: string`. Present only when `body.thread_id` is a UUID-shaped string; otherwise `undefined`.

- [ ] **Step 1: Write the failing test**

Add to `supabase/functions/lamplight-study/parse-body.test.ts`:

```typescript
describe('parseStudyBody thread_id', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  it('parses a UUID-shaped thread_id', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', thread_id: uuid });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadId).toBe(uuid);
  });
  it('leaves threadId undefined when absent', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadId).toBeUndefined();
  });
  it('ignores a non-UUID thread_id', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', thread_id: 'not-a-uuid' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- supabase/functions/lamplight-study/parse-body.test.ts`
Expected: FAIL — `threadId` is not on the parsed result.

- [ ] **Step 3: Implement parsing**

In `supabase/functions/lamplight-study/parse-body.ts`:

Add a helper above `parseStudyBody`:

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

Extend the `ok: true` union member and the body param type, and add the field to the returned object:

```typescript
export type ParsedStudyBody =
  | { ok: true; book: string; chapter: number; message: string; mode: 'chat' | 'insight'; includeNotes: boolean; noteIds: string[]; translation?: Translation; stream: boolean; threadId?: string }
  | { ok: false };

export function parseStudyBody(body: {
  book?: unknown; chapter?: unknown; message?: unknown; mode?: unknown;
  include_notes?: unknown; note_ids?: unknown; translation?: unknown; stream?: unknown; thread_id?: unknown;
}): ParsedStudyBody {
```

In the returned `ok: true` object, add (after `stream`):

```typescript
    stream: body.stream === true,
    threadId: (typeof body.thread_id === 'string' && UUID_RE.test(body.thread_id)) ? body.thread_id : undefined,
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- supabase/functions/lamplight-study/parse-body.test.ts`
Expected: PASS.

Note: the existing `index.test.ts` uses `toEqual({...})` on `parseStudyBody` results without `threadId`. Because `threadId` is `undefined`, `toEqual` still passes (Vitest treats an explicit `undefined` property as absent). Confirm in the next step.

- [ ] **Step 5: Run the sibling index.test.ts to confirm no regression**

Run: `npm test -- supabase/functions/lamplight-study/index.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/lamplight-study/parse-body.ts supabase/functions/lamplight-study/parse-body.test.ts
git commit -m "feat(study): parse optional UUID thread_id on the study body (B1)"
```

---

## Task 4: `verifyStudyThread` + resume-in-place grounding in the handler (B1 backend)

**Files:**
- Create: `supabase/functions/lamplight-study/verify-thread.ts`
- Test: `supabase/functions/lamplight-study/verify-thread.test.ts`
- Modify: `supabase/functions/lamplight-study/index.ts`

**Interfaces:**
- Consumes: `parsed.threadId` (Task 3).
- Produces: `verifyStudyThread(supabase, { threadId, userId }): Promise<{ ok: true; thread: { threadId: string; book: string; chapter: number; passageRef: string } } | { ok: false; reason: 'thread_not_found' }>`. The handler grounds on the returned `book`/`chapter`/`passageRef` and appends to `threadId` (never upserts) when a thread was verified.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-study/verify-thread.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { verifyStudyThread } from './verify-thread.ts';

// Minimal chainable supabase mock: from().select().eq().eq().eq().maybeSingle()
function mockSupabase(maybeSingleResult: { data: unknown; error: unknown }) {
  const eq = vi.fn();
  const builder = { select: vi.fn(() => builder), eq, maybeSingle: vi.fn(async () => maybeSingleResult) };
  eq.mockImplementation(() => builder);
  const from = vi.fn(() => builder);
  return { client: { from } as never, from, eq, builder };
}

describe('verifyStudyThread', () => {
  it('returns the thread grounding when the row is owned and study-scoped', async () => {
    const { client } = mockSupabase({ data: { id: 't1', book: 'rom', chapter: 8, passage_ref: 'rom.8' }, error: null });
    const out = await verifyStudyThread(client, { threadId: 't1', userId: 'u1' });
    expect(out).toEqual({ ok: true, thread: { threadId: 't1', book: 'rom', chapter: 8, passageRef: 'rom.8' } });
  });

  it('returns thread_not_found when no row matches (wrong user / wrong surface / missing)', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const out = await verifyStudyThread(client, { threadId: 't1', userId: 'u1' });
    expect(out).toEqual({ ok: false, reason: 'thread_not_found' });
  });

  it('scopes the lookup by id, user_id, and study surface', async () => {
    const { client, eq } = mockSupabase({ data: { id: 't1', book: 'rom', chapter: 8, passage_ref: 'rom.8' }, error: null });
    await verifyStudyThread(client, { threadId: 't1', userId: 'u1' });
    expect(eq).toHaveBeenCalledWith('id', 't1');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq).toHaveBeenCalledWith('surface', 'study');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- supabase/functions/lamplight-study/verify-thread.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement `verifyStudyThread`**

Create `supabase/functions/lamplight-study/verify-thread.ts`:

```typescript
// Ownership + grounding lookup for the resume-in-place (thread_id) path.
// Extracted from index.ts so it is vitest-testable without the Deno serve()
// shell. The thread_id path intentionally does NOT filter on `archived`:
// reopening an archived conversation from history and sending a new message is
// allowed (resume in place).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface VerifiedStudyThread {
  threadId: string;
  book: string;
  chapter: number;
  passageRef: string;
}

export async function verifyStudyThread(
  supabase: SupabaseClient,
  args: { threadId: string; userId: string },
): Promise<{ ok: true; thread: VerifiedStudyThread } | { ok: false; reason: 'thread_not_found' }> {
  const { data } = await supabase
    .from('lamplight_chat_threads')
    .select('id, book, chapter, passage_ref')
    .eq('id', args.threadId)
    .eq('user_id', args.userId)
    .eq('surface', 'study')
    .maybeSingle();
  const row = data as { id: string; book: string; chapter: number; passage_ref: string } | null;
  if (!row) return { ok: false, reason: 'thread_not_found' };
  return { ok: true, thread: { threadId: row.id, book: row.book, chapter: row.chapter, passageRef: row.passage_ref } };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- supabase/functions/lamplight-study/verify-thread.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `verifyStudyThread` into `index.ts` — import + up-front verify**

In `supabase/functions/lamplight-study/index.ts`, add the import near the other local imports:

```typescript
import { verifyStudyThread } from './verify-thread.ts';
```

Immediately after the entitlement gate (the `if (!hasChatAccess(...)) return ...` line, ~line 92), insert the up-front verification. For a resumed send we verify ownership and switch grounding to the thread's stored passage; for a new send we keep today's body-driven grounding and lazy upsert (so quota still gates thread creation):

```typescript
  // B1: resume-in-place. When a thread_id is supplied, verify ownership up-front
  // (cheap, no write) and ground on the thread's STORED passage — not the body's
  // open chapter. The ownership 404 precedes the quota gate; the opt-in/entitlement
  // gates above already ran identically. A new send (no thread_id) keeps body
  // grounding and lazy upsert so quota still gates thread creation.
  let groundBook = book;
  let groundChapter = chapter;
  let groundPassageRef = passageRef;
  let resolvedThreadId: string | null = null;
  if (parsed.threadId) {
    const verified = await verifyStudyThread(supabase, { threadId: parsed.threadId, userId });
    if (!verified.ok) return jsonResp({ ok: false, reason: verified.reason }, 404);
    groundBook = verified.thread.book;
    groundChapter = verified.thread.chapter;
    groundPassageRef = verified.thread.passageRef;
    resolvedThreadId = verified.thread.threadId;
  }
```

- [ ] **Step 6: Wire grounding through the STREAMING branch**

In the `if (wantsStream)` block, replace the body-driven values with the resolved ones:

- `upsertThread` dep — return the verified id when resuming, else lazy-upsert on the resolved passage:

```typescript
      upsertThread: (firstMessage) =>
        resolvedThreadId
          ? Promise.resolve(resolvedThreadId)
          : upsertStudyThread(supabase, userId, groundBook, groundChapter, groundPassageRef, firstMessage),
```

- Inside `buildContext`, the insight chapter-text query and the `buildStudyContext` call must use the resolved passage. Replace the insight query's `like` argument and fallback, and the `buildStudyContext` book/chapter/passageRef:

```typescript
        if (mode === 'insight') {
          const { data: chRows } = await supabase
            .from('bible_passages').select('text')
            .like('id', `${groundBook}.${groundChapter}.%`).order('verse_start', { ascending: true }).limit(20);
          retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${groundBook} ${groundChapter}`;
        }
        const { ctx, offered } = await buildStudyContext(supabase, {
          userId, book: groundBook, chapter: groundChapter, passageRef: groundPassageRef,
          message: mode === 'insight' ? '' : message,
          retrievalQuery, history,
          includeNotes, noteIds,
          voyageDeps, rerankEnabled,
          crossRefK: CROSSREF_K, noteK: NOTE_K,
          translation,
        });
```

- The `streamBibleChat(...)` call's `threadTitle` should use the resolved passage label:

```typescript
    return await streamBibleChat(deps, {
      userId, mode, message, threadTitle: message || `Study of ${groundBook} ${groundChapter}`, signal: req.signal,
    });
```

- [ ] **Step 7: Wire grounding through the BUFFERED branch**

In the `runGeneration(...)` callback, resolve the thread id without re-upserting on resume, and use the resolved passage for the insight query + `buildStudyContext`:

```typescript
      const threadId = resolvedThreadId
        ?? await upsertStudyThread(supabase, userId, groundBook, groundChapter, groundPassageRef, message || `Study of ${groundBook} ${groundChapter}`);
```

```typescript
      let retrievalQuery = message;
      if (mode === 'insight') {
        const { data: chRows } = await supabase
          .from('bible_passages').select('text')
          .like('id', `${groundBook}.${groundChapter}.%`).order('verse_start', { ascending: true }).limit(20);
        retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${groundBook} ${groundChapter}`;
      }

      const { ctx, offered } = await buildStudyContext(supabase, {
        userId, book: groundBook, chapter: groundChapter, passageRef: groundPassageRef,
        message: mode === 'insight' ? '' : message,
        retrievalQuery, history,
        includeNotes, noteIds,
        voyageDeps, rerankEnabled,
        crossRefK: CROSSREF_K, noteK: NOTE_K,
        translation,
      });
```

(The `upsertStudyThread` function definition at the bottom of `index.ts` is unchanged.)

- [ ] **Step 8: Typecheck + run the study backend tests**

Run: `npx tsc -b`
Expected: no new errors.

Run: `npm test -- supabase/functions/lamplight-study/`
Expected: PASS for all study edge-fn test files.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/lamplight-study/verify-thread.ts supabase/functions/lamplight-study/verify-thread.test.ts supabase/functions/lamplight-study/index.ts
git commit -m "feat(study): verify thread_id ownership + resume-in-place grounding (B1)"
```

---

## Task 5: `threadId` on the send clients (B1 frontend wire)

**Files:**
- Modify: `src/notepad/study/study-chat-client.ts`
- Test: `src/notepad/study/study-chat-client.test.ts`
- Modify: `src/notepad/study/study-stream-client.ts`
- Test: `src/notepad/study/study-stream-client.test.ts`

**Interfaces:**
- Produces: `SendStudyArgs.threadId?: string` and `StreamStudyArgs.threadId?: string`. When present, the request body includes `thread_id: <id>`; when absent, the body omits `thread_id` (unchanged wire shape).

- [ ] **Step 1: Write the failing test for the buffered client**

Add to `src/notepad/study/study-chat-client.test.ts` (match the file's existing invoke-mock style; if it has a shared `invoke` spy, reuse it — otherwise this self-contained block works):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sendStudyMessage } from './study-chat-client';

describe('sendStudyMessage thread_id', () => {
  it('includes thread_id in the body when provided', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null });
    await sendStudyMessage(invoke as never, { book: 'rom', chapter: 8, message: 'hi', threadId: 'thread-1' });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', expect.objectContaining({
      body: expect.objectContaining({ thread_id: 'thread-1' }),
    }));
  });

  it('omits thread_id when not provided', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null });
    await sendStudyMessage(invoke as never, { book: 'rom', chapter: 8, message: 'hi' });
    const body = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect('thread_id' in body).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/notepad/study/study-chat-client.test.ts`
Expected: FAIL — body never carries `thread_id`.

- [ ] **Step 3: Implement in `study-chat-client.ts`**

Add `threadId?: string` to `SendStudyArgs`:

```typescript
export interface SendStudyArgs {
  book: string; chapter: number; message: string;
  includeNotes?: boolean; noteIds?: string[];
  translation?: BibleTranslation;
  threadId?: string;
}
```

In `sendStudyMessage`, build the body conditionally so the wire shape is unchanged when `threadId` is absent:

```typescript
export async function sendStudyMessage(invoke: InvokeFn, args: SendStudyArgs): Promise<SendStudyResult> {
  const body: Record<string, unknown> = {
    book: args.book, chapter: args.chapter, message: args.message,
    include_notes: args.includeNotes ?? false,
    note_ids: args.noteIds ?? [],
    translation: args.translation,
  };
  if (args.threadId) body.thread_id = args.threadId;
  const { data, error } = await invoke('lamplight-study', { body });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply ?? '', citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- src/notepad/study/study-chat-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the stream client**

Add to `src/notepad/study/study-stream-client.test.ts` (mirror its existing `fetch` mock + body-parse pattern). Example self-contained block:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeStudyStreamInvoke } from './study-stream-client';

function fakeClient() {
  return { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } } as never;
}
function okSseResponse() {
  return {
    ok: true,
    headers: { get: (k: string) => (k === 'content-type' ? 'text/event-stream' : null) },
    body: null,
  } as never;
}

describe('study-stream-client thread_id', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('includes thread_id in the POST body when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okSseResponse());
    const invoke = makeStudyStreamInvoke(fakeClient());
    await invoke({ book: 'rom', chapter: 8, message: 'hi', threadId: 'thread-1' }, { onEvent: vi.fn() });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
    expect(body.thread_id).toBe('thread-1');
  });

  it('omits thread_id when not provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okSseResponse());
    const invoke = makeStudyStreamInvoke(fakeClient());
    await invoke({ book: 'rom', chapter: 8, message: 'hi' }, { onEvent: vi.fn() });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
    expect('thread_id' in body).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- src/notepad/study/study-stream-client.test.ts`
Expected: FAIL — body has no `thread_id`.

- [ ] **Step 7: Implement in `study-stream-client.ts`**

Add `threadId?: string` to `StreamStudyArgs`:

```typescript
export interface StreamStudyArgs {
  book: string;
  chapter: number;
  message: string;
  includeNotes?: boolean;
  noteIds?: string[];
  translation?: string;
  mode?: 'chat' | 'insight';
  threadId?: string;
}
```

In `makeStudyStreamInvoke`, after the `if (args.mode) body.mode = args.mode;` line:

```typescript
    if (args.mode) body.mode = args.mode;
    if (args.threadId) body.thread_id = args.threadId;
```

- [ ] **Step 8: Run to confirm pass**

Run: `npm test -- src/notepad/study/study-stream-client.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/notepad/study/study-chat-client.ts src/notepad/study/study-chat-client.test.ts src/notepad/study/study-stream-client.ts src/notepad/study/study-stream-client.test.ts
git commit -m "feat(study): thread_id passthrough on buffered + streaming send clients (B1)"
```

---

## Task 6: `threadId` arg on `useStudyChatThread` (load a specific thread)

**Files:**
- Modify: `src/notepad/study/useStudyChatThread.ts`
- Test: `src/notepad/study/useStudyChatThread.test.ts`

**Interfaces:**
- Produces: `useStudyChatThread(book, chapter, userId, threadId?)`. When `threadId` is provided, the hook loads **that** thread's messages directly (skips the passage→active-thread lookup). When absent, behavior is exactly as today. `book`/`chapter` remain the **reader's** passage and continue to drive `archiveAndReset`.

- [ ] **Step 1: Write the failing test**

Add to `src/notepad/study/useStudyChatThread.test.ts`:

```typescript
  it('loads a specific thread directly when threadId is supplied (skips the passage lookup)', async () => {
    // maybeSingle would be the passage→active-thread lookup; it must NOT be used.
    maybeSingle.mockResolvedValue({ data: { id: 'SHOULD_NOT_BE_USED' }, error: null });
    setOrderResult({
      data: [{ id: 'm9', role: 'assistant', content: 'resumed', citations: [] }],
      error: null,
    });
    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1', 'thread-42'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m9']);
    expect(eqMsg).toHaveBeenCalledWith('thread_id', 'thread-42');
    expect(maybeSingle).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/notepad/study/useStudyChatThread.test.ts`
Expected: FAIL — the hook ignores the 4th arg and calls `maybeSingle`.

- [ ] **Step 3: Implement the optional `threadId`**

In `src/notepad/study/useStudyChatThread.ts`, change the signature:

```typescript
export function useStudyChatThread(book: string, chapter: number, userId: string | null, threadId?: string): UseStudyChatThreadResult {
```

In the effect's async IIFE, branch the thread-id source (replace the block from `const thread = await supabase...` through the `if (!threadId) {...}` guard):

```typescript
    (async () => {
      let tid: string | null = threadId ?? null;
      if (!tid) {
        const thread = await supabase
          .from('lamplight_chat_threads')
          .select('id')
          .eq('user_id', userId)
          .eq('passage_ref', passageRef)
          .eq('surface', 'study')
          .eq('archived', false)
          .maybeSingle();
        if (cancelled) return;
        if (thread.error) { setError(thread.error.message); setLoading(false); return; }
        tid = (thread.data as { id?: string } | null)?.id ?? null;
      }
      if (!tid) { setMessages([]); setLoading(false); return; }

      const { data, error: mErr } = await supabase
        .from('lamplight_chat_messages')
        .select('id, role, content, citations')
        .eq('thread_id', tid)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (mErr) { setError(mErr.message); setMessages([]); }
      else setMessages((data ?? []) as StudyThreadMessage[]);
      setLoading(false);
    })();
```

Add `threadId` to the effect dependency array:

```typescript
  }, [passageRef, userId, nonce, threadId]);
```

- [ ] **Step 4: Run the full hook test file**

Run: `npm test -- src/notepad/study/useStudyChatThread.test.ts`
Expected: PASS (new test + all existing tests, including `archiveAndReset` which still operates on `passageRef`).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/useStudyChatThread.ts src/notepad/study/useStudyChatThread.test.ts
git commit -m "feat(study): optional threadId on useStudyChatThread to load a specific thread (B1)"
```

---

## Task 7: History label helper (pure)

**Files:**
- Create: `src/notepad/study/history-label.ts`
- Test: `src/notepad/study/history-label.test.ts`

**Interfaces:**
- Consumes: `bookByAbbrev` (from `@/notepad/bible/bible-books`).
- Produces:
  - `formatRelativeTime(iso: string, now: number): string` — `"just now"` / `"N minute(s)/hour(s)/day(s) ago"`.
  - `formatHistoryLabel(book: string, chapter: number, updatedAtIso: string, now: number): string` — e.g. `"Romans 8 · 2 days ago"`. Falls back to the raw abbrev for unknown books.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/history-label.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatHistoryLabel } from './history-label';

const NOW = Date.parse('2026-06-29T12:00:00Z');

describe('formatRelativeTime', () => {
  it('buckets seconds/minutes/hours/days with correct pluralization', () => {
    expect(formatRelativeTime('2026-06-29T11:59:30Z', NOW)).toBe('just now');
    expect(formatRelativeTime('2026-06-29T11:59:00Z', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime('2026-06-29T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime('2026-06-27T12:00:00Z', NOW)).toBe('2 days ago');
  });
});

describe('formatHistoryLabel', () => {
  it('resolves the book name and joins with the relative time', () => {
    expect(formatHistoryLabel('rom', 8, '2026-06-27T12:00:00Z', NOW)).toBe('Romans 8 · 2 days ago');
  });
  it('falls back to the raw abbrev for an unknown book', () => {
    expect(formatHistoryLabel('zzz', 3, '2026-06-29T11:59:30Z', NOW)).toBe('zzz 3 · just now');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/notepad/study/history-label.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/notepad/study/history-label.ts`:

```typescript
// Pure label helpers for the Study conversation-history list.
import { bookByAbbrev } from '@/notepad/bible/bible-books';

// "just now" / "N minute(s)/hour(s)/day(s) ago", driven by an injectable `now`.
export function formatRelativeTime(iso: string, now: number): string {
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

// "Romans 8 · 2 days ago" — book abbrev resolved to its display name.
export function formatHistoryLabel(book: string, chapter: number, updatedAtIso: string, now: number): string {
  const name = bookByAbbrev(book)?.name ?? book;
  return `${name} ${chapter} · ${formatRelativeTime(updatedAtIso, now)}`;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- src/notepad/study/history-label.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/history-label.ts src/notepad/study/history-label.test.ts
git commit -m "feat(study): pure history-label helpers (book name + relative time)"
```

---

## Task 8: `useStudyChatHistory` hook (global history list)

**Files:**
- Create: `src/notepad/study/useStudyChatHistory.ts`
- Test: `src/notepad/study/useStudyChatHistory.test.ts`

**Interfaces:**
- Produces: `useStudyChatHistory(userId: string | null): { items: StudyHistoryItem[]; loading: boolean; error: string | null; reload: () => void }` where `StudyHistoryItem = { threadId: string; book: string; chapter: number; title: string; updatedAt: string }`. Queries `lamplight_chat_threads` where `user_id = userId AND surface = 'study'`, ordered `updated_at desc`, limit 50 (RLS scopes to the user). Includes archived and active threads.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/useStudyChatHistory.test.ts` (mirror the `vi.hoisted` chainable-mock pattern from `useStudyChatThread.test.ts`):

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { from, select, eq, order, limit, setResult } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn();
  const order = vi.fn();
  const limit = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  return { from, select, eq, order, limit, setResult: (v: { data: unknown; error: unknown }) => { result = v; },
    _get: () => result };
}) as never as {
  from: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn>; setResult: (v: { data: unknown; error: unknown }) => void;
};

// Rebuild the builder so the terminal `.limit()` resolves to the current result.
const builder: Record<string, unknown> = {};
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useStudyChatHistory } from './useStudyChatHistory';

let current: { data: unknown; error: unknown };
beforeEach(() => {
  vi.clearAllMocks();
  current = { data: [], error: null };
  builder.select = select.mockReturnValue(builder);
  builder.eq = eq.mockReturnValue(builder);
  builder.order = order.mockReturnValue(builder);
  builder.limit = limit.mockImplementation(() => Promise.resolve(current));
  from.mockReturnValue(builder);
  setResult.toString(); // no-op to satisfy lints if unused
});
afterEach(cleanup);

describe('useStudyChatHistory', () => {
  it('maps rows to items and queries study surface ordered by updated_at desc, limit 50', async () => {
    current = {
      data: [
        { id: 't1', book: 'rom', chapter: 8, title: 'Paul', updated_at: '2026-06-29T12:00:00Z' },
        { id: 't2', book: 'jhn', chapter: 10, title: 'Shepherd', updated_at: '2026-06-28T12:00:00Z' },
      ],
      error: null,
    };
    const { result } = renderHook(() => useStudyChatHistory('u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([
      { threadId: 't1', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-29T12:00:00Z' },
      { threadId: 't2', book: 'jhn', chapter: 10, title: 'Shepherd', updatedAt: '2026-06-28T12:00:00Z' },
    ]);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq).toHaveBeenCalledWith('surface', 'study');
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('returns [] without querying when there is no user', async () => {
    const { result } = renderHook(() => useStudyChatHistory(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a query error', async () => {
    current = { data: null, error: { message: 'boom' } };
    const { result } = renderHook(() => useStudyChatHistory('u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.items).toEqual([]);
  });
});
```

> If the `vi.hoisted` typing above proves awkward in practice, simplify to the exact builder shape used in `useStudyChatThread.test.ts` (plain `vi.hoisted` returning the spies, terminal method returning `Promise.resolve(result)`). The assertions on `eq`/`order`/`limit`/mapping are the contract that must hold.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/notepad/study/useStudyChatHistory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/notepad/study/useStudyChatHistory.ts`:

```typescript
// src/notepad/study/useStudyChatHistory.ts
// Global, newest-first list of every Study conversation for the signed-in user
// (across all passages, archived + active). RLS already scopes rows to the user.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface StudyHistoryItem {
  threadId: string;
  book: string;
  chapter: number;
  title: string;
  updatedAt: string;
}

export interface UseStudyChatHistoryResult {
  items: StudyHistoryItem[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const HISTORY_LIST_LIMIT = 50;

export function useStudyChatHistory(userId: string | null): UseStudyChatHistoryResult {
  const [items, setItems] = useState<StudyHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setItems([]);

    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    (async () => {
      const { data, error: qErr } = await supabase
        .from('lamplight_chat_threads')
        .select('id, book, chapter, title, updated_at')
        .eq('user_id', userId)
        .eq('surface', 'study')
        .order('updated_at', { ascending: false })
        .limit(HISTORY_LIST_LIMIT);
      if (cancelled) return;
      if (qErr) { setError(qErr.message); setItems([]); setLoading(false); return; }
      const rows = (data ?? []) as Array<{ id: string; book: string; chapter: number; title: string | null; updated_at: string }>;
      setItems(rows.map((r) => ({
        threadId: r.id, book: r.book, chapter: r.chapter, title: r.title ?? '', updatedAt: r.updated_at,
      })));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId, nonce]);

  return { items, loading, error, reload };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- src/notepad/study/useStudyChatHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/useStudyChatHistory.ts src/notepad/study/useStudyChatHistory.test.ts
git commit -m "feat(study): useStudyChatHistory hook — global newest-first conversation list (B1)"
```

---

## Task 9: Panel — selected conversation, header, history view, resume, reset

**Files:**
- Modify: `src/notepad/study/panes/LamplightStudyPanel.tsx`
- Test: `src/notepad/study/panes/LamplightStudyPanel.test.tsx`

**Interfaces:**
- Consumes: `useStudyChatThread(book, chapter, userId, threadId?)` (Task 6), `useStudyChatHistory(userId)` (Task 8), `formatHistoryLabel` (Task 7), `sendStudyMessage`/`streamStudyMessage` with `threadId` (Task 5).
- Produces: a panel with a header row (active-conversation label + **New conversation** + **History** buttons), an in-panel history view, and selected-conversation state:
  - `{ mode: 'passage' }` — default; grounds on the reader's open `book`/`chapter`.
  - `{ mode: 'thread', threadId, book, chapter }` — reopened from history; grounds on its own chapter; sends carry `threadId`.

- [ ] **Step 1: Add the history mock + write the failing tests**

In `src/notepad/study/panes/LamplightStudyPanel.test.tsx`, add a mock for the history hook near the other `vi.mock` calls (top of file):

```typescript
const historyItems: Array<{ threadId: string; book: string; chapter: number; title: string; updatedAt: string }> = [];
vi.mock('../useStudyChatHistory', () => ({
  useStudyChatHistory: () => ({ items: historyItems, loading: false, error: null, reload: vi.fn() }),
}));
```

Update the `useStudyChatThread` mock so it can capture the `threadId` arg it is called with (replace the existing mock factory):

```typescript
const studyThreadCalls: Array<unknown[]> = [];
vi.mock('../useStudyChatThread', () => ({
  useStudyChatThread: (...args: unknown[]) => {
    studyThreadCalls.push(args);
    return {
      messages: studyThreadMessages,
      loading: false,
      error: null,
      append: vi.fn((msgs: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: unknown[] }>) => {
        studyThreadMessages.push(...msgs);
      }),
      reload: vi.fn(),
      archiveAndReset: vi.fn().mockResolvedValue(undefined),
    };
  },
}));
```

Add a new describe block (keep the existing ones):

```typescript
describe('LamplightStudyPanel history + resume', () => {
  beforeEach(() => { historyItems.length = 0; studyThreadCalls.length = 0; sendStudyMessage.mockReset(); streamStudyMessage.mockReset(); });
  afterEach(() => { studyThreadMessages.length = 0; historyItems.length = 0; studyThreadCalls.length = 0; });

  it('shows New conversation + History controls in the header', () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /history/i })).toBeTruthy();
  });

  it('opens the history list and reopens a conversation in thread mode', () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    // Label uses the history-label helper → "Romans 8 · …"
    const item = screen.getByText(/romans 8 ·/i);
    fireEvent.click(item);
    // After reopening, the thread hook is called with the thread's id.
    const lastCall = studyThreadCalls[studyThreadCalls.length - 1];
    expect(lastCall[3]).toBe('thread-42');
  });

  it('resume send carries threadId + the thread\'s book/chapter (not the reader\'s)', async () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'done', payload: { ok: true, reply: 'ok', citations: [], offered_notes: [] } });
    });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(screen.getByText(/romans 8 ·/i));
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'connect to psalm 23?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(streamStudyMessage).toHaveBeenCalled());
    const sentArgs = streamStudyMessage.mock.calls[0][0] as { book: string; chapter: number; threadId?: string };
    expect(sentArgs.book).toBe('rom');
    expect(sentArgs.chapter).toBe(8);
    expect(sentArgs.threadId).toBe('thread-42');
  });

  it('New conversation archives + returns to passage mode', async () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    // reopen a thread first
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(screen.getByText(/romans 8 ·/i));
    // now start a new conversation
    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));
    await waitFor(() => {
      const lastCall = studyThreadCalls[studyThreadCalls.length - 1];
      expect(lastCall[3]).toBeUndefined(); // back to passage mode → no threadId
    });
  });

  it('resets to passage mode when the reader navigates to a new chapter', () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    const { rerender } = render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(screen.getByText(/romans 8 ·/i));
    rerender(<LamplightStudyPanel book="jhn" chapter={11} userId="u1" />);
    const lastCall = studyThreadCalls[studyThreadCalls.length - 1];
    expect(lastCall[3]).toBeUndefined(); // navigation dropped the reopened thread
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- src/notepad/study/panes/LamplightStudyPanel.test.tsx`
Expected: FAIL — no header controls, no history view, no thread-mode send.

- [ ] **Step 3: Implement selection state + header + history view in the panel**

Edit `src/notepad/study/panes/LamplightStudyPanel.tsx`.

(a) Add imports at the top:

```typescript
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, History as HistoryIcon } from 'lucide-react';
import { useStudyChatHistory } from '../useStudyChatHistory';
import { formatHistoryLabel } from '../history-label';
```

(b) Define the selection type above the component:

```typescript
type StudySelection =
  | { mode: 'passage' }
  | { mode: 'thread'; threadId: string; book: string; chapter: number };
```

(c) Inside `LamplightStudyPanel`, add selection + history-view state and derive the grounding passage. Place this just after the existing `const { translation } = useBiblePrefs();` line, and change the `useStudyChatThread` call:

```typescript
  const { translation } = useBiblePrefs();
  const [selection, setSelection] = useState<StudySelection>({ mode: 'passage' });
  const [showHistory, setShowHistory] = useState(false);
  const selectedThreadId = selection.mode === 'thread' ? selection.threadId : undefined;
  const groundBook = selection.mode === 'thread' ? selection.book : book;
  const groundChapter = selection.mode === 'thread' ? selection.chapter : chapter;
  // book/chapter (reader's passage) drive archiveAndReset; selectedThreadId loads a reopened thread.
  const thread = useStudyChatThread(book, chapter, userId, selectedThreadId);
  const history = useStudyChatHistory(userId);
```

(d) Reset selection + close history when the reader navigates (add near the other hooks):

```typescript
  // Reader navigation drops any reopened thread and returns to the open chapter.
  useEffect(() => {
    setSelection({ mode: 'passage' });
    setShowHistory(false);
  }, [book, chapter]);
```

(e) Change `bufferedSend` and the streaming `streamInvoke(...)` call to use `groundBook`/`groundChapter` and include `threadId`. In `bufferedSend`:

```typescript
  const bufferedSend = useCallback(async (message: string, includeIds: string[]) => {
    const res = await sendStudyMessage(invoke, {
      book: groundBook, chapter: groundChapter, message,
      includeNotes: includeIds.length > 0,
      noteIds: includeIds,
      translation,
      threadId: selectedThreadId,
    });
    if (!res.ok) { setError(friendlyError(res.reason)); return; }
    thread.append([{ id: `a-${Date.now()}`, role: 'assistant', content: res.reply, citations: res.citations }]);
    notes.setOffered(res.offeredNotes);
  }, [groundBook, groundChapter, translation, selectedThreadId, thread, notes]);
```

In `doSend`, update the `streamInvoke(...)` args:

```typescript
        await streamInvoke(
          { book: groundBook, chapter: groundChapter, message, includeNotes: includeIds.length > 0, noteIds: includeIds, translation, threadId: selectedThreadId },
          { onEvent, onStart: () => { started = true; } },
        );
```

And update `doSend`'s dependency array to include the new values:

```typescript
  }, [groundBook, groundChapter, translation, selectedThreadId, thread, notes, streamInvoke, bufferedSend]);
```

(f) Add the New conversation + reopen handlers (place after `send`/`bringInNote`):

```typescript
  const newConversation = useCallback(async () => {
    setSelection({ mode: 'passage' });
    setShowHistory(false);
    notes.reset();
    setError(null);
    await thread.archiveAndReset();
  }, [thread, notes]);

  const openThread = useCallback((item: { threadId: string; book: string; chapter: number }) => {
    setSelection({ mode: 'thread', threadId: item.threadId, book: item.book, chapter: item.chapter });
    setShowHistory(false);
    notes.reset();
    setError(null);
  }, [notes]);

  const now = useMemo(() => Date.now(), [history.items]);
  const headerLabel = selection.mode === 'thread'
    ? formatHistoryLabel(groundBook, groundChapter, '', now).split(' · ')[0]
    : `${groundBook.toUpperCase()} ${groundChapter}`;
```

> `headerLabel` for thread mode reuses the book-name half of `formatHistoryLabel`; for passage mode show the open chapter. (A nicer book-name label for passage mode can use `bookByAbbrev`, but the reader already shows the full name elsewhere — keep this minimal.)

(g) Add the header row as the first child inside the outer container `<div style={{ display: 'flex', flexDirection: 'column', height: '100%', ... }}>`, before the scroll area:

```typescript
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--pale-stone)', flex: '0 0 auto' }}>
        <div style={{ fontSize: 11, color: 'var(--silica)', letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {headerLabel}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button type="button" aria-label="New conversation" title="New conversation" disabled={!signedIn}
            onClick={() => void newConversation()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--silica)', borderRadius: 6, cursor: signedIn ? 'pointer' : 'not-allowed' }}>
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" aria-label="History" title="History" disabled={!signedIn}
            onClick={() => setShowHistory((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--silica)', borderRadius: 6, cursor: signedIn ? 'pointer' : 'not-allowed' }}>
            <HistoryIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
```

(h) Render the history view. Immediately after the header row, conditionally replace the scroll area with the list when `showHistory` is true. Wrap the existing scroll `<div style={{ flex: 1, overflow: 'auto', ... }}>...</div>` so it only renders when `!showHistory`, and add the history list for the `showHistory` case:

```typescript
      {showHistory ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {history.loading && <div style={{ padding: 16, color: 'var(--silica)', fontSize: 12 }}>Loading…</div>}
          {history.error && <div style={{ padding: 16, color: '#b00', fontSize: 12 }}>Couldn’t load history. Please try again.</div>}
          {!history.loading && !history.error && history.items.length === 0 && (
            <div style={{ padding: 16, color: 'var(--silica)', fontSize: 12 }}>No past conversations yet.</div>
          )}
          {history.items.map((it) => (
            <button key={it.threadId} type="button" onClick={() => openThread(it)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--deep-umber)', cursor: 'pointer', fontSize: 13 }}>
              {formatHistoryLabel(it.book, it.chapter, it.updatedAt, now)}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column' }}>
          {/* ...existing messages / streaming / offered-notes / error content unchanged... */}
        </div>
      )}
```

Move the existing scroll-area children (empty state, `thread.messages.map`, `streamingContent`, offered notes, `error`) inside the `!showHistory` branch's `<div>` exactly as they are today.

- [ ] **Step 4: Run the panel tests**

Run: `npm test -- src/notepad/study/panes/LamplightStudyPanel.test.tsx`
Expected: PASS — new history/resume block + all pre-existing notes-on-offer / refined-flat / streaming tests still green.

- [ ] **Step 5: Typecheck + lint the touched frontend files**

Run: `npx tsc -b`
Expected: no new errors.

Run: `npm run lint`
Expected: no **new** lint errors beyond the ~114 baseline (compare counts if unsure).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/study/panes/LamplightStudyPanel.tsx src/notepad/study/panes/LamplightStudyPanel.test.tsx
git commit -m "feat(study): conversation history + resume-in-place in the Study chat panel (B1)"
```

---

## Task 10: Full verification + deploy notes

**Files:** none (verification only).

- [ ] **Step 1: Run the full study test surface**

Run: `npm test -- supabase/functions/lamplight-study/ src/notepad/study/`
Expected: PASS for every study test file (backend + frontend).

- [ ] **Step 2: Confirm zero-new-errors against the baseline**

Run: `npx tsc -b`
Expected: only the known `force-sphere.test.ts` errors (4), no new ones.

Run: `npm run lint`
Expected: lint-error count unchanged from the ~114 baseline (no new errors in any file you touched).

Run: `npm test`
Expected: only the two known-failing files (`Editor.toolbar-placement`, `garden-scene`) still fail; nothing you touched regressed.

- [ ] **Step 3: Manual smoke checklist (record results, do not auto-run)**

After deploying the edge function locally or to a preview:
- Ask a cross-book question in Study chat ("How does John 10 connect to Psalm 23?") → reply may cite a verse outside the open chapter; the cited verse text is the supplied/translation-correct text; the voice stays non-prophetic.
- Open History → see past conversations newest-first with `"Book N · time ago"` labels.
- Reopen a conversation from another chapter → messages show read-only; send a message → it appends to that thread and grounds on the thread's chapter (not the reader's open chapter).
- New conversation → archives the reader's current passage conversation and returns to an empty passage-mode chat.
- Navigate the reader to a new chapter while a reopened thread is showing → panel resets to the open chapter.

- [ ] **Step 4: Deploy the edge function (manual — NOT carried by a frontend deploy)**

```bash
supabase functions deploy lamplight-study --use-api
```

- [ ] **Step 5: Branch finalization**

Use `superpowers:finishing-a-development-branch`. Before opening the PR, rebase onto `main` (this branch carries the import-notes commits as ancestors; `main` may be RED until interlinear PR #57 merges — verify the baseline, do not gate on repo-wide green).

---

## Self-Review (completed against the spec)

- **A — broader answers:** Task 1 (retrieval + `allowedVerseRefs` expansion + dedupe + graceful degradation) and Task 2 (prompt reframe + related-passages render + version bump). ✔
- **B — conversation history + resume-in-place:** Task 3 (`thread_id` parse), Task 4 (`verifyStudyThread` + resume grounding in both streaming and buffered branches), Task 6 (`threadId` load), Task 7 (label helper), Task 8 (history hook), Task 9 (panel UI, header, history view, New conversation, reader-nav reset, resume send). ✔
- **Non-goals honored:** no migration; threads stay passage-anchored; journaling chat untouched (optional `relatedPassages` left undefined); no pagination/search (limit 50). ✔
- **Voice principle:** preserved verbatim in spirit in the Task 2 system prompt; citations stay "supplied-only." ✔
- **Error handling:** retrieval failure → `[]` (Task 1); `thread_not_found` 404 surfaced via the panel's `friendlyError` (Tasks 4/9 — add `thread_not_found` to the friendly map if a bespoke message is wanted; default falls through to the generic message); history query error → inline message (Task 9). ✔
- **Type consistency:** `relatedPassages: Array<{ ref; text }>`, `VerifiedStudyThread`, `StudyHistoryItem`, `StudySelection`, and the `threadId` arg/field names are used identically across producing and consuming tasks. ✔
- **Testing:** every backend testable unit (`selectRelatedPassages`, `retrieveRelatedPassages`, prompt `buildMessages`, `parseStudyBody` thread_id, `verifyStudyThread`) and frontend unit (clients, `useStudyChatThread` threadId, `formatHistoryLabel`, `useStudyChatHistory`, panel flows) has a failing-first test. `index.ts` wiring stays thin glue (consistent with the existing untested `index.ts`). ✔

**One open UI choice deferred to execution:** the history view here *replaces* the message area (simplest, testable). An overlay is equally acceptable — the assertions (label text + reopen behavior) hold either way.
