# Auto-Verse Completion — Design

**Date:** 2026-06-15
**Status:** Approved design → ready for implementation plan
**Scope:** Add a unified, deliberate verse-insertion system to the notepad editor: type a
reference and complete it inline, or open a `/verse` picker and search by reference,
phrase, or keyword. Each insertion becomes one two-state node (collapsed reference link ↔
expanded verse card) that is also a first-class citizen of the existing reference graph.

## Summary

Today the notepad only *detects* verse references typed in prose (the `bibleVerse`
decoration Mark) and feeds them to the reference graph via regex. There is no way to
deliberately insert a verse, see its text, or search Scripture by phrase when you don't
know the reference.

This feature adds **one verse-insertion system with two entry points** that share a single
dropdown UI and a single insertion path:

- **B — predictive reference.** As you type a book name (no trigger char), a dropdown
  completes it to a specific verse with a text preview. For "I know the reference."
- **C — `/verse` picker.** A trigger opens a picker that searches by reference **or**
  phrase/keyword (hybrid keyword-FTS + semantic). For "I don't know the reference."

Both insert the same object: a `scriptureRef` inline atom node that renders **collapsed**
as `📖 John 3:16` (default) or **expanded** as a verse card, and that feeds the existing
`ReferenceGraph` with a canonical OSIS id — a more reliable graph signal than regex.

This is **v1, BSB-only**. Translation is stored as a labeled field on the node so
multi-translation is a clean future extension; there is no translation-picker UI.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Interaction model | **B + C combined** — one system, two entry points, shared dropdown + shared insertion command |
| Insertion output / rendering | **Unified two-state node** — collapsed = styled reference link (default); expanded = verse card. Click toggles. |
| Collapse state storage | **Ephemeral, NodeView-local React state** (default collapsed). View state never dirties the doc. |
| C's search backend | **Hybrid** — route reference-vs-text, FTS instant per keystroke, semantic on a trailing debounce, merge+dedupe by OSIS |
| Pericope-grain semantic hits | **Include & resolve** — resolve a whole-pericope hit to a single ranged node, labeled distinctly |
| Translation | **BSB-only** for v1; `translation` stored as a labeled node field; no picker UI |
| Offline behavior | **Graceful degrade + lazy-fill** — references parse/insert offline; verse text persists in the note and backfills on reconnect; phrase search shows a "needs connection" state |
| Data model | **Real Tiptap node, first-class graph citizen** — node carries canonical OSIS + fields; feeds the existing `ReferenceGraph` |
| Editor mechanism (Approach A) | Both entry points run through Tiptap's **Suggestion utility** (two configs, one dropdown), inserting via one `insertScriptureRef` command |

## Chosen approach: A (two Suggestion configs, one dropdown, one node)

Of three approaches considered, we chose **A** over B (a bespoke completion plugin for the
predictive path) and C (ship the `/verse` picker first, add predictive completion as a
follow-on). A routes *both* entry points through Tiptap's battle-tested Suggestion utility
— keyboard navigation, ProseMirror decorations, and positioning come for free — and
delivers the full locked B+C model in one shipment. The predictive (B) path uses
Suggestion's `findSuggestionMatch` override to match book-name patterns instead of a fixed
trigger char; the `/verse` (C) path uses a char trigger. The risk in A — B's matcher
false-firing mid-prose — is contained by only matching at a word boundary with a chapter
digit present, and by leaving the existing `bibleVerse` Mark to keep decorating plain-prose
references. Approach C remains the natural fallback (it is "A, phased") if a smaller first
PR is ever wanted.

## Architecture

Four units, with the hard logic kept framework-agnostic so the Tiptap layer stays thin and
the search/graph logic is unit-testable without an editor. The editor never talks to
Supabase or the graph directly — it calls `searchVerses()` / `completeReference()` and
`insertScriptureRef()`; everything else sits behind those interfaces.

