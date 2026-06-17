# Design — Split `/verse` (book typeahead) vs new `/lookup` (verse-text search)

**Date:** 2026-06-17 · **Branch:** `feat/scripture-ref-keep-pill`

## Problem

The `/verse` slash command in the notepad editor currently does verse-text
search: keyword-FTS + semantic + verse-text prefix match (`thes` → "These
are…"). The user wants to split this into two distinct commands:

- **`/verse`** → a **book-name typeahead / reference navigator**. Type a book
  prefix, see matching books, pick one to autocomplete to `Romans `, keep
  typing `8:28`, and insert the resolved verse. No text search.
- **`/lookup`** → exactly what `/verse` does **today** (verse-text search),
  under a new trigger word.

Nothing deployed is removed. The verse-text search path simply **moves** from
`/verse` to `/lookup`. Migration `031_bible_passages_text_trgm.sql`, the
`verse-search` edge function, the FTS index, and the prefix-search code all stay
— they now back `/lookup`.

## Confirmed UX decisions

1. **Book order:** best-match first — canonical-name prefix hits rank above
   abbrev-only hits; ties broken by canonical (biblical) order.
2. **Empty state:** when `/verse ` opens with no book letters typed, show all
   66 books (canonical order), narrowing as the user types.
3. **Mid-type state:** after a book is chosen (autocompleted to `Romans `) but
   before a full `ch:vs` is typed, show a hint ("Add chapter:verse, e.g. 8:28").
4. **Resolved row:** once `Romans 8:28` resolves, **fetch and show** the verse
   text in the dropdown as one row (consistent with `/lookup` rows); Enter
   inserts the `scriptureRef` node.

## Architecture

Three Tiptap `Suggestion` plugins live on the `ScriptureRef` node:

- **B — Predictive** (`PREDICTIVE_KEY`, `char:''`): resolves a full ref typed in
  prose and inserts a node. **Unchanged**, except its `allow` gate must stand
  down for the new `/lookup` picker too (today it only checks
  `VERSE_PICKER_KEY`).
- **C — `/verse` picker** (`VERSE_PICKER_KEY`, `char:'/'`): **rebuilt** into the
  book typeahead + reference resolver (below).
- **D — `/lookup` picker** (`LOOKUP_PICKER_KEY`, `char:'/'`): **new**, reuses the
  existing verse-text renderer/search path almost verbatim.

### `/lookup` — move, don't rebuild

The existing path is already the `/lookup` behavior:
`matchVersePickerBeforeCursor` → `renderVerseSuggestList(search)` →
`createVerseSearch` → `VerseSuggestList`.

- Add `matchLookupPickerBeforeCursor` in `scripture-ref-matchers.ts` — a clone
  of `matchVersePickerBeforeCursor` keyed on `/lookup` instead of `/verse`.
- Parameterize the renderer's strip-prefix. `renderVerseSuggestList` currently
  hard-codes `query.replace(/^verse\s*/i, '')`. Pass the command word (or a
  strip regex) in so the same renderer serves both `/verse`-predictive and
  `/lookup`. Default keeps current behavior.
- Register the 3rd `Suggestion` plugin with `LOOKUP_PICKER_KEY`, reusing
  `renderVerseSuggestList(search, { command: 'lookup' })` and an `items` builder
  that strips `/^lookup\s*/i`.
- Predictive `allow`: stand down when **either** `VERSE_PICKER_KEY` **or**
  `LOOKUP_PICKER_KEY` is active.

### `/verse` — book typeahead + reference resolution (rebuilt)

Four display states keyed off the stripped query `q` (query minus `verse `):

| State | Condition | Shows | Select action |
|---|---|---|---|
| A — initial | `q` empty / whitespace only | all 66 books, canonical order | autocomplete |
| B — typing book | `q` is a partial book token (no full ref) | `matchBooks(q)`, best-match first | autocomplete |
| C — book chosen | `q` is `<exact book> ` (+ optional partial `ch` / `ch:`) | hint "Add chapter:verse, e.g. 8:28" | — |
| D — full ref | `q` resolves as `Book ch:vs` | resolved verse row (text fetched) | insert node |

#### New pure function — `matchBooks(query): string[]` (TDD target)

In a new module (e.g. `src/notepad/extensions/book-matcher.ts`), exported and
unit-testable in isolation:

- Normalize the query the same way `parseVerseRef` does: lowercase, strip spaces
  and periods — but keep **prefix** semantics.
- Empty/whitespace query → return all 66 canonical book names in canonical order.
- Otherwise return canonical book names whose canonical name **or** any
  abbreviation (from `BOOK_PATTERNS`) starts with the normalized query.
- **Ordering (best-match first):**
  - score 0: the canonical name (first entry of the `BOOK_PATTERNS` line) starts
    with the normalized query;
  - score 1: only a non-canonical name/abbrev starts with it;
  - ties broken by canonical order (index in `BOOK_PATTERNS`).
- Numbered books: `1` → all eight `1 X` books; `1c` → 1 Chronicles,
  1 Corinthians; `1 c` normalizes to `1c` (same result).
- No match → `[]`.

#### Discriminated item type

```ts
type BookItem  = { kind: 'book'; book: string };          // canonical name
type VerseItem = { kind: 'verse'; candidate: VerseCandidate };
type BookOrVerseItem = BookItem | VerseItem;
```

#### Routing (the `/verse` picker)

- Strip `verse ` from the query → `q`.
- If `q` resolves as a full reference (`routeQuery`/`parseVerseRef`) → State D:
  asynchronously resolve via `completeReference(q, search)` (fetches text) and
  show one `VerseItem` row.
- Else if `q` matches `<exact complete book> ` followed by an optional partial
  chapter/`:` but no complete verse → State C: hint, empty list.
- Else → States A/B: `matchBooks(q)` mapped to `BookItem[]`.

#### Select behavior

- `BookItem` → **autocomplete**: rewrite the trigger range text to
  `/verse <Book> ` (trailing space) and leave the picker open. The matcher
  re-fires on the new text and lands in State C. This is a command path distinct
  from node insertion.
- `VerseItem` → insert the `scriptureRef` node via the existing
  `insertFromCandidate` mechanic (`deleteRange` + `insertScriptureRef`).

#### New renderer + list component

- New `renderBookPicker(search)` in a new renderer module — owns the async
  resolve for State D, the state routing, and selection branching.
- New `BookSuggestList` component rendering: book rows (State A/B), the resolved
  verse row (State D), and hints (State C / loading). The existing
  `VerseSuggestList` is left untouched for `/lookup` + predictive.

## What stays untouched

- Predictive plugin (B) still resolves refs typed in prose.
- `createVerseSearch`, prefix search, `verse-search` edge fn, migration 030/031,
  FTS + trgm indexes — all kept; now serve `/lookup`.
- `VerseSuggestList.tsx` — unchanged.

## Testing

- **`matchBooks` (pure fn) — TDD first:** empty → all 66 in canonical order;
  `r` → Ruth, Romans, Revelation (canonical tie-break); `rom` → Romans first;
  `rev` → Revelation; `1` → eight `1 X` books; `1c` / `1 c` → 1 Chronicles,
  1 Corinthians; abbrev-only hit (`jn` → John); normalization (periods/spaces);
  no match → `[]`; best-match ordering (canonical-name hit above abbrev hit).
- **`matchLookupPickerBeforeCursor`:** clone of the existing verse-matcher tests
  (`/lookup`, `/lookup love`, word-boundary rejects `/lookups`).
- **Picker-state routing:** A/B/C/D selection and autocomplete-keeps-open,
  following `scripture-ref.suggestion.test.ts` patterns. Predictive `allow`
  stands down for both pickers.

## Verification baseline

- `npx tsc -b` clean (NOT bare `tsc --noEmit`).
- Keep the four green suites green (`verse-search`, `verse-search-client`,
  `scripture-ref.suggestion`, `scripture-ref.editor`) and add the new suites.
- Pre-existing red, ignore: `BibleReader.test.tsx` (jsdom `matchMedia`).

## Out of scope

- Chapter/verse drill-down lists for `/verse` ("autocomplete, keep typing" only).
- Any deploy/push (branch work stays local until the user asks).
</content>
</invoke>
