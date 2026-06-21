# Multiple Bible Translations (BSB + KJV + WEB)

**Status:** Approved design — ready for implementation planning
**Date:** 2026-06-20
**Branch:** `feat/bible-translations`

## Goal

Add two public-domain translations — **KJV** (King James Version) and **WEB**
(World English Bible) — alongside the existing **BSB** (Berean Standard Bible),
so readers can choose which version they read, search, and quote. All three are
public domain: we ingest, store, index, and serve them ourselves with no API
dependency or licensing cost.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Translations to add | KJV + WEB (public domain) | Most-requested formal text (KJV) + a modern readable text (WEB). |
| Search depth | **Shared semantic index** | Embed only BSB. Semantic search returns the verse *reference*; we render it in the reader's chosen translation. Avoids a ~62k-verse Voyage re-embed and an embeddings-key redesign. |
| Selector model | **Global default + per-reader override** | A saved preference (default BSB) applies everywhere; a dropdown in the reader header overrides on the spot. |
| Preference persistence | localStorage (device, covers anon) mirrored to `profiles.bible_translation` (signed-in cross-device) | Reuses the established `useLamplightSettings` + `local-storage` pattern. |
| Inline `scriptureRef` behavior | **Freeze-at-insert** | A reference captures the active translation when inserted and stays stable. A quote in a note must not silently change. Existing BSB refs are untouched. |

## Background — current architecture

- **Single translation today: BSB**, public domain, stored in the Postgres/Supabase
  table `public.bible_passages` (not a bundled file, not a live API at runtime).
- **Ingest:** `scripts/ingest-bsb.ts` fetches the BSB public-domain TSV, parses it,
  and upserts into `bible_passages` **and** `lamplight_embeddings` (Voyage).
- **`bible_passages` schema** (`009_bible_passages.sql`): `id text primary key`
  (OSIS key `{book}.{chapter}.{verse}`, e.g. `jhn.1.1`; whole-chapter "pericope"
  rows use `{book}.{chapter}`), plus `book`, `chapter`, `verse_start`, `verse_end`,
  `translation` (always `'BSB'` today), `text`, `pericope_id`. **Dual-grain:** the
  table holds both verse rows and whole-chapter aggregate rows. Later migrations
  add `text_tsv` generated FTS column (`030`) and a `pg_trgm` index (`031`).
- **Embeddings:** `lamplight_embeddings` holds Bible verses as rows with
  `user_id IS NULL`, `source_type = 'bible_passage'`, `source_id = bible_passages.id`.
  The `match_bible_embeddings` RPC filters `user_id is null AND source_type='bible_passage'`
  — no translation filter.
- **Translation-agnostic reference data** (no per-translation duplication needed):
  `bible_highlights` (`027`, keyed by OSIS `verse_id`, no translation column),
  `bible_books` (`032`, study metadata), `bible_cross_references` (`033`, OSIS links).
- **Read paths today hardcode `'BSB'` or omit the filter** assuming a single
  translation — including `useBiblePassages.ts` (no translation filter at all) and
  the `fetchVerseText`/`scriptureRef` return literals.
- **Vestigial `'WEB'` defaults:** `reference-graph.ts`, `graph-view.ts`,
  `project-graph.ts` default freshly-created scripture nodes to `'WEB'` before the
  fetch overwrites the text. Harmless while WEB didn't exist; a real bug once it does.

### The hard blocker

`bible_passages.id` is `{book}.{chapter}.{verse}` with **no translation segment**,
and it is the primary key. A second translation's `jhn.1.1` collides with BSB's
`jhn.1.1`. This must be fixed before any second translation can be stored.

## Design

### 1. Data model — the one schema change

Keep `id` as the **pure OSIS reference** and change `bible_passages`'s primary key
to the composite **`(translation, id)`**.

- Existing BSB rows already have `translation = 'BSB'` → no collision, no data rewrite.
- This deliberately preserves the shared-reference design: `bible_highlights.verse_id`,
  `bible_cross_references`, and `lamplight_embeddings.source_id` all key off the pure
  OSIS reference and are **untouched**.
- `text_tsv` (FTS) and the trigram index are per-row → KJV/WEB rows get them
  automatically on insert. No index changes needed.

Migration: drop the single-column PK, add the composite PK `(translation, id)`.

### 2. Ingest — generalize the existing script

Refactor `scripts/ingest-bsb.ts` into a parameterized ingest taking a `translation`
and a source adapter:

- Reuse the existing book-name→OSIS map and the dual-grain logic (emit verse rows
  **and** whole-chapter pericope aggregate rows), setting `translation` per run.
- KJV and WEB load from clean public-domain verse-per-line datasets. **Exact source
  URLs are pinned in the implementation plan** (must be verifiably public domain and
  book-name-mappable to our OSIS scheme; sources cached under `scripts/data/`).
- **KJV/WEB ingest skips the `lamplight_embeddings` upsert entirely** — this is the
  cost savings from the shared semantic index. (BSB ingest is unchanged and still
  embeds.)
- After each ingest, a **parity check** diffs the new translation's OSIS key set
  against BSB and reports any missing/extra keys (versification gaps) for review.

### 3. Search & Lamplight — embed once, display many