```
Tiptap editor (use-note-editor.ts)
  └─ scriptureRef Node (inline atom)
       ├─ addProseMirrorPlugins() → 2 Suggestion configs (B predictive, C /verse)
       ├─ ReactNodeViewRenderer → collapsed link ↔ expanded card
       └─ command: insertScriptureRef(attrs)
            │ B → completeReference()      C → searchVerses()
            ▼                                ▼
   verse-search (framework-free)        VerseSuggestList (React)
     searchVerses(query, {signal})       shared dropdown for B & C
     completeReference(partial, {signal})
       • route ref vs keyword
       • FTS instant (client → Supabase)
       • semantic debounced (edge fn → match_bible_embeddings)
       • merge / dedupe by osis
       └─ uses reference-parser (existing): parseVerseRef, fetchVerseText, BOOK_PATTERNS

   verse-node-graph-sync (thin)
     extend parseReferencesFromContent to walk scriptureRef nodes
       └─ feeds ReferenceGraph (existing) + refreshVerseText backfill
```

**New / changed units:**

1. **`scriptureRef` Tiptap Node** *(new)* — the only unit that knows about Tiptap. Inline
   atom node, two Suggestion plugins, React NodeView. Registered in `use-note-editor.ts`.
   Named `scriptureRef` to avoid colliding with the existing `bibleVerse` Mark.
2. **`verse-search` module** *(new, framework-free)* — owns ref-vs-keyword routing, the FTS
   query, the debounced semantic call, and merge/dedupe. Testable with no editor.
3. **`VerseSuggestList` React component** *(new)* — the shared dropdown for both entry
   points. Pure presentation: candidates in, select callback out, plus loading/offline
   states.
4. **`verse-node-graph-sync`** *(new, thin)* — extends the graph's existing
   `parseReferencesFromContent` chokepoint to be node-aware; runs from the existing
   post-save hook.

**Reused unchanged:** `reference-parser` (`parseVerseRef`, `fetchVerseText`,
`BOOK_PATTERNS`, `BOOK_TO_OSIS`); `ReferenceGraph` (+ `refreshVerseText` for lazy-fill);
the `bibleVerse` Mark (keeps decorating refs typed in plain prose — orthogonal to
deliberate insertions).

**Net-new dependency:** `@tiptap/suggestion@^3.22.5` (the low-level Suggestion utility;
neither it nor `@tiptap/extension-mention` is currently installed). We build our own node,
so the Mention wrapper is not needed.

**Net-new backend:** one migration adding an FTS `tsvector` generated column + GIN index to
`bible_passages` (confirmed absent today). Semantic search reuses the existing
`match_bible_embeddings` RPC.

## The `scriptureRef` node

**Type.** Inline **atom** node (`inline: true, atom: true`) — Tiptap's documented pattern
for a self-contained, non-editable inline object. Atom because the verse text is canonical
Scripture and must not be editable like normal prose. It lives in the paragraph flow;
expanded, its NodeView wrapper renders a block-like card.

**Data model (attributes)** — aligned 1:1 with the graph's `ScriptureNode` fields so the
graph sync is a near-direct map:

| attr | type | purpose |
|---|---|---|
| `osis` | `string` | canonical id (`"jhn.3.16"`) — dedupe + graph key |
| `book` | `string` | canonical book name (`"John"`) |
| `chapter` | `number` | |
| `verseStart` | `number` | |
| `verseEnd` | `number \| null` | null = single verse; set = range |
| `translation` | `string` | `"BSB"` — labeled field; clean seam for future translations |
| `text` | `string` | the verse text — serialized into the note so inserted verses render offline |

Tiptap persists node attributes inside the doc JSON (which *is* `note.content`), so `text`
travels with the note automatically — no extra storage.

**Two render states** (one `ReactNodeViewRenderer`):
- **Collapsed (default on insert):** inline styled reference link — `📖 John 3:16`.
- **Expanded:** verse card — verse text + a small `BSB` translation label + a collapse
  control.
- Clicking toggles. **Collapse state is local React state** (ephemeral, default collapsed):
  toggling is purely visual, never dirties the doc, and resets to collapsed on reload.
  Locked decision requires only "default collapsed," which this satisfies.

**Serialization (`parseHTML` / `renderHTML`).** `renderHTML` emits
`<span data-scripture-ref data-osis=… data-book=… …>` whose *visible text is the reference
label* (`John 3:16`), with the verse text in a data attribute. This makes copy-paste and
HTML-derived extraction see a recognizable `John 3:16`. `parseHTML` round-trips a
pasted/reloaded node back into a real `scriptureRef`, and **rejects** malformed input
(missing/invalid `data-osis`) so a bad paste degrades to plain text rather than a broken
node.

