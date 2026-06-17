# /verse Book Typeahead + /lookup Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the notepad `/verse` slash command into `/verse` (book-name typeahead → reference resolution) and `/lookup` (today's verse-text search), inserting a `scriptureRef` node either way.

**Architecture:** Three Tiptap `Suggestion` plugins on the `ScriptureRef` node: predictive (B, unchanged), `/verse` picker (C, rebuilt into a book typeahead), and a new `/lookup` picker (D, reuses today's verse-text renderer/search). A pure `matchBooks` function and a pure `routeVersePicker` view-router carry the `/verse` logic and are unit-tested in isolation; a new `BookSuggestList` + `renderBookPicker` render the `/verse` dropdown, while the existing `VerseSuggestList`/`renderVerseSuggestList`/`createVerseSearch` are reused verbatim (parameterized strip-prefix) for `/lookup`.

**Tech Stack:** TypeScript, React, Tiptap (`@tiptap/core`, `@tiptap/suggestion`, `@tiptap/react`), Vitest (+ jsdom for editor tests).

## Global Constraints

- Typecheck with `npx tsc -b` (NOT bare `tsc --noEmit` — root tsconfig has `files:[]`).
- Keep the four green suites green: `verse-search.test.ts`, `verse-search-client.test.ts`, `scripture-ref.suggestion.test.ts`, `scripture-ref.editor.test.ts`.
- Pre-existing red, do NOT chase: `BibleReader.test.tsx` fails on jsdom `window.matchMedia`.
- Do NOT remove or revert: migration `031_bible_passages_text_trgm.sql`, the `verse-search` edge fn, prefix search, `createVerseSearch`, or `VerseSuggestList.tsx`. They now back `/lookup`.
- Canonical book name = the **first** entry of each `BOOK_PATTERNS` line in `src/notepad/graph/reference-parser.ts`.
- Book matching normalization = lowercase + strip spaces and periods (matches `parseVerseRef`), with **prefix** semantics.
- No deploy/push — branch work stays local until the user asks.
- Run a single Vitest file with: `npx vitest run <path>`.

---

### Task 1: `matchBooks` pure function

Pure, framework-free book prefix matcher — the `/verse` typeahead core. Best-match-first ordering (canonical-name prefix hits above abbrev-only hits; ties by canonical order). Empty query → all 66 books in canonical order.

**Files:**
- Create: `src/notepad/extensions/book-matcher.ts`
- Test: `src/notepad/extensions/book-matcher.test.ts`

**Interfaces:**
- Consumes: `BOOK_PATTERNS` from `../graph/reference-parser`.
- Produces: `export function matchBooks(query: string): string[]` — array of canonical book names.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/extensions/book-matcher.test.ts
import { describe, it, expect } from 'vitest';
import { matchBooks } from './book-matcher';

describe('matchBooks', () => {
  it('returns all 66 books in canonical order for an empty query', () => {
    const all = matchBooks('');
    expect(all).toHaveLength(66);
    expect(all[0]).toBe('Genesis');
    expect(all[65]).toBe('Revelation');
  });

  it('treats a whitespace-only query as empty', () => {
    expect(matchBooks('   ')).toHaveLength(66);
  });

  it('"r" → Ruth, Romans, Revelation (canonical tie-break)', () => {
    expect(matchBooks('r')).toEqual(['Ruth', 'Romans', 'Revelation']);
  });

  it('"rom" → Romans only', () => {
    expect(matchBooks('rom')).toEqual(['Romans']);
  });

  it('"rev" → Revelation only', () => {
    expect(matchBooks('rev')).toEqual(['Revelation']);
  });

  it('"1" → the eight numbered "1 X" books in canonical order', () => {
    expect(matchBooks('1')).toEqual([
      '1 Samuel', '1 Kings', '1 Chronicles', '1 Corinthians',
      '1 Thessalonians', '1 Timothy', '1 Peter', '1 John',
    ]);
  });

  it('"1c" → 1 Chronicles, 1 Corinthians (canonical order)', () => {
    expect(matchBooks('1c')).toEqual(['1 Chronicles', '1 Corinthians']);
  });

  it('"1 c" normalizes to the same result as "1c"', () => {
    expect(matchBooks('1 c')).toEqual(['1 Chronicles', '1 Corinthians']);
  });

  it('matches an abbreviation-only hit ("jn" → John)', () => {
    expect(matchBooks('jn')).toEqual(['John']);
  });

  it('"john" → John via canonical name', () => {
    expect(matchBooks('john')).toEqual(['John']);
  });

  it('ignores trailing periods (abbrev style "ps.")', () => {
    expect(matchBooks('ps.')).toEqual(['Psalms']);
  });

  it('ranks a canonical-name prefix hit above an abbrev-only hit', () => {
    // "mat" — Matthew canonical starts with "mat" (score 0). No abbrev-only
    // book outranks it, so Matthew leads.
    expect(matchBooks('mat')[0]).toBe('Matthew');
  });

  it('returns [] when nothing matches', () => {
    expect(matchBooks('zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/book-matcher.test.ts`
Expected: FAIL — `matchBooks` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/extensions/book-matcher.ts
import { BOOK_PATTERNS } from '../graph/reference-parser';

// Normalize a book token the same way parseVerseRef does (lowercase, strip
// spaces and periods) — but matchBooks keeps PREFIX semantics.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s.]/g, '');
}

// Pre-compute, per BOOK_PATTERNS line: the canonical name (first entry), its
// canonical biblical index, and the normalized forms of every accepted name.
const BOOKS = BOOK_PATTERNS.map((line, index) => {
  const names = line.split('|');
  return { canonical: names[0], index, norms: names.map(normalize) };
});

/**
 * Returns canonical book names whose canonical name OR any abbreviation starts
 * with `query` (normalized), best-match-first: a canonical-name prefix hit
 * (score 0) ranks above an abbrev-only hit (score 1); ties break by canonical
 * (biblical) order. An empty/whitespace query returns all 66 books in canonical
 * order. No match returns [].
 */
export function matchBooks(query: string): string[] {
  const q = normalize(query);
  if (q === '') return BOOKS.map((b) => b.canonical);

  const hits: Array<{ canonical: string; score: number; index: number }> = [];
  for (const b of BOOKS) {
    const canonHit = b.norms[0].startsWith(q);
    const anyHit = canonHit || b.norms.some((n) => n.startsWith(q));
    if (anyHit) hits.push({ canonical: b.canonical, score: canonHit ? 0 : 1, index: b.index });
  }
  hits.sort((a, b) => a.score - b.score || a.index - b.index);
  return hits.map((h) => h.canonical);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/extensions/book-matcher.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/book-matcher.ts src/notepad/extensions/book-matcher.test.ts
git commit -m "feat(notepad): matchBooks book-prefix typeahead (pure fn)"
```

---

### Task 2: `routeVersePicker` view-router + item type

Pure function mapping the stripped `/verse` query to one of three views (book list / hint / resolve), plus the discriminated item type the renderer and command path share. This is the State A/B/C/D routing logic, testable without the editor.

**Files:**
- Modify: `src/notepad/extensions/book-matcher.ts`
- Test: `src/notepad/extensions/book-matcher.test.ts`

**Interfaces:**
- Consumes: `matchBooks` (Task 1); `routeQuery` from `../bible/verse-search`; `BOOK_PATTERNS` from `../graph/reference-parser`; `VerseCandidate` from `../bible/verse-search-types`.
- Produces:
  - `export type BookItem = { kind: 'book'; book: string }`
  - `export type VerseItem = { kind: 'verse'; candidate: VerseCandidate }`
  - `export type BookOrVerseItem = BookItem | VerseItem`
  - `export type VersePickerView = { kind: 'books'; books: string[] } | { kind: 'hint' } | { kind: 'resolve'; query: string }`
  - `export function routeVersePicker(query: string): VersePickerView`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/notepad/extensions/book-matcher.test.ts
import { routeVersePicker } from './book-matcher';

describe('routeVersePicker', () => {
  it('empty query → books view with all 66', () => {
    const v = routeVersePicker('');
    expect(v.kind).toBe('books');
    if (v.kind === 'books') expect(v.books).toHaveLength(66);
  });

  it('partial book token → books view (State B)', () => {
    const v = routeVersePicker('rom');
    expect(v).toEqual({ kind: 'books', books: ['Romans'] });
  });

  it('complete book + trailing space → hint (State C)', () => {
    expect(routeVersePicker('Romans ')).toEqual({ kind: 'hint' });
  });

  it('complete book + chapter, no colon → hint (State C)', () => {
    expect(routeVersePicker('Romans 8')).toEqual({ kind: 'hint' });
  });

  it('complete book + chapter + colon, no verse → hint (State C)', () => {
    expect(routeVersePicker('Romans 8:')).toEqual({ kind: 'hint' });
  });

  it('numbered book + trailing space → hint (State C)', () => {
    expect(routeVersePicker('1 Corinthians ')).toEqual({ kind: 'hint' });
  });

  it('a bare "1 " is NOT a complete book → still books view', () => {
    const v = routeVersePicker('1 ');
    expect(v.kind).toBe('books');
    if (v.kind === 'books') expect(v.books).toContain('1 Samuel');
  });

  it('a complete book with no trailing space stays in books view (State B)', () => {
    expect(routeVersePicker('Romans')).toEqual({ kind: 'books', books: ['Romans'] });
  });

  it('full reference → resolve view (State D)', () => {
    expect(routeVersePicker('Romans 8:28')).toEqual({ kind: 'resolve', query: 'Romans 8:28' });
  });

  it('full reference range → resolve view', () => {
    expect(routeVersePicker('John 3:16-18')).toEqual({ kind: 'resolve', query: 'John 3:16-18' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/book-matcher.test.ts`
Expected: FAIL — `routeVersePicker` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/notepad/extensions/book-matcher.ts
import { routeQuery } from '../bible/verse-search';
import type { VerseCandidate } from '../bible/verse-search-types';

export type BookItem = { kind: 'book'; book: string };
export type VerseItem = { kind: 'verse'; candidate: VerseCandidate };
export type BookOrVerseItem = BookItem | VerseItem;

export type VersePickerView =
  | { kind: 'books'; books: string[] }
  | { kind: 'hint' }
  | { kind: 'resolve'; query: string };

// A complete book name/abbrev (BOOK_PATTERNS alternation) followed by whitespace
// and an OPTIONAL partial chapter/colon (but no complete verse — those parse as a
// full reference and are handled before this fires). This is the "book chosen,
// awaiting chapter:verse" state. Anchored to the whole stripped query so the
// trailing space after an autocompleted book ("Romans ") lands here, while a
// still-typing book ("Romans", no space) does not.
const bookGroup = `(?:${BOOK_PATTERNS.join('|')})`;
const BOOK_CHOSEN = new RegExp(`^${bookGroup}\\s+\\d{0,3}:?\\d{0,3}$`, 'i');

/**
 * Routes the stripped /verse query (query minus the leading "verse ") to a view:
 * - full reference → resolve (caller fetches verse text async),
 * - complete book awaiting chapter:verse → hint,
 * - otherwise → the book list (empty query = all 66).
 */
export function routeVersePicker(query: string): VersePickerView {
  if (routeQuery(query).kind === 'reference') return { kind: 'resolve', query };
  if (BOOK_CHOSEN.test(query)) return { kind: 'hint' };
  return { kind: 'books', books: matchBooks(query) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/extensions/book-matcher.test.ts`
Expected: PASS (Task 1 + Task 2 cases).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/book-matcher.ts src/notepad/extensions/book-matcher.test.ts
git commit -m "feat(notepad): routeVersePicker view-router + book/verse item types"
```

---

### Task 3: `matchLookupPickerBeforeCursor`

Trigger matcher for the new `/lookup` command — a clone of `matchVersePickerBeforeCursor` keyed on `/lookup`.

**Files:**
- Modify: `src/notepad/extensions/scripture-ref-matchers.ts`
- Test: `src/notepad/extensions/scripture-ref-matchers.test.ts`

**Interfaces:**
- Consumes: `SuggestionTextMatch` type (already in `scripture-ref-matchers.ts`).
- Produces: `export function matchLookupPickerBeforeCursor(textBeforeCursor: string): SuggestionTextMatch | null` — `query` is the matched run minus the leading "/" (e.g. `/lookup love` → `lookup love`).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/notepad/extensions/scripture-ref-matchers.test.ts
import { matchLookupPickerBeforeCursor } from './scripture-ref-matchers';

describe('matchLookupPickerBeforeCursor', () => {
  it('matches the bare /lookup command', () => {
    const m = matchLookupPickerBeforeCursor('/lookup');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('lookup');
    expect(m!.from).toBe(0);
  });

  it('matches /lookup followed by keywords (spaces allowed)', () => {
    const m = matchLookupPickerBeforeCursor('/lookup these are the words');
    expect(m!.query).toBe('lookup these are the words');
  });

  it('matches /lookup after whitespace mid-paragraph', () => {
    const text = 'note: /lookup grace';
    const m = matchLookupPickerBeforeCursor(text);
    expect(m!.query).toBe('lookup grace');
    expect(m!.from).toBe(6);
    expect(m!.to).toBe(text.length);
  });

  it('does NOT fire on other slash words or on /verse', () => {
    expect(matchLookupPickerBeforeCursor('/verse')).toBeNull();
    expect(matchLookupPickerBeforeCursor('/todo')).toBeNull();
  });

  it('does NOT fire on words that merely start with lookup', () => {
    expect(matchLookupPickerBeforeCursor('/lookups')).toBeNull();
    expect(matchLookupPickerBeforeCursor('/lookuplove')).toBeNull();
  });

  it('does NOT fire mid-word', () => {
    expect(matchLookupPickerBeforeCursor('and/lookup')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/scripture-ref-matchers.test.ts`
Expected: FAIL — `matchLookupPickerBeforeCursor` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/notepad/extensions/scripture-ref-matchers.ts
// The /lookup keyword command — identical shape to the /verse picker matcher,
// keyed on "/lookup". The word boundary after "lookup" (\s or end) keeps
// "/lookups" and "/lookuplove" from triggering.
const LOOKUP_TRIGGER_AT_END = /(?:^|\s)(\/lookup(?:\s.*)?)$/i;

/**
 * Returns the /lookup-command match anchored at the end of `textBeforeCursor`,
 * or null. `query` is the matched run minus the leading "/", so
 * "/lookup these" → "lookup these". The picker's items/renderer strip the
 * leading "lookup" the same way the /verse path strips "verse".
 */
export function matchLookupPickerBeforeCursor(textBeforeCursor: string): SuggestionTextMatch | null {
  const m = LOOKUP_TRIGGER_AT_END.exec(textBeforeCursor);
  if (!m) return null;
  const full = m[1];
  const to = textBeforeCursor.length;
  const from = to - full.length;
  return { from, to, query: full.slice(1) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/extensions/scripture-ref-matchers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/scripture-ref-matchers.ts src/notepad/extensions/scripture-ref-matchers.test.ts
git commit -m "feat(notepad): matchLookupPickerBeforeCursor trigger matcher"
```

---

### Task 4: Wire `/lookup` — parameterized renderer strip + 3rd plugin + predictive gate

Deliver a working `/lookup` command: it reuses the existing verse-text renderer/search verbatim. Parameterize the renderer's strip-prefix (the only `/verse`-specific bit), register a 3rd Suggestion plugin keyed on `/lookup`, and make the predictive `allow` gate stand down for either picker.

**Files:**
- Modify: `src/notepad/extensions/verse-suggest-renderer.tsx`
- Modify: `src/notepad/extensions/scripture-ref.ts`
- Test: `src/notepad/extensions/scripture-ref.suggestion.test.ts`

**Interfaces:**
- Consumes: `matchLookupPickerBeforeCursor` (Task 3); existing `renderVerseSuggestList`, `buildReferencePinItems`.
- Produces: `renderVerseSuggestList(search, opts?: { command?: 'verse' | 'lookup' })`; a `LOOKUP_PICKER_KEY` Suggestion plugin (plugin key string `scriptureRefLookup$`).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/notepad/extensions/scripture-ref.suggestion.test.ts
const LOOKUP = 'scriptureRefLookup$';

describe('/lookup picker (verse-text search moved here)', () => {
  it('"/lookup these" opens the lookup picker with the lookup-prefixed query', () => {
    editor = makeEditor();
    type(editor, '/lookup these');
    const lookup = suggestionState(editor, LOOKUP);
    expect(lookup?.active).toBe(true);
    expect(lookup?.query).toBe('lookup these');
  });

  it('predictive stands down while the /lookup picker is active', () => {
    editor = makeEditor();
    type(editor, '/lookup John 3:16');
    expect(suggestionState(editor, LOOKUP)?.active).toBe(true);
    expect(suggestionState(editor, PREDICTIVE)?.active).toBe(false);
  });

  it('"/verse" does NOT open the lookup picker', () => {
    editor = makeEditor();
    type(editor, '/verse love');
    expect(suggestionState(editor, LOOKUP)?.active).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/scripture-ref.suggestion.test.ts`
Expected: FAIL — no `scriptureRefLookup$` plugin (state undefined / inactive).

- [ ] **Step 3a: Parameterize the renderer strip-prefix**

In `src/notepad/extensions/verse-suggest-renderer.tsx`, change the signature and the one strip site. Replace the function signature line:

```tsx
export function renderVerseSuggestList(
  search: VerseSearchDeps | null = null,
  opts: { command?: 'verse' | 'lookup' } = {},
) {
  const stripRe = new RegExp(`^${opts.command ?? 'verse'}\\s*`, 'i');
```

(Insert the `stripRe` line immediately after the existing `let`/`const` declarations at the top of the function body, before `const verseSearch = ...`.)

Then in `runSearch`, replace:

```tsx
    const q = props.query.replace(/^verse\s*/i, '');
```

with:

```tsx
    const q = props.query.replace(stripRe, '');
```

- [ ] **Step 3b: Add the matcher import and the 3rd plugin**

In `src/notepad/extensions/scripture-ref.ts`, extend the matcher import:

```ts
import { matchReferenceBeforeCursor, matchVersePickerBeforeCursor, matchLookupPickerBeforeCursor } from './scripture-ref-matchers';
```

Add the plugin key beside the others:

```ts
const PREDICTIVE_KEY = new PluginKey('scriptureRefPredictive');
const VERSE_PICKER_KEY = new PluginKey('scriptureRefPicker');
const LOOKUP_PICKER_KEY = new PluginKey('scriptureRefLookup');
```

Update the predictive `allow` gate to check both pickers:

```ts
      allow: ({ state }) => {
        const verse = VERSE_PICKER_KEY.getState(state) as { active?: boolean } | undefined;
        const lookup = LOOKUP_PICKER_KEY.getState(state) as { active?: boolean } | undefined;
        return !verse?.active && !lookup?.active;
      },
```

Add the `/lookup` picker config just before the `return [...]` line (it mirrors the existing `picker`, keyed on `/lookup`):

```ts
    // D — /lookup verse-text picker. This is the verse-text search that /verse
    // used to do (FTS + semantic + prefix), moved verbatim to its own command.
    const lookup: SuggestionOptions<VerseCandidate, VerseCandidate> = {
      editor: this.editor,
      pluginKey: LOOKUP_PICKER_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      command,
      render: () => renderVerseSuggestList(search, { command: 'lookup' }),
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchLookupPickerBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: ({ query }) => {
        if (!/^lookup/i.test(query)) return [];
        const stripped = query.replace(/^lookup\s*/i, '');
        return buildReferencePinItems(stripped);
      },
    };
```

Register it (pickers before predictive so their state is fresh when the predictive `allow` reads it):

```ts
    return [Suggestion(picker), Suggestion(lookup), Suggestion(predictive)];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/extensions/scripture-ref.suggestion.test.ts`
Expected: PASS (new `/lookup` cases + the pre-existing Bug 1/Bug 2/regression cases).

Then confirm the typecheck and the other suites:
Run: `npx tsc -b`  → exit 0.
Run: `npx vitest run src/notepad/extensions/scripture-ref.editor.test.ts src/notepad/extensions/VerseSuggestList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/verse-suggest-renderer.tsx src/notepad/extensions/scripture-ref.ts src/notepad/extensions/scripture-ref.suggestion.test.ts
git commit -m "feat(notepad): add /lookup verse-text picker (reuses existing search path)"
```

---

### Task 5: `applyVerseSelection` command helper

The select-action branching for the `/verse` book picker, extracted into a pure-ish, unit-testable helper: a `BookItem` autocompletes the trigger text to `/verse <Book> ` (picker stays open); a `VerseItem` inserts a `scriptureRef` node.

**Files:**
- Create: `src/notepad/extensions/verse-picker-commands.ts`
- Test: `src/notepad/extensions/verse-picker-commands.test.ts`

**Interfaces:**
- Consumes: `BookOrVerseItem`, `VerseItem` (Task 2); `Editor` type from `@tiptap/core`.
- Produces: `export function applyVerseSelection(editor: Editor, range: { from: number; to: number }, item: BookOrVerseItem): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/extensions/verse-picker-commands.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { applyVerseSelection } from './verse-picker-commands';
import type { VerseCandidate } from '../bible/verse-search-types';

// A recording stub for the Tiptap fluent chain. Every chain method returns the
// same proxy so calls can be inspected after .run().
function makeChainSpy() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const proxy: Record<string, (...a: unknown[]) => unknown> = {};
  const handler = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); return proxy; };
  for (const m of ['focus', 'deleteRange', 'insertScriptureRef', 'insertContentAt', 'run']) proxy[m] = handler(m);
  return { proxy, calls };
}

function makeEditorStub() {
  const { proxy, calls } = makeChainSpy();
  const editor = { chain: () => proxy } as unknown as Editor;
  return { editor, calls };
}

const candidate: VerseCandidate = {
  osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null,
  text: 'And we know that God works all things…', translation: 'BSB', source: 'reference', score: 1,
};

describe('applyVerseSelection', () => {
  it('book item autocompletes the range text to "/verse <Book> " (trailing space)', () => {
    const { editor, calls } = makeEditorStub();
    applyVerseSelection(editor, { from: 1, to: 9 }, { kind: 'book', book: 'Romans' });
    const insert = calls.find((c) => c.method === 'insertContentAt');
    expect(insert).toBeDefined();
    expect(insert!.args[0]).toEqual({ from: 1, to: 9 });
    expect(insert!.args[1]).toBe('/verse Romans ');
    // It must NOT insert a node for a book selection.
    expect(calls.some((c) => c.method === 'insertScriptureRef')).toBe(false);
  });

  it('verse item deletes the range and inserts a scriptureRef node', () => {
    const { editor, calls } = makeEditorStub();
    applyVerseSelection(editor, { from: 1, to: 13 }, { kind: 'verse', candidate });
    expect(calls.some((c) => c.method === 'deleteRange')).toBe(true);
    const insert = calls.find((c) => c.method === 'insertScriptureRef');
    expect(insert).toBeDefined();
    expect(insert!.args[0]).toMatchObject({ osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, translation: 'BSB' });
    // It must NOT autocomplete text for a verse selection.
    expect(calls.some((c) => c.method === 'insertContentAt')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/verse-picker-commands.test.ts`
Expected: FAIL — `applyVerseSelection` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/extensions/verse-picker-commands.ts
import type { Editor } from '@tiptap/core';
import type { BookOrVerseItem } from './book-matcher';

/**
 * Applies a /verse picker selection.
 * - A book item AUTOCOMPLETES: it rewrites the trigger range to "/verse <Book> "
 *   (trailing space) and leaves the cursor after it, so the picker's matcher
 *   re-fires and the dropdown moves into the "awaiting chapter:verse" state.
 * - A verse item INSERTS the scriptureRef node (delete the trigger range first).
 */
export function applyVerseSelection(
  editor: Editor,
  range: { from: number; to: number },
  item: BookOrVerseItem,
): void {
  if (item.kind === 'book') {
    editor.chain().focus().insertContentAt(range, `/verse ${item.book} `).run();
    return;
  }
  const c = item.candidate;
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertScriptureRef({
      osis: c.osis,
      book: c.book,
      chapter: c.chapter,
      verseStart: c.verseStart,
      verseEnd: c.verseEnd,
      translation: 'BSB',
      text: c.text,
    })
    .run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/extensions/verse-picker-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/verse-picker-commands.ts src/notepad/extensions/verse-picker-commands.test.ts
git commit -m "feat(notepad): applyVerseSelection — book autocomplete vs verse-node insert"
```

---

### Task 6: `BookSuggestList` component + `renderBookPicker` renderer

The DOM renderer + list component for the `/verse` book picker: routes each query via `routeVersePicker`, fetches verse text for the resolve state via `completeReference`, and renders book rows / the resolved verse row / hints. Maintains its own item list and keyboard selection.

**Files:**
- Create: `src/notepad/extensions/BookSuggestList.tsx`
- Create: `src/notepad/extensions/book-picker-renderer.tsx`
- Test: `src/notepad/extensions/BookSuggestList.test.tsx`

**Interfaces:**
- Consumes: `routeVersePicker`, `BookOrVerseItem` (Task 2); `applyVerseSelection` (Task 5); `completeReference` from `../bible/verse-search`; `VerseSearchDeps`, `VerseCandidate` from `../bible/verse-search-types`; `SuggestionProps`, `SuggestionKeyDownProps` from `@tiptap/suggestion`; existing `./scripture-ref.css`.
- Produces:
  - `export function BookSuggestList(props: BookSuggestListProps)` — renders rows + hints; props below.
  - `export function renderBookPicker(search: VerseSearchDeps | null)` — Suggestion render-object factory (`onStart`/`onUpdate`/`onKeyDown`/`onExit`).

- [ ] **Step 1: Write the failing test (component-level — the renderer is exercised in Task 7)**

```tsx
// src/notepad/extensions/BookSuggestList.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookSuggestList } from './BookSuggestList';
import type { BookOrVerseItem } from './book-matcher';

const bookItems: BookOrVerseItem[] = [
  { kind: 'book', book: 'Ruth' },
  { kind: 'book', book: 'Romans' },
  { kind: 'book', book: 'Revelation' },
];

describe('BookSuggestList', () => {
  it('renders one row per book and marks the selected one', () => {
    render(<BookSuggestList items={bookItems} selectedIndex={1} onSelect={() => {}} loading={false} hint={null} offline={false} />);
    expect(screen.getByText('Ruth')).toBeTruthy();
    expect(screen.getByText('Romans')).toBeTruthy();
    expect(screen.getByText('Revelation')).toBeTruthy();
    const selected = screen.getByText('Romans').closest('[role="option"]');
    expect(selected?.getAttribute('aria-selected')).toBe('true');
  });

  it('fires onSelect with the clicked item', () => {
    const onSelect = vi.fn();
    render(<BookSuggestList items={bookItems} selectedIndex={0} onSelect={onSelect} loading={false} hint={null} offline={false} />);
    fireEvent.click(screen.getByText('Revelation'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'book', book: 'Revelation' });
  });

  it('renders a resolved verse row with its reference and text', () => {
    const verse: BookOrVerseItem[] = [{
      kind: 'verse',
      candidate: { osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, text: 'And we know…', translation: 'BSB', source: 'reference', score: 1 },
    }];
    render(<BookSuggestList items={verse} selectedIndex={0} onSelect={() => {}} loading={false} hint={null} offline={false} />);
    expect(screen.getByText('Romans 8:28')).toBeTruthy();
    expect(screen.getByText('And we know…')).toBeTruthy();
  });

  it('shows the hint when one is provided and there are no items', () => {
    render(<BookSuggestList items={[]} selectedIndex={0} onSelect={() => {}} loading={false} hint="Add chapter:verse, e.g. 8:28" offline={false} />);
    expect(screen.getByText('Add chapter:verse, e.g. 8:28')).toBeTruthy();
  });

  it('shows the offline message when offline', () => {
    render(<BookSuggestList items={[]} selectedIndex={0} onSelect={() => {}} loading={false} hint={null} offline={true} />);
    expect(screen.getByText('Verse search needs connection')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/BookSuggestList.test.tsx`
Expected: FAIL — `BookSuggestList` module not found.

- [ ] **Step 3a: Write the `BookSuggestList` component**

```tsx
// src/notepad/extensions/BookSuggestList.tsx
import type { BookOrVerseItem } from './book-matcher';
import './scripture-ref.css';

export interface BookSuggestListProps {
  items: BookOrVerseItem[];
  selectedIndex: number;
  onSelect: (item: BookOrVerseItem) => void;
  loading: boolean;
  /** Shown when there are no rows (e.g. the "awaiting chapter:verse" state). */
  hint: string | null;
  offline: boolean;
}

function itemKey(item: BookOrVerseItem, i: number): string {
  return item.kind === 'book' ? `book:${item.book}` : `verse:${item.candidate.osis}:${i}`;
}

function rowLabel(item: BookOrVerseItem): string {
  if (item.kind === 'book') return item.book;
  const c = item.candidate;
  const range = c.verseEnd ? `${c.verseStart}–${c.verseEnd}` : `${c.verseStart}`;
  return c.label ?? `${c.book} ${c.chapter}:${range}`;
}

export function BookSuggestList({ items, selectedIndex, onSelect, loading, hint, offline }: BookSuggestListProps) {
  if (offline) {
    return <div className="verse-suggest verse-suggest--empty">Verse search needs connection</div>;
  }
  return (
    <div className="verse-suggest" role="listbox" aria-label="Book suggestions">
      {items.map((item, i) => (
        <div
          key={itemKey(item, i)}
          role="option"
          aria-selected={i === selectedIndex}
          className={`verse-suggest__row${i === selectedIndex ? ' is-selected' : ''}`}
          onClick={() => onSelect(item)}
          tabIndex={-1}
        >
          <span className="verse-suggest__ref">{rowLabel(item)}</span>
          {item.kind === 'verse' && item.candidate.text
            ? <span className="verse-suggest__text">{item.candidate.text}</span>
            : null}
        </div>
      ))}
      {loading ? <div className="verse-suggest__hint">Searching…</div> : null}
      {!loading && items.length === 0 && hint ? <div className="verse-suggest__hint">{hint}</div> : null}
    </div>
  );
}
```

- [ ] **Step 3b: Write the `renderBookPicker` renderer**

```tsx
// src/notepad/extensions/book-picker-renderer.tsx
import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { BookSuggestList } from './BookSuggestList';
import { routeVersePicker, type BookOrVerseItem } from './book-matcher';
import { applyVerseSelection } from './verse-picker-commands';
import { completeReference } from '../bible/verse-search';
import type { VerseSearchDeps } from '../bible/verse-search-types';

const HINT = 'Add chapter:verse, e.g. 8:28';

// DOM renderer for the /verse book picker (C). It does NOT use props.items;
// it computes its own view from props.query via routeVersePicker:
//   - books  → BookItem rows (autocomplete on select),
//   - hint   → "Add chapter:verse" (no rows),
//   - resolve→ fetch verse text via completeReference, show one VerseItem row.
export function renderBookPicker(search: VerseSearchDeps | null) {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let items: BookOrVerseItem[] = [];
  let hint: string | null = null;
  let loading = false;
  let current: SuggestionProps<BookOrVerseItem, BookOrVerseItem> | null = null;
  let resolveAbort: AbortController | null = null;
  // Guards against a slow resolve painting stale results after the query moved on.
  let queryToken = 0;

  const stripVerse = (q: string) => q.replace(/^verse\s*/i, '');

  const paint = () => {
    if (!root) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    root.render(
      <BookSuggestList
        items={items}
        selectedIndex={selectedIndex}
        loading={loading}
        hint={hint}
        offline={!online && items.length === 0 && !hint && !loading}
        onSelect={(item) => current?.command(item)}
      />,
    );
  };

  const place = (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
    const rect = props.clientRect?.();
    if (el && rect) {
      el.style.position = 'fixed';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom}px`;
      el.style.zIndex = '9999';
    }
  };

  const update = (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
    current = props;
    const q = stripVerse(props.query);
    const view = routeVersePicker(q);
    const token = ++queryToken;
    resolveAbort?.abort();

    if (view.kind === 'books') {
      items = view.books.map((book) => ({ kind: 'book', book }));
      hint = null; loading = false; selectedIndex = 0;
      paint();
    } else if (view.kind === 'hint') {
      items = []; hint = HINT; loading = false; selectedIndex = 0;
      paint();
    } else {
      // resolve — fetch verse text async, then show one verse row.
      items = []; hint = null; loading = true; selectedIndex = 0;
      paint();
      if (!search) { loading = false; paint(); return; }
      resolveAbort = new AbortController();
      completeReference(view.query, search, { signal: resolveAbort.signal }).then((candidate) => {
        if (token !== queryToken) return; // a newer keystroke superseded us
        items = candidate ? [{ kind: 'verse', candidate }] : [];
        hint = candidate ? null : 'No verse found';
        loading = false;
        paint();
      });
    }
  };

  return {
    onStart: (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      place(props); update(props);
    },
    onUpdate: (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
      place(props); update(props);
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!current) return false;
      const n = items.length;
      if (props.event.key === 'ArrowDown') { selectedIndex = n === 0 ? 0 : (selectedIndex + 1) % n; paint(); return true; }
      if (props.event.key === 'ArrowUp') { selectedIndex = n === 0 ? 0 : (selectedIndex - 1 + n) % n; paint(); return true; }
      if (props.event.key === 'Enter') { const item = items[selectedIndex]; if (item) current.command(item); return true; }
      if (props.event.key === 'Escape') { return true; }
      return false;
    },
    onExit: () => {
      resolveAbort?.abort();
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}

// applyVerseSelection is wired as the Suggestion `command` in scripture-ref.ts;
// re-exported here so the picker renderer and the node stay in one mental model.
export { applyVerseSelection };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/extensions/BookSuggestList.test.tsx`
Expected: PASS.
Run: `npx tsc -b`  → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/BookSuggestList.tsx src/notepad/extensions/book-picker-renderer.tsx src/notepad/extensions/BookSuggestList.test.tsx
git commit -m "feat(notepad): BookSuggestList + renderBookPicker for /verse typeahead"
```

---

### Task 7: Rewire the `/verse` plugin to the book picker

Swap the `/verse` picker (C) from the verse-text search path to the new book picker: its `command` becomes `applyVerseSelection`, its `render` becomes `renderBookPicker`, its generic becomes `BookOrVerseItem`, and `items` returns `[]` (the renderer computes its own view). Verify the trigger behavior and the autocomplete-keeps-open flow end-to-end.

**Files:**
- Modify: `src/notepad/extensions/scripture-ref.ts`
- Test: `src/notepad/extensions/scripture-ref.suggestion.test.ts`

**Interfaces:**
- Consumes: `renderBookPicker`, `applyVerseSelection` (Tasks 5/6); `BookOrVerseItem` (Task 2).
- Produces: a `/verse` picker plugin that resolves book typeahead, leaving `LOOKUP_PICKER_KEY` (Task 4) as the verse-text search.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/notepad/extensions/scripture-ref.suggestion.test.ts
import { applyVerseSelection } from './verse-picker-commands';

describe('/verse book picker', () => {
  it('"/verse rom" keeps the picker active with the verse-prefixed query', () => {
    editor = makeEditor();
    type(editor, '/verse rom');
    const picker = suggestionState(editor, PICKER);
    expect(picker?.active).toBe(true);
    expect(picker?.query).toBe('verse rom');
  });

  it('selecting a book autocompletes the text to "/verse Romans " and keeps the picker open', () => {
    editor = makeEditor();
    type(editor, '/verse rom');
    const before = suggestionState(editor, PICKER);
    expect(before?.active).toBe(true);
    // The Suggestion range for "/verse rom" spans the whole trigger run. Drive
    // the documented select action directly against that range.
    const to = editor.state.selection.from;
    const from = to - '/verse rom'.length;
    applyVerseSelection(editor, { from, to }, { kind: 'book', book: 'Romans' });
    expect(editor.getText()).toContain('/verse Romans ');
    // Still a /verse trigger → picker stays active (now in the hint state).
    expect(suggestionState(editor, PICKER)?.active).toBe(true);
  });

  it('"/verse John 3:16" activates only the picker (predictive stands down)', () => {
    editor = makeEditor();
    type(editor, '/verse John 3:16');
    expect(suggestionState(editor, PICKER)?.active).toBe(true);
    expect(suggestionState(editor, PREDICTIVE)?.active).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/scripture-ref.suggestion.test.ts`
Expected: FAIL — selecting a book does not rewrite text (the old picker inserts a node / does nothing for a book), so `getText()` lacks `/verse Romans `.

- [ ] **Step 3: Rewire the `/verse` picker**

In `src/notepad/extensions/scripture-ref.ts`, add imports:

```ts
import { renderBookPicker } from './book-picker-renderer';
import { applyVerseSelection } from './verse-picker-commands';
import type { BookOrVerseItem } from './book-matcher';
```

Replace the entire `picker` config (the `// C — /verse keyword picker.` block) with the book-picker version:

```ts
    // C — /verse book typeahead. The custom matcher fires only on "/verse"; the
    // renderer (renderBookPicker) computes its own view from the query
    // (book list / hint / resolved verse), so `items` returns []. Selecting a
    // book autocompletes the text; selecting a resolved verse inserts a node —
    // both via applyVerseSelection.
    const verseCommand = ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: BookOrVerseItem }) =>
      applyVerseSelection(editor, range, props);

    const picker: SuggestionOptions<BookOrVerseItem, BookOrVerseItem> = {
      editor: this.editor,
      pluginKey: VERSE_PICKER_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      command: verseCommand,
      render: () => renderBookPicker(search),
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchVersePickerBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: () => [],
    };
```

Note: `buildReferencePinItems` and `buildKeywordItems` are now unused by the `/verse` picker but are still imported. The `/lookup` picker (Task 4) uses `buildReferencePinItems`. If `buildKeywordItems` is now unused anywhere, remove its import to keep the typecheck/lint clean; otherwise leave it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/extensions/scripture-ref.suggestion.test.ts`
Expected: PASS (new `/verse` book picker cases + all earlier `/lookup` + Bug 1/2 + regression cases).

Then the full regression sweep:
Run: `npx tsc -b`  → exit 0.
Run: `npx vitest run src/notepad/extensions/ src/notepad/bible/verse-search.test.ts src/notepad/bible/verse-search-client.test.ts`
Expected: PASS for the four baseline suites + all new suites. (`BibleReader.test.tsx` may fail on jsdom `matchMedia` — pre-existing, ignore.)

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/scripture-ref.ts src/notepad/extensions/scripture-ref.suggestion.test.ts
git commit -m "feat(notepad): rewire /verse to book typeahead + reference resolution"
```

---

## Self-Review

**Spec coverage:**
- `/lookup` = today's verse-text search, moved → Task 3 (matcher) + Task 4 (plugin reusing renderer/search). ✓
- `/verse` book typeahead, best-match-first, all-66 empty state → Task 1 (`matchBooks`). ✓
- States A/B/C/D routing, hint mid-type, resolve-with-text → Task 2 (`routeVersePicker`) + Task 6 (renderer fetches via `completeReference`). ✓
- Discriminated item type → Task 2. ✓
- Autocomplete (book) vs node insert (verse) → Task 5 (`applyVerseSelection`) + Task 7 (wired as command). ✓
- Predictive `allow` stands down for both pickers → Task 4. ✓
- Untouched: predictive plugin, `createVerseSearch`, prefix search, migration 031, `VerseSuggestList.tsx` → none modified except additive renderer param. ✓
- Out of scope (drill-down lists, deploy) → not in any task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `matchBooks`/`routeVersePicker`/`BookOrVerseItem`/`VersePickerView` defined in Task 2 and consumed with matching signatures in Tasks 5–7. `applyVerseSelection(editor, range, item)` signature consistent across Tasks 5/7. Plugin key strings (`scriptureRefLookup$`, `scriptureRefPicker$`, `scriptureRefPredictive$`) consistent with test selectors. `renderVerseSuggestList(search, { command })` consistent between Task 4 renderer change and its `/lookup` call site. ✓
</content>