- **Semantic search** stays BSB-only in `lamplight_embeddings`. It returns a verse
  *reference* (`source_id` = OSIS); the consumer then fetches that reference's text
  in the reader's chosen translation. No re-embed, no embeddings-key change, no RPC
  change.
- **FTS / keyword** works natively per translation — `verse-search-client.ts`
  (`ftsSearch`) and the trigram prefix lookups add a `.eq('translation', …)` filter.
- **Lamplight retrieval** (`supabase/functions/_shared/retrieval.ts`,
  `_shared/bible-passage.ts`, `_shared/verse-verify.ts`, and the `lamplight-generate`
  / `lamplight-chat` / `lamplight-study` consumers) takes a `translation` parameter
  (from the user's preference, default `'BSB'`), fetches matched references in that
  translation, and **falls back to BSB** for any verse missing in the chosen version.

### 4. Frontend

- **Central registry** `src/notepad/bible/translations.ts`: a `BibleTranslation`
  union (`'BSB' | 'KJV' | 'WEB'`) plus per-translation display label, full name, and
  attribution string. Every scattered `translation: 'BSB'` literal type imports from
  here (`verse-search-types.ts`, `scripture-ref.ts`, etc.).
- **`useBiblePassages(book, chapter, translation)`** gains the translation argument
  and a `.eq('translation', …)` filter (today it has none — a latent double-count
  once a second translation exists).
- **Translation dropdown** in the `BibleReader` header (next to the book/chapter
  control). Reflects the active translation; switching re-fetches the chapter.
- **`useBibleTranslation` hook** modeled on `useLamplightSettings`: localStorage-backed
  for device-level persistence (covers anonymous users), mirrored to a new
  non-privileged **`profiles.bible_translation`** column (default `'BSB'`, owner-update
  RLS) for signed-in cross-device sync. The persisted value is the global default;
  the reader dropdown is the per-reader override.

### 5. Inline Scripture references (`/verse` / `scriptureRef`)

- **Freeze-at-insert:** inserting a reference captures the currently active
  translation into the node's `translation` attr; its wording stays stable thereafter.
- `fetchVerseText` (`reference-parser.ts`) and the `/verse` picker
  (`verse-picker-commands.ts`) take a `translation` parameter and filter on it;
  remove the hardcoded `'BSB'` return literal.
- **Existing notes are unchanged** — their `scriptureRef` nodes already carry
  `translation: 'BSB'`.
- Fix the **vestigial `'WEB'` defaults** in `reference-graph.ts` / `graph-view.ts` /
  `project-graph.ts` to use the actual fetched/active translation rather than a
  literal that is now a real version.
- `ScriptureRefView` already renders `· {translation}`; no change needed there.

### 6. Versification

KJV, WEB, and BSB all follow standard English Protestant versification, so keys
align in the overwhelming majority of cases. Known divergences (e.g. Psalm
superscriptions, a handful of verse-numbering differences) are surfaced by the
ingest parity check (§2) and handled at read time by the **BSB fallback** (§3) so a
reader/AI never sees a blank verse.

### 7. Attribution

The translations registry (§4) carries an attribution string per version:

- **BSB** — public domain (existing).
- **WEB** — public domain; no attribution required, included as courtesy.
- **KJV** — public domain in the US; surface a short note acknowledging the UK Crown
  letters-patent status.

Surface attribution in a small translation-info affordance near the reader's
translation selector.

## Rollout order

1. Migration: composite PK `(translation, id)` on `bible_passages`.
2. Run the generalized ingest for KJV, then WEB (no embeddings).
3. Frontend changes (registry, `useBiblePassages`, reader dropdown, and the
   `useBibleTranslation` hook backed by localStorage — works standalone).
4. `profiles.bible_translation` column (migration) + wire the hook's cross-device
   mirror to it. The column must exist before the mirror write is enabled; the
   localStorage path from step 3 degrades gracefully without it.
5. Edge-function retrieval changes (translation param + BSB fallback).

(Per project memory: migrations apply via `supabase db push`; edge functions deploy
manually via `supabase functions deploy <name> --use-api`. Typecheck with `tsc -b`.)

## Testing

- **Ingest:** expected row-counts per translation; OSIS key parity vs BSB; pericope
  rows generated.
- **Reader:** switching translation re-fetches and shows different text for the same
  reference; highlights persist across a switch (same `verse_id`).
- **Search:** FTS returns per-translation results; semantic returns references
  rendered in the chosen version.
- **Inline refs:** a new `scriptureRef` captures the active translation; existing BSB
  refs are unchanged; hover/tooltip shows the correct text.
- **Lamplight:** quotes the chosen version; falls back to BSB for a verse missing in
  that version.
- **Preference:** persists per device (anon) and cross-device for signed-in users;
  global default vs per-reader override behave as specified.

## Out of scope (YAGNI)

- Copyrighted translations (ESV/NIV/NLT/CSB/NASB) — would require licensing + a live
  API and break the store-and-embed model.
- Per-translation semantic embeddings — explicitly rejected in favor of the shared
  semantic index.
- Per-translation highlight isolation — highlights stay translation-agnostic by OSIS
  reference.
- Side-by-side parallel translation view — not requested; can be a later enhancement.