> Note: the `renderHTML` label aids *HTML/clipboard* extraction only. The JSON-based
> extractors (the graph, search index) do **not** see an atom node's label, because an atom
> carries no text child in the JSON — see "Graph integration."

**Insertion.** One Tiptap command, `insertScriptureRef(attrs)`, replaces the active
suggestion range with the node. Both Suggestion configs (B and C) call it — a single
insertion path.

## Data flow — the two entry points

### Entry point B — predictive reference (no trigger char)

The Suggestion config's `findSuggestionMatch` matches `BOOK_PATTERNS` (all 66 books) against
the text before the cursor; the "query" is a partial reference (`John 3:16`). To avoid
false-firing mid-prose, it only matches at a word boundary with a chapter digit present.
This path is **reference-only** — no FTS, no semantic. It calls
`completeReference(partial)`: parse locally, and once book+chapter+verse resolve, fetch a
text preview via `fetchVerseText`. The dropdown shows the one resolved verse; Enter inserts.
Before enough is typed, the dropdown shows a "keep typing…" hint.

### Entry point C — `/verse` keyword picker

A char trigger (`/verse`) opens the picker over free text (a reference, a phrase, or loose
keywords). It calls `searchVerses(query, { signal })`, which runs three things and merges:

1. **Route.** Try `parseVerseRef(query)`. If it parses, **pin that exact verse at the top**
   (reusing the B path) and still run keyword search in case the input is partial.
2. **FTS — instant, every keystroke.** Query the net-new `text_tsv` column via supabase-js
   `.textSearch('text_tsv', query, { type: 'websearch' })`, filtered `translation = 'BSB'`
   (public-read RLS already exists). Lexical, fast, returns verse-grain rows.
3. **Semantic — trailing ~250ms debounce, only at ≥3 chars.** Never per-keystroke. The
   query must be embedded by **Voyage server-side** (the key must never reach the client),
   so this path is a thin **edge function: embed query → `match_bible_embeddings(vector(512),
   limit)`**. An `AbortController` cancels stale in-flight requests (the same `signal`
   pattern `fetchVerseText` already uses).

### Merge / dedupe / ranking

All hits normalize to a `VerseCandidate`:

```ts
type VerseCandidate = {
  osis: string
  book: string
  chapter: number
  verseStart: number
  verseEnd: number | null
  text: string
  translation: 'BSB'
  source: 'reference' | 'fts' | 'semantic'
  score: number
}
```

Candidates are **deduped by `osis`** — a verse matched by both FTS and semantic collapses
into one (boosted). Order: pinned reference first, then ranked by a normalized score
(semantic similarity, FTS matches boosted for exact phrase). v1 keeps ranking a simple,
documented heuristic rather than a tuned formula.

### Pericope-grain semantic hits (resolve)

`match_bible_embeddings` returns a **mix** of verse-grain (`source_id = "jhn.3.16"`) and
**whole-pericope** (`source_id = "jhn.3"`) hits — both are embedded (`scripts/ingest-bsb.ts`).
A pericope hit can't insert as a single verse, so we **resolve** it: detect grain by
dot-segment count (3 = verse, 2 = pericope), look up `bible_passages WHERE pericope_id =
source_id` to get `min(verse_start)..max(verse_end)` + book/chapter, and present it as a
single **ranged** candidate labeled distinctly (e.g. `John 3:1–21 · passage`). The node's
`verseStart`/`verseEnd` range maps cleanly to one ranged node. This preserves passage-level
recall for the "I don't know the reference" case at the cost of one extra query.

## Offline & lazy-fill

- **Reference entry (B) works offline.** Parse is local; the node inserts collapsed with
  `text` empty; the label still reads `📖 John 3:16` (derived from the ref, not the text).
- **Already-inserted verses render offline.** `text` is persisted in the node.
- **Keyword search (C) is online-only.** The picker shows a "needs connection" state
  offline; reference entry inside the picker still works (local parse).
- **Lazy-fill.** When a node mounts with empty `text` **and** the app is online, the
  NodeView calls `fetchVerseText(osis)` once and writes `text` back — a legitimate content
  backfill (it persists the verse). The graph's own `refreshVerseText` independently
  backfills its `ScriptureNode` copy. Both reuse one fetch path.

## Graph integration (node-aware extractor)

The graph already walks structured content: `computeSyncForNote`
(`reference-graph.ts:299`) calls `parseReferencesFromContent` (`reference-parser.ts:337`),
which converts the Tiptap JSON to plain text via `extractPlainText` and runs `VERSE_REGEX`.
That single chokepoint is where we extend.

**An atom node carries no text child in the JSON**, so the JSON→plain-text walk does **not**
see a `scriptureRef`. (The `renderHTML` `John 3:16` label only helps HTML/clipboard
extraction.) A **node-aware extractor is therefore required**, not optional. This also
resolves the handoff's open question.

The change is minimal and DRY: teach `parseReferencesFromContent` to *also* collect
`scriptureRef` **nodes** (walk by node type — the node analog of the existing `walkMarks`),
emitting their canonical `osis` + `book/chapter/verseStart/verseEnd/text` into the same
`ScriptureNode` path. Payoffs:

- **More reliable than regex** — the canonical `osis` comes directly from the node.
- **Natural dedupe** — a verse both typed in prose *and* inserted as a node maps to the same
  deterministic `ScriptureNode` id, so it counts once.
- **Downstream unchanged** — TSK cross-ref expansion, `BacklinksPanel`, `InfoPanel` verse
  counts, and `connection-discovery` all keep working through the one extended function.
- **Trigger point:** the existing post-save hook (`onAfterSave`, `use-note-editor.ts:73-84`),
  already where Lamplight embeddings are fed, and which already swallows errors (graph sync
  is best-effort).

## Error handling

| Failure | Behavior |
|---|---|
| Offline / no Supabase client | `fetchVerseText` → `null`; node inserts collapsed, `text` empty, label still shows; lazy-fill retries on reconnect |
| Semantic edge fn error / timeout | Degrade silently to **FTS + reference** results; picker stays usable |
| FTS query error | Empty/error state in picker; never crashes the editor |
| Stale in-flight request | `AbortController` cancels; `AbortError` ignored (not surfaced) |
| Verse genuinely absent in BSB | Insert anyway as a reference link with empty text (graceful) |
| Malformed paste (bad/missing `data-osis`) | `parseHTML` rejects → falls back to plain text, no broken node |
| Graph sync throws | Swallowed in `onAfterSave` (best-effort, pre-existing behavior) |

## Testing strategy

Aligns with the repo's Vitest patterns (`*.test.ts`). Because the hard logic lives in the
framework-free `verse-search` module, most of it tests with no editor and no real network.

1. **`verse-search` module (TDD-first).** Inject the data-access boundary (FTS query fn +
   semantic edge fn) so tests are pure. Cover: ref-vs-keyword routing; FTS + semantic
   normalization to `VerseCandidate`; grain detection + pericope resolution (2-segment osis
   → ranged candidate, 3-segment → single verse); merge/dedupe by `osis` (collapse + boost,
   reference pinned first); debounce (fake timers — semantic only on the trailing delay at
   ≥3 chars, FTS every keystroke); `AbortController` cancels stale requests and `AbortError`
   is swallowed.
2. **`scriptureRef` node (headless Tiptap editor, jsdom).** `insertScriptureRef` produces
   correct attrs; serialization round-trip preserves all attrs and rejects malformed input;
   **toggling collapse does not change `editor.getJSON()`** (guards the local-state
   decision); lazy-fill (mocked `fetchVerseText`): empty `text` + online → fetch + write
   back; offline → stays empty, label shown.
3. **Suggestion matchers.** B's `findSuggestionMatch` fires on book patterns at word
   boundaries but **not** mid-prose ("I read a book" must not trigger) — tested as a pure
   function; C's `/verse` trigger opens the picker and `command` wires to
   `insertScriptureRef`.
4. **Node-aware graph extraction.** A doc with a `scriptureRef` node yields the right
   `ScriptureNode`/edges; the same verse in prose **and** as a node counts once.
5. **`VerseSuggestList` (React Testing Library).** Renders candidate rows; select callback
   fires; "needs connection" (offline) and loading (semantic pending) states render.

**Deliberately out of automated scope (manual smoke tests):** live visual of the collapsed
link vs expanded card; real semantic relevance quality; FTS relevance against the real BSB
corpus (ingest is a separate sub-project); the full offline-insert → reconnect → backfill
cycle.

**Baseline discipline:** the repo ships with pre-existing red tests/lint. Success = these
changes add **zero new** failures and the touched-file subset is green — not a repo-wide
green gate.

## Open planning items (resolve while writing the plan)

- **Query-embedding seam.** Confirm whether an existing lamplight edge function already
  exposes query embedding (embed arbitrary text → vector(512)) that the semantic path can
  reuse, or whether a small net-new edge function is required. Either way, the Voyage key
  stays server-side.
- **FTS column shape.** Final `to_tsvector` config (language, which column(s)) and whether
  to use a stored generated column vs an expression index; confirm `.textSearch` query type
  (`websearch` vs `plain`).
- **Graph sync trigger.** Confirm whether `ReferenceGraph.syncNote` is already invoked from
  the post-save path or needs wiring there alongside the node-aware extraction.
- **Ranking heuristic.** Pin the exact v1 score-blend (how FTS rank and semantic similarity
  combine) — a documented heuristic, not a tuned model.

## Out of scope (YAGNI for v1)

- Multiple translations / a translation-picker UI (the `translation` field is the seam).
- Tuned/learned ranking; relevance feedback logging (`lamplight_suggestions_log` could
  capture picker outcomes later, but not in v1).
- Inline rendering of verse text in the *collapsed* state (collapsed is a link by design).
- Editing verse text (atom node; text is canonical).

## Verified code references (as of 2026-06-15)

| Fact | Location |
|---|---|
| `ReferenceGraph` state `{ references, scriptureNodes }`; keys `notepad_graph_references` / `notepad_scripture_nodes` | `reference-graph.ts:23-30` |
| `syncNote` / `syncAll` / `init` / `deleteReferencesFor` | `reference-graph.ts:106 / 116 / 145 / 132` |
| `refreshVerseText` keeps existing text on null/offline | `reference-graph.ts:160` (best-effort at ~171) |
| `computeSyncForNote` → `parseReferencesFromContent` | `reference-graph.ts:299` → `reference-parser.ts:337` |
| `BOOK_PATTERNS` (66), `VERSE_REGEX`, `BOOK_TO_OSIS`, `parseVerseRef`, `walkMarks`, `fetchVerseText` | `reference-parser.ts:5 / 89 / 110 / 206 / 237 / 141` |
| `fetchVerseText` queries `bible_passages (id, verse_start, text)`; returns `null` offline | `reference-parser.ts:141-162` |
| `bible_passages` OSIS-id PK + `(book,chapter)` / `pericope` indexes; **no FTS index** | `supabase/migrations/009_bible_passages.sql:4-16` |
| `lamplight_embeddings` final dim **vector(512)**; `chunk_index`/`chunk_text` present; `user_id` nullable (CHECK) | `008` (created) → `016:23-33`; `011:8` (nullability) |
| `match_bible_embeddings(p_query_vector vector(512), p_limit int default 50)`; filters `user_id is null AND source_type='bible_passage'` | `supabase/migrations/016_lamplight_voyage_context_3.sql:72-94` |
| Both verses **and** pericopes embedded (mixed grain) | `scripts/ingest-bsb.ts:177, 206-223` |
| `extractVerseRefs(text): string[]` | `src/notepad/extensions/bible-verse-utils.ts:20` |
| Existing detection is a **Mark** named `bibleVerse` (not a node) | `src/notepad/extensions/bible-verse.ts:11` |
| Editor extensions + 500ms debounce + `onAfterSave` hook | `src/notepad/editor/use-note-editor.ts:56-63, 40, 21, 73-84` |
| Tiptap `^3.22.5`; `@tiptap/{starter-kit,react,placeholder,pm,underline}` installed; `@tiptap/suggestion` / `extension-mention` **not** installed | `package.json` |
