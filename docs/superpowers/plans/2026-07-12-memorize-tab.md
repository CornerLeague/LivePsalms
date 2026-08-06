# Memorize Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Memorize** tab to the notebook Study side panel — a Scripture-memorization self-quiz (cloze + blank-page recall + reference flashcard) with per-verse saved mastery (Level 2), one card = one verse, guest progress in localStorage.

**Architecture:** Mirror the existing **Scripture Focus Lists** feature (`src/notepad/bible/focus/`) exactly — a ports-&-adapters persistence split (interface + Supabase adapter + in-memory test fake + a React hook that selects the adapter and falls back to localStorage for guests). All quiz grading is **pure, unit-tested logic** written before any UI. The tab is a third `display`-toggled pane in `StudySidePanel`; verses enter the collection as **frozen snapshots** (text + translation + reference) from either a Memorize-home "add current passage" button or an "Add to Memorize" action on the Reader's verse-tap popover.

**Tech Stack:** React 19 + TypeScript, Vitest 4 (`globals:false`, jsdom pragma for component tests), Supabase (Postgres + RLS), sonner toasts, lucide-react icons. New code lives in `src/notepad/study/memorize/`.

## Global Constraints

These apply to **every** task. Copied verbatim from the spec + handoff facts.

- **Snapshot model:** a card stores `book/chapter/verse/translation/text` — a **frozen** copy of the verse text so a quiz is stable even if the Reader translation later changes. There is **no `label`/`reference` DB column**; derive the display ref in UI via `formatCardRef`.
- **Card granularity:** card = **one verse**. Multi-verse passages become multiple cards grouped by `book+chapter`. No named/custom lists in v1 — the collection is a flat per-user set.
- **Uniqueness / no-op upsert:** de-dupe on `(book, chapter, verse, translation)`. Re-adding an existing verse must **never** create a duplicate **or reset mastery** on the existing card.
- **Adapter split rules (mirror `focus/`):** the Supabase adapter uses **ES-private** `#client`/`#userId` (NOT TS `private`), does snake_case↔camelCase mapping ONLY inside itself via a `toCard(row)` mapper, and **throws on error** (`if (error) throw error`). Optimistic update + rollback-to-`prev` + `toast.error` (sonner) live in the **HOOK**, not the adapter.
- **Adapter selection (in the hook):**
  ```ts
  const adapter = useMemo(() => {
    if (opts.adapterOverride !== undefined) return opts.adapterOverride; // !== undefined; null = force guest
    if (supabase && userId) return new SupabaseMemorizeAdapter(supabase, userId);
    return null; // guest
  }, [opts.adapterOverride, userId]);
  ```
  `supabase` from `@/lib/supabase` is `SupabaseClient | null` — null-guard. Auth: `const { user } = useAuthSession(); const userId = user?.id ?? null;`.
- **Guest (`adapter == null`):** cards live in React state mirrored to localStorage via new `session-storage.ts` helpers, key `'psalms.memorize.cards'`.
- **DB conventions (migration 049):** `user_id ... references public.profiles(id) on delete cascade` (**profiles, NOT auth.users**); one policy per verb with sentence names gated on `auth.uid() = user_id`; reuse the shared `public.update_updated_at()` trigger fn (defined once in `003_triggers.sql` — do **not** redefine); lowercase SQL, fully-qualified `public.`; `create policy` has **no** `if not exists`.
- **Migration number:** `049` is next (048 is the current highest).
- **State survival (mandatory):** every Study pane is ALWAYS mounted and toggled purely by inline `display` (block/flex vs none). Do NOT convert to conditional/unmount rendering — an in-progress quiz must survive tab switches.
- **Do NOT touch `StudyTabBar.tsx`** (its 3-entry mobile dock is a different union). Mobile support is automatic: `MobileStudyWorkspace` renders `<StudySidePanel>` as the `study` bottom-tab body. All quiz targets must be finger-friendly.
- **Test infra:** vitest config `environment:'node'`, **`globals:false`** (must import `describe/it/expect/vi/afterEach` from `'vitest'`), `setupFiles:['./src/test-setup.ts']`, alias `@ → ./src`. Component tests: **first line** `// @vitest-environment jsdom`, then `@testing-library/react` with top-level `afterEach(cleanup)`. Pure-logic tests stay in default node env (no pragma).
- **Completion gate (run ALL THREE — repo lesson):** `npx tsc -b` (0 errors, from repo root — there is no standalone `typecheck` script) **and** `npm run test` (= `vitest run`, one-shot) **and** `npx eslint <touched files>`. Then browser-verify the tab. A pre-existing **`garden-scene`** test failure is **NOT** ours — ignore it.
- **Commit only when the user asks** (standing rule). Commit messages: present-tense, scoped `feat(memorize): …`.

---

## File Structure

**New dir `src/notepad/study/memorize/`:**
- `memorize-types.ts` — domain types (`MemorizeCard`, `NewMemorizeCard`, `AttemptUpdate`), the `MemorizeAdapter` interface, and pure helpers `cardKey` + `formatCardRef`.
- `cloze.ts` (+`.test.ts`) — tokenize / seeded blank selection / normalize / grade.
- `blank-page-diff.ts` (+`.test.ts`) — word-level LCS diff for full recall.
- `mastery.ts` (+`.test.ts`) — EMA mastery + `applyAttempt`.
- `in-memory-memorize-adapter.ts` (+`.test.ts`) — Map-backed test fake; its test IS the CRUD contract.
- `supabase-memorize-adapter.ts` — production adapter over `memorize_cards`.
- `useMemorizeCards.ts` (+`.test.ts`) — adapter-selecting hook + guest localStorage + optimistic/rollback.
- `MemorizePanel.tsx` (+`.test.tsx`) — home view (grouped cards, mastery bars, add-current-passage, practice entry, empty state) + hosts the quiz session.
- `QuizSession.tsx` (+`.test.tsx`) — mode chips, per-card runner, end-of-session mastery write-back.
- `ClozeQuiz.tsx` (+`.test.tsx`) · `BlankPageQuiz.tsx` (+`.test.tsx`) · `FlashcardQuiz.tsx` (+`.test.tsx`) — the three quiz modes.

**Edits:**
- `src/notepad/session/session-storage.ts` — add `loadMemorizeCards`/`saveMemorizeCards` + key.
- `src/notepad/study/panes/StudySidePanel.tsx` (+ its `.test.tsx`) — add the `'memorize'` tab.
- `src/notepad/bible/BibleReader.tsx` (+ its `.test.tsx`) — add the "Add to Memorize" affordance + broaden the picker gate.
- `src/notepad/study/panes/StudyReader.tsx` (+ its `.test.tsx`) — wire `onAddToMemorize` via a `useMemorizeCards()` instance.

**DB:** `supabase/migrations/049_memorize_cards.sql`.

---

## Task 1: Domain types + pure helpers (`memorize-types.ts`)

**Files:**
- Create: `src/notepad/study/memorize/memorize-types.ts`
- Test: `src/notepad/study/memorize/memorize-types.test.ts`

**Interfaces:**
- Consumes: `BibleTranslation` from `@/notepad/bible/translations`; `bookByAbbrev` from `@/notepad/bible/bible-books`.
- Produces:
  - `interface MemorizeCard { id: string; book: string; chapter: number; verse: number; translation: BibleTranslation; text: string; mastery: number; attempts: number; lastPracticedAt: string | null; position: number; }`
  - `interface NewMemorizeCard { book: string; chapter: number; verse: number; translation: BibleTranslation; text: string; }`
  - `interface AttemptUpdate { mastery: number; attempts: number; lastPracticedAt: string; }`
  - `interface MemorizeAdapter { list(): Promise<MemorizeCard[]>; add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]>; updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void>; remove(id: string): Promise<void>; }`
  - `function cardKey(c: { book: string; chapter: number; verse: number; translation: string }): string`
  - `function formatCardRef(card: { book: string; chapter: number; verse: number }): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/study/memorize/memorize-types.test.ts
import { describe, it, expect } from 'vitest';
import { cardKey, formatCardRef } from './memorize-types';

describe('cardKey', () => {
  it('is stable and distinguishes translation', () => {
    const base = { book: 'jhn', chapter: 3, verse: 16 };
    expect(cardKey({ ...base, translation: 'BSB' })).toBe('jhn|3|16|BSB');
    expect(cardKey({ ...base, translation: 'KJV' })).not.toBe(cardKey({ ...base, translation: 'BSB' }));
  });
});

describe('formatCardRef', () => {
  it('uses the book display name', () => {
    expect(formatCardRef({ book: 'jhn', chapter: 3, verse: 16 })).toBe('John 3:16');
    expect(formatCardRef({ book: 'psa', chapter: 23, verse: 1 })).toBe('Psalm 23:1');
  });
  it('falls back to the raw abbrev for an unknown book', () => {
    expect(formatCardRef({ book: 'zzz', chapter: 1, verse: 1 })).toBe('zzz 1:1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/memorize-types.test.ts`
Expected: FAIL — cannot resolve `./memorize-types`.

- [ ] **Step 3: Write the module**

```ts
// src/notepad/study/memorize/memorize-types.ts
// Domain types + the persistence contract for Memorize cards. Unlike Focus Lists
// (which store ref-only), a card SNAPSHOTS the verse text + translation so a quiz
// stays stable even if the Reader's translation later changes. card = one verse.
import type { BibleTranslation } from '@/notepad/bible/translations';
import { bookByAbbrev } from '@/notepad/bible/bible-books';

export interface MemorizeCard {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  translation: BibleTranslation;
  /** Frozen snapshot of the verse text at add-time. */
  text: string;
  /** 0–100. */
  mastery: number;
  attempts: number;
  /** ISO timestamp; null until first practice. */
  lastPracticedAt: string | null;
  position: number;
}

export interface NewMemorizeCard {
  book: string;
  chapter: number;
  verse: number;
  translation: BibleTranslation;
  text: string;
}

/** The fields an attempt writes back to a card. */
export interface AttemptUpdate {
  mastery: number;
  attempts: number;
  lastPracticedAt: string;
}

/** CRUD contract. Two implementations: in-memory (tested) + Supabase. */
export interface MemorizeAdapter {
  list(): Promise<MemorizeCard[]>;
  /** No-op upsert: de-dupe on (book,chapter,verse,translation); NEVER resets an
      existing card's mastery. Returns only the newly-inserted cards. */
  add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]>;
  updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Composite uniqueness key shared by every adapter + the guest path. */
export function cardKey(c: { book: string; chapter: number; verse: number; translation: string }): string {
  return `${c.book}|${c.chapter}|${c.verse}|${c.translation}`;
}

/** Display reference, e.g. 'John 3:16'. Falls back to the raw abbrev. */
export function formatCardRef(card: { book: string; chapter: number; verse: number }): string {
  const name = bookByAbbrev(card.book)?.name ?? card.book;
  return `${name} ${card.chapter}:${card.verse}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/memorize-types.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/memorize-types.ts src/notepad/study/memorize/memorize-types.test.ts
git commit -m "feat(memorize): add domain types + cardKey/formatCardRef helpers"
```

---

## Task 2: Cloze engine (`cloze.ts`)

**Files:**
- Create: `src/notepad/study/memorize/cloze.ts`
- Test: `src/notepad/study/memorize/cloze.test.ts`

**Interfaces:**
- Produces:
  - `interface Token { text: string; isWord: boolean; index: number; }`
  - `function tokenize(text: string): Token[]`
  - `function mulberry32(seed: number): () => number`
  - `function seedFromString(s: string): number`
  - `function selectBlankIndices(tokens: Token[], difficulty: number, seed: number): number[]`
  - `function normalizeWord(s: string): string`
  - `interface ClozeGrade { perBlank: boolean[]; correct: number; total: number; scorePercent: number; }`
  - `function gradeCloze(tokens: Token[], blankIndices: number[], answers: string[], overrides?: boolean[]): ClozeGrade`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/study/memorize/cloze.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize, selectBlankIndices, normalizeWord, gradeCloze, seedFromString } from './cloze';

describe('tokenize', () => {
  it('splits words from punctuation and preserves order + reconstruction', () => {
    const toks = tokenize('For God so loved the world.');
    expect(toks.filter((t) => t.isWord).map((t) => t.text)).toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
    expect(toks.map((t) => t.text).join('')).toBe('For God so loved the world.');
    expect(toks.every((t, i) => t.index === i)).toBe(true);
  });
  it('keeps apostrophes/hyphens inside a word', () => {
    expect(tokenize("God's well-kept word").filter((t) => t.isWord).map((t) => t.text))
      .toEqual(["God's", 'well-kept', 'word']);
  });
});

describe('normalizeWord', () => {
  it('lowercases and strips punctuation/whitespace', () => {
    expect(normalizeWord('  World! ')).toBe('world');
    expect(normalizeWord('LOVED,')).toBe('loved');
  });
});

describe('selectBlankIndices', () => {
  const toks = tokenize('For God so loved the world that he gave his Son');
  it('picks round(difficulty * wordCount) WORD indices, deterministically by seed', () => {
    const a = selectBlankIndices(toks, 0.5, 123);
    const b = selectBlankIndices(toks, 0.5, 123);
    expect(a).toEqual(b);                    // stable within a seed
    expect(a.length).toBe(Math.round(0.5 * 11)); // 11 words -> 6 (round half up)
    expect(a.every((i) => toks[i].isWord)).toBe(true); // never punctuation
    expect([...a]).toEqual([...a].sort((x, y) => x - y)); // sorted ascending
  });
  it('returns [] at difficulty 0 and every word at difficulty 1', () => {
    expect(selectBlankIndices(toks, 0, 1)).toEqual([]);
    expect(selectBlankIndices(toks, 1, 1)).toEqual(toks.filter((t) => t.isWord).map((t) => t.index));
  });
});

describe('gradeCloze', () => {
  const toks = tokenize('For God so loved');
  const blanks = [1, 3]; // 'God', 'loved'
  it('grades per blank with normalization', () => {
    const g = gradeCloze(toks, blanks, ['god', 'Loved!']);
    expect(g.perBlank).toEqual([true, true]);
    expect(g.correct).toBe(2);
    expect(g.total).toBe(2);
    expect(g.scorePercent).toBe(100);
  });
  it('marks wrong answers and computes a percentage', () => {
    const g = gradeCloze(toks, blanks, ['god', 'hated']);
    expect(g.perBlank).toEqual([true, false]);
    expect(g.scorePercent).toBe(50);
  });
  it('honors a manual "close enough" override', () => {
    const g = gradeCloze(toks, blanks, ['god', 'luved'], [false, true]);
    expect(g.perBlank).toEqual([true, true]);
    expect(g.scorePercent).toBe(100);
  });
});

describe('seedFromString', () => {
  it('is deterministic', () => {
    expect(seedFromString('card-1')).toBe(seedFromString('card-1'));
    expect(seedFromString('card-1')).not.toBe(seedFromString('card-2'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/cloze.test.ts`
Expected: FAIL — cannot resolve `./cloze`.

- [ ] **Step 3: Write the module**

```ts
// src/notepad/study/memorize/cloze.ts
// Pure cloze (fill-in-the-blank) engine. Blank selection is DETERMINISTIC within a
// session (seeded RNG) so a card doesn't reshuffle mid-attempt. Only word tokens
// are ever blanked; punctuation/whitespace never are.

export interface Token {
  text: string;
  isWord: boolean;
  index: number;
}

const WORD_OR_GAP = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[^A-Za-z0-9]+/g;

/** Split text into ordered word + non-word tokens. join(tokens.text) === text. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  WORD_OR_GAP.lastIndex = 0;
  let index = 0;
  while ((m = WORD_OR_GAP.exec(text)) !== null) {
    const t = m[0];
    tokens.push({ text: t, isWord: /[A-Za-z0-9]/.test(t[0]), index });
    index += 1;
  }
  return tokens;
}

/** Deterministic 32-bit PRNG. Same seed -> same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap deterministic 32-bit hash of a string (for seeding from a card id). */
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** lowercase + strip everything but [a-z0-9]. */
export function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Pick round(difficulty * wordCount) word-token indices, deterministically by
 * seed, returned sorted ascending. difficulty is clamped to [0,1]. Punctuation is
 * never selected.
 */
export function selectBlankIndices(tokens: Token[], difficulty: number, seed: number): number[] {
  const wordIndices = tokens.filter((t) => t.isWord).map((t) => t.index);
  const d = Math.max(0, Math.min(1, difficulty));
  const n = Math.round(d * wordIndices.length);
  if (n <= 0) return [];
  if (n >= wordIndices.length) return [...wordIndices];
  const rng = mulberry32(seed);
  const pool = [...wordIndices];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).sort((a, b) => a - b);
}

export interface ClozeGrade {
  perBlank: boolean[];
  correct: number;
  total: number;
  scorePercent: number;
}

/**
 * Grade a cloze attempt. `answers` is aligned to `blankIndices` order. An
 * `overrides[i] === true` forces blank i correct (the "close enough?" manual mark).
 */
export function gradeCloze(
  tokens: Token[],
  blankIndices: number[],
  answers: string[],
  overrides: boolean[] = [],
): ClozeGrade {
  const perBlank = blankIndices.map((tokenIndex, i) => {
    if (overrides[i]) return true;
    const expected = normalizeWord(tokens[tokenIndex]?.text ?? '');
    const got = normalizeWord(answers[i] ?? '');
    return expected.length > 0 && expected === got;
  });
  const correct = perBlank.filter(Boolean).length;
  const total = blankIndices.length;
  const scorePercent = total === 0 ? 100 : Math.round((correct / total) * 100);
  return { perBlank, correct, total, scorePercent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/cloze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/cloze.ts src/notepad/study/memorize/cloze.test.ts
git commit -m "feat(memorize): add deterministic cloze tokenize/select/grade engine"
```

---

## Task 3: Blank-page recall diff (`blank-page-diff.ts`)

**Files:**
- Create: `src/notepad/study/memorize/blank-page-diff.ts`
- Test: `src/notepad/study/memorize/blank-page-diff.test.ts`

**Interfaces:**
- Consumes: `normalizeWord` from `./cloze`.
- Produces:
  - `type DiffStatus = 'matched' | 'missed' | 'extra'`
  - `interface DiffToken { text: string; status: DiffStatus; }`
  - `interface BlankPageDiff { tokens: DiffToken[]; matched: number; totalExpected: number; scorePercent: number; }`
  - `function diffRecall(expected: string, actual: string): BlankPageDiff`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/study/memorize/blank-page-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffRecall } from './blank-page-diff';

describe('diffRecall', () => {
  it('marks all matched on a perfect (modulo case/punct) recall', () => {
    const d = diffRecall('For God so loved', 'for god SO loved!');
    expect(d.tokens.every((t) => t.status === 'matched')).toBe(true);
    expect(d.matched).toBe(4);
    expect(d.totalExpected).toBe(4);
    expect(d.scorePercent).toBe(100);
  });

  it('flags a missed word', () => {
    const d = diffRecall('For God so loved', 'For God loved');
    expect(d.matched).toBe(3);
    expect(d.totalExpected).toBe(4);
    expect(d.scorePercent).toBe(75);
    expect(d.tokens.find((t) => t.status === 'missed')?.text).toBe('so');
  });

  it('flags an extra word', () => {
    const d = diffRecall('God loves', 'God really loves');
    expect(d.matched).toBe(2);
    expect(d.totalExpected).toBe(2);
    expect(d.tokens.some((t) => t.status === 'extra' && t.text === 'really')).toBe(true);
  });

  it('handles empty recall as 0% with all missed', () => {
    const d = diffRecall('God is love', '');
    expect(d.matched).toBe(0);
    expect(d.scorePercent).toBe(0);
    expect(d.tokens.every((t) => t.status === 'missed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/blank-page-diff.test.ts`
Expected: FAIL — cannot resolve `./blank-page-diff`.

- [ ] **Step 3: Write the module**

```ts
// src/notepad/study/memorize/blank-page-diff.ts
// Word-level LCS diff for the "blank page" full-recall method: compare the user's
// typed text against the frozen snapshot -> matched / missed / extra tokens for
// display. Comparison is normalized (case/punctuation-insensitive) but display
// preserves the EXPECTED spelling for matched/missed and the USER's for extra.
import { normalizeWord } from './cloze';

export type DiffStatus = 'matched' | 'missed' | 'extra';

export interface DiffToken {
  text: string;
  status: DiffStatus;
}

export interface BlankPageDiff {
  tokens: DiffToken[];
  matched: number;
  totalExpected: number;
  scorePercent: number;
}

interface Word {
  raw: string;
  norm: string;
}

function splitWords(s: string): Word[] {
  const trimmed = s.trim();
  if (trimmed.length === 0) return [];
  return trimmed
    .split(/\s+/)
    .map((raw) => ({ raw, norm: normalizeWord(raw) }))
    .filter((w) => w.norm.length > 0);
}

export function diffRecall(expected: string, actual: string): BlankPageDiff {
  const exp = splitWords(expected);
  const act = splitWords(actual);
  const n = exp.length;
  const m = act.length;

  // LCS DP table over normalized words.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = exp[i].norm === act[j].norm
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack into an aligned token stream.
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  let matched = 0;
  while (i < n && j < m) {
    if (exp[i].norm === act[j].norm) {
      tokens.push({ text: exp[i].raw, status: 'matched' });
      matched += 1;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: exp[i].raw, status: 'missed' });
      i += 1;
    } else {
      tokens.push({ text: act[j].raw, status: 'extra' });
      j += 1;
    }
  }
  while (i < n) { tokens.push({ text: exp[i].raw, status: 'missed' }); i += 1; }
  while (j < m) { tokens.push({ text: act[j].raw, status: 'extra' }); j += 1; }

  const totalExpected = n;
  const scorePercent = totalExpected === 0 ? 100 : Math.round((matched / totalExpected) * 100);
  return { tokens, matched, totalExpected, scorePercent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/blank-page-diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/blank-page-diff.ts src/notepad/study/memorize/blank-page-diff.test.ts
git commit -m "feat(memorize): add word-level LCS recall diff"
```

---

## Task 4: Mastery EMA (`mastery.ts`)

**Files:**
- Create: `src/notepad/study/memorize/mastery.ts`
- Test: `src/notepad/study/memorize/mastery.test.ts`

**Interfaces:**
- Consumes: `AttemptUpdate`, `MemorizeCard` from `./memorize-types`.
- Produces:
  - `function nextMastery(prev: number, attemptScore: number): number`
  - `function applyAttempt(card: Pick<MemorizeCard, 'mastery' | 'attempts'>, attemptScore: number, nowIso: string): AttemptUpdate`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/study/memorize/mastery.test.ts
import { describe, it, expect } from 'vitest';
import { nextMastery, applyAttempt } from './mastery';

describe('nextMastery', () => {
  it('is the rounded EMA 0.6*prev + 0.4*score', () => {
    expect(nextMastery(0, 100)).toBe(40);
    expect(nextMastery(50, 100)).toBe(70);
    expect(nextMastery(80, 0)).toBe(48);
  });
});

describe('applyAttempt', () => {
  it('bumps attempts, sets lastPracticedAt, and updates mastery', () => {
    const u = applyAttempt({ mastery: 50, attempts: 2 }, 100, '2026-07-12T00:00:00.000Z');
    expect(u).toEqual({ mastery: 70, attempts: 3, lastPracticedAt: '2026-07-12T00:00:00.000Z' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/mastery.test.ts`
Expected: FAIL — cannot resolve `./mastery`.

- [ ] **Step 3: Write the module**

```ts
// src/notepad/study/memorize/mastery.ts
// Per-card mastery: a simple EMA a future Level-3 scheduler will also consume.
import type { AttemptUpdate, MemorizeCard } from './memorize-types';

/** mastery' = round(0.6*prev + 0.4*attemptScore). Inputs assumed 0–100. */
export function nextMastery(prev: number, attemptScore: number): number {
  return Math.round(0.6 * prev + 0.4 * attemptScore);
}

/** Compute the write-back for one attempt: new mastery, +1 attempt, timestamp. */
export function applyAttempt(
  card: Pick<MemorizeCard, 'mastery' | 'attempts'>,
  attemptScore: number,
  nowIso: string,
): AttemptUpdate {
  return {
    mastery: nextMastery(card.mastery, attemptScore),
    attempts: card.attempts + 1,
    lastPracticedAt: nowIso,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/mastery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/mastery.ts src/notepad/study/memorize/mastery.test.ts
git commit -m "feat(memorize): add mastery EMA + applyAttempt"
```

---

## Task 5: In-memory adapter + contract test (`in-memory-memorize-adapter.ts`)

**Files:**
- Create: `src/notepad/study/memorize/in-memory-memorize-adapter.ts`
- Test: `src/notepad/study/memorize/in-memory-memorize-adapter.test.ts`

**Interfaces:**
- Consumes: `MemorizeAdapter`, `MemorizeCard`, `NewMemorizeCard`, `AttemptUpdate`, `cardKey` from `./memorize-types`.
- Produces: `class InMemoryMemorizeAdapter implements MemorizeAdapter` with `constructor(seed?: MemorizeCard[])`.

- [ ] **Step 1: Write the failing test** (this test IS the CRUD/ordering contract)

```ts
// src/notepad/study/memorize/in-memory-memorize-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryMemorizeAdapter } from './in-memory-memorize-adapter';
import type { NewMemorizeCard } from './memorize-types';

const nc = (verse: number, over: Partial<NewMemorizeCard> = {}): NewMemorizeCard => ({
  book: 'jhn', chapter: 3, verse, translation: 'BSB', text: `verse ${verse}`, ...over,
});

describe('InMemoryMemorizeAdapter', () => {
  it('adds cards with 0 mastery, incrementing positions, and lists them sorted', async () => {
    const a = new InMemoryMemorizeAdapter();
    const created = await a.add([nc(16), nc(17)]);
    expect(created.map((c) => [c.verse, c.position, c.mastery, c.attempts])).toEqual([[16, 0, 0, 0], [17, 1, 0, 0]]);
    const listed = await a.list();
    expect(listed.map((c) => c.verse)).toEqual([16, 17]);
  });

  it('de-dupes on (book,chapter,verse,translation) — re-add is a no-op and never resets mastery', async () => {
    const a = new InMemoryMemorizeAdapter();
    const [card] = await a.add([nc(16)]);
    await a.updateAfterAttempt(card.id, { mastery: 90, attempts: 1, lastPracticedAt: '2026-07-12T00:00:00.000Z' });
    const again = await a.add([nc(16), nc(18)]); // 16 already present, 18 is new
    expect(again.map((c) => c.verse)).toEqual([18]);
    const listed = await a.list();
    expect(listed).toHaveLength(2);
    expect(listed.find((c) => c.verse === 16)?.mastery).toBe(90); // NOT reset
  });

  it('treats a different translation as a distinct card', async () => {
    const a = new InMemoryMemorizeAdapter();
    await a.add([nc(16, { translation: 'BSB' })]);
    const created = await a.add([nc(16, { translation: 'KJV' })]);
    expect(created).toHaveLength(1);
    expect(await a.list()).toHaveLength(2);
  });

  it('updateAfterAttempt writes mastery/attempts/lastPracticedAt', async () => {
    const a = new InMemoryMemorizeAdapter();
    const [card] = await a.add([nc(16)]);
    await a.updateAfterAttempt(card.id, { mastery: 40, attempts: 1, lastPracticedAt: '2026-07-12T00:00:00.000Z' });
    const [reloaded] = await a.list();
    expect([reloaded.mastery, reloaded.attempts, reloaded.lastPracticedAt]).toEqual([40, 1, '2026-07-12T00:00:00.000Z']);
  });

  it('removes a card', async () => {
    const a = new InMemoryMemorizeAdapter();
    const [c1, c2] = await a.add([nc(16), nc(17)]);
    await a.remove(c1.id);
    expect((await a.list()).map((c) => c.verse)).toEqual([17]);
    expect(c2.verse).toBe(17);
  });

  it('returns deep copies so callers cannot mutate internal state', async () => {
    const a = new InMemoryMemorizeAdapter();
    await a.add([nc(16)]);
    const first = await a.list();
    first[0].mastery = 999;
    expect((await a.list())[0].mastery).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/in-memory-memorize-adapter.test.ts`
Expected: FAIL — cannot resolve `./in-memory-memorize-adapter`.

- [ ] **Step 3: Write the module**

```ts
// src/notepad/study/memorize/in-memory-memorize-adapter.ts
// Map-backed MemorizeAdapter: the tested reference implementation of the CRUD
// contract and the test double for useMemorizeCards. Returns deep copies so
// callers can mutate results without corrupting internal state.
import { cardKey, type AttemptUpdate, type MemorizeAdapter, type MemorizeCard, type NewMemorizeCard } from './memorize-types';

function clone(c: MemorizeCard): MemorizeCard {
  return { ...c };
}

export class InMemoryMemorizeAdapter implements MemorizeAdapter {
  #cards = new Map<string, MemorizeCard>();
  #seq = 0;

  constructor(seed: MemorizeCard[] = []) {
    for (const c of seed) this.#cards.set(c.id, clone(c));
  }

  #id(): string {
    this.#seq += 1;
    return `card-${this.#seq}`;
  }

  async list(): Promise<MemorizeCard[]> {
    return [...this.#cards.values()].sort((a, b) => a.position - b.position).map(clone);
  }

  async add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]> {
    const seen = new Set([...this.#cards.values()].map(cardKey));
    let position = this.#cards.size;
    const created: MemorizeCard[] = [];
    for (const nc of cards) {
      const k = cardKey(nc);
      if (seen.has(k)) continue; // no-op upsert: never touches the existing card
      seen.add(k);
      const card: MemorizeCard = {
        id: this.#id(),
        book: nc.book, chapter: nc.chapter, verse: nc.verse,
        translation: nc.translation, text: nc.text,
        mastery: 0, attempts: 0, lastPracticedAt: null, position,
      };
      position += 1;
      this.#cards.set(card.id, card);
      created.push(clone(card));
    }
    return created;
  }

  async updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void> {
    const c = this.#cards.get(id);
    if (!c) return;
    c.mastery = update.mastery;
    c.attempts = update.attempts;
    c.lastPracticedAt = update.lastPracticedAt;
  }

  async remove(id: string): Promise<void> {
    this.#cards.delete(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/in-memory-memorize-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/in-memory-memorize-adapter.ts src/notepad/study/memorize/in-memory-memorize-adapter.test.ts
git commit -m "feat(memorize): add in-memory adapter + CRUD contract test"
```

---

## Task 6: Supabase adapter (`supabase-memorize-adapter.ts`)

No standalone test — the InMemory adapter's test IS the contract (mirrors `focus/`). This is a thin, throwing pass-through.

**Files:**
- Create: `src/notepad/study/memorize/supabase-memorize-adapter.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`; `BibleTranslation` from `@/notepad/bible/translations`; `cardKey`, `AttemptUpdate`, `MemorizeAdapter`, `MemorizeCard`, `NewMemorizeCard` from `./memorize-types`.
- Produces: `class SupabaseMemorizeAdapter implements MemorizeAdapter` with `constructor(client: SupabaseClient, userId: string)`.

- [ ] **Step 1: Write the module**

```ts
// src/notepad/study/memorize/supabase-memorize-adapter.ts
// Production MemorizeAdapter over the 049 table (RLS-scoped to the signed-in user).
// Thin pass-through; throws on error. The CRUD contract is proven by
// InMemoryMemorizeAdapter's tests. snake_case<->camelCase mapping lives ONLY here.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BibleTranslation } from '@/notepad/bible/translations';
import { cardKey, type AttemptUpdate, type MemorizeAdapter, type MemorizeCard, type NewMemorizeCard } from './memorize-types';

interface CardRow {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  text: string;
  mastery: number;
  attempts: number;
  last_practiced_at: string | null;
  position: number;
}

const CARD_COLS = 'id, book, chapter, verse, translation, text, mastery, attempts, last_practiced_at, position';

function toCard(r: CardRow): MemorizeCard {
  return {
    id: r.id,
    book: r.book,
    chapter: r.chapter,
    verse: r.verse,
    translation: r.translation as BibleTranslation,
    text: r.text,
    mastery: r.mastery,
    attempts: r.attempts,
    lastPracticedAt: r.last_practiced_at,
    position: r.position,
  };
}

export class SupabaseMemorizeAdapter implements MemorizeAdapter {
  #client: SupabaseClient;
  #userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.#client = client;
    this.#userId = userId;
  }

  async list(): Promise<MemorizeCard[]> {
    const { data, error } = await this.#client
      .from('memorize_cards')
      .select(CARD_COLS)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as CardRow[]).map(toCard);
  }

  async add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]> {
    if (cards.length === 0) return [];
    // De-dupe against existing keys (the unique constraint is the ultimate guard).
    const { data: existing, error: selErr } = await this.#client
      .from('memorize_cards')
      .select('book, chapter, verse, translation')
      .eq('user_id', this.#userId);
    if (selErr) throw selErr;
    const seen = new Set(
      ((existing ?? []) as Array<{ book: string; chapter: number; verse: number; translation: string }>).map(cardKey),
    );
    let position = seen.size;
    const rows: Array<Record<string, unknown>> = [];
    for (const c of cards) {
      const k = cardKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({
        user_id: this.#userId,
        book: c.book, chapter: c.chapter, verse: c.verse,
        translation: c.translation, text: c.text,
        position: position++,
      });
    }
    if (rows.length === 0) return [];
    const { data, error } = await this.#client.from('memorize_cards').insert(rows).select(CARD_COLS);
    if (error) throw error;
    return ((data ?? []) as CardRow[]).map(toCard).sort((a, b) => a.position - b.position);
  }

  async updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void> {
    const { error } = await this.#client
      .from('memorize_cards')
      .update({ mastery: update.mastery, attempts: update.attempts, last_practiced_at: update.lastPracticedAt })
      .eq('id', id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.#client.from('memorize_cards').delete().eq('id', id);
    if (error) throw error;
  }
}
```

- [ ] **Step 2: Typecheck the new file compiles**

Run: `npx tsc -b`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/notepad/study/memorize/supabase-memorize-adapter.ts
git commit -m "feat(memorize): add Supabase adapter over memorize_cards"
```

---

## Task 7: Guest localStorage helpers (`session-storage.ts`)

**Files:**
- Modify: `src/notepad/session/session-storage.ts` (add key + two helpers + export)
- Test: `src/notepad/session/session-storage.memorize.test.ts` (new co-located test file)

**Interfaces:**
- Consumes: `MemorizeCard` from `@/notepad/study/memorize/memorize-types`; existing module-private `readRaw`/`writeRaw`.
- Produces: `function loadMemorizeCards(): MemorizeCard[]`; `function saveMemorizeCards(cards: MemorizeCard[]): void`; exported const `KEY_MEMORIZE_CARDS`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// src/notepad/session/session-storage.memorize.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadMemorizeCards, saveMemorizeCards, KEY_MEMORIZE_CARDS } from './session-storage';
import type { MemorizeCard } from '@/notepad/study/memorize/memorize-types';

const card: MemorizeCard = {
  id: 'g-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved…', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('memorize guest storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns [] when nothing is stored', () => {
    expect(loadMemorizeCards()).toEqual([]);
  });

  it('round-trips saved cards', () => {
    saveMemorizeCards([card]);
    expect(loadMemorizeCards()).toEqual([card]);
  });

  it('returns [] on a corrupt (non-array) value', () => {
    localStorage.setItem(KEY_MEMORIZE_CARDS, '{"not":"an array"}');
    expect(loadMemorizeCards()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/session/session-storage.memorize.test.ts`
Expected: FAIL — `loadMemorizeCards` is not exported.

- [ ] **Step 3: Add the key + export**

In `src/notepad/session/session-storage.ts`, add the key constant after `KEY_QUICK_LIST` (line 19):

```ts
const KEY_QUICK_LIST = 'psalms.bible.focus.quickList';
const KEY_MEMORIZE_CARDS = 'psalms.memorize.cards';
```

And add `KEY_MEMORIZE_CARDS,` to the export block (after `KEY_QUICK_LIST,`):

```ts
  KEY_FOCUS_MODE,
  KEY_FOCUS_ACTIVE_LIST,
  KEY_QUICK_LIST,
  KEY_MEMORIZE_CARDS,
};
```

- [ ] **Step 4: Add the import + helpers**

At the top of the file, add the type import beneath the existing `FocusListItem` import (line 1):

```ts
import type { FocusListItem } from '@/notepad/bible/focus/focus-list-types';
import type { MemorizeCard } from '@/notepad/study/memorize/memorize-types';
```

At the end of the file (after `saveQuickListItems`), add:

```ts
export function loadMemorizeCards(): MemorizeCard[] {
  const raw = readRaw(KEY_MEMORIZE_CARDS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MemorizeCard[]) : [];
  } catch {
    return [];
  }
}

export function saveMemorizeCards(cards: MemorizeCard[]): void {
  writeRaw(KEY_MEMORIZE_CARDS, JSON.stringify(cards));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/notepad/session/session-storage.memorize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/session/session-storage.ts src/notepad/session/session-storage.memorize.test.ts
git commit -m "feat(memorize): add guest localStorage helpers for memorize cards"
```

---

## Task 8: Adapter-selecting hook (`useMemorizeCards.ts`)

**Files:**
- Create: `src/notepad/study/memorize/useMemorizeCards.ts`
- Test: `src/notepad/study/memorize/useMemorizeCards.test.tsx`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `useAuthSession` from `@/auth/context/useAuthSession`; `loadMemorizeCards`/`saveMemorizeCards` from `@/notepad/session/session-storage`; `SupabaseMemorizeAdapter`; `cardKey`, types from `./memorize-types`.
- Produces:
  - `interface UseMemorizeCardsOptions { adapterOverride?: MemorizeAdapter | null; }`
  - `interface UseMemorizeCardsResult { cards: MemorizeCard[]; canSave: boolean; loading: boolean; addCards: (cards: NewMemorizeCard[]) => Promise<MemorizeCard[]>; updateAfterAttempt: (id: string, update: AttemptUpdate) => Promise<void>; removeCard: (id: string) => Promise<void>; refetch: () => void; }`
  - `function useMemorizeCards(opts?: UseMemorizeCardsOptions): UseMemorizeCardsResult`

> **Guest id generation:** reuse the focus-hook idiom — `crypto.randomUUID()` with a `g-${Date.now()}-${rand}` fallback.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/memorize/useMemorizeCards.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { useMemorizeCards } from './useMemorizeCards';
import { InMemoryMemorizeAdapter } from './in-memory-memorize-adapter';
import type { NewMemorizeCard } from './memorize-types';

// Auth + supabase are read at module scope by the hook; the adapterOverride path
// bypasses them, but useAuthSession must still return a shape.
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: null }));

afterEach(cleanup);

const nc = (verse: number): NewMemorizeCard => ({ book: 'jhn', chapter: 3, verse, translation: 'BSB', text: `v${verse}` });

function Harness({ adapter }: { adapter: InMemoryMemorizeAdapter }) {
  const { cards, canSave, addCards, removeCard } = useMemorizeCards({ adapterOverride: adapter });
  return (
    <div>
      <span data-testid="count">{cards.length}</span>
      <span data-testid="canSave">{String(canSave)}</span>
      <button onClick={() => void addCards([nc(16), nc(17)])}>add</button>
      <button onClick={() => cards[0] && void removeCard(cards[0].id)}>remove</button>
    </div>
  );
}

describe('useMemorizeCards (adapter injection)', () => {
  it('loads, adds (optimistically), and removes via the injected adapter', async () => {
    const adapter = new InMemoryMemorizeAdapter();
    render(<Harness adapter={adapter} />);
    expect(screen.getByTestId('canSave').textContent).toBe('true');
    await act(async () => { fireEvent.click(screen.getByText('add')); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await act(async () => { fireEvent.click(screen.getByText('remove')); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});

describe('useMemorizeCards (guest)', () => {
  it('canSave is false and cards persist to localStorage when adapterOverride is null', async () => {
    localStorage.clear();
    function GuestHarness() {
      const { cards, canSave, addCards } = useMemorizeCards({ adapterOverride: null });
      return (
        <div>
          <span data-testid="count">{cards.length}</span>
          <span data-testid="canSave">{String(canSave)}</span>
          <button onClick={() => void addCards([nc(16)])}>add</button>
        </div>
      );
    }
    render(<GuestHarness />);
    expect(screen.getByTestId('canSave').textContent).toBe('false');
    await act(async () => { fireEvent.click(screen.getByText('add')); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(localStorage.getItem('psalms.memorize.cards')).toContain('"verse":16');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/useMemorizeCards.test.tsx`
Expected: FAIL — cannot resolve `./useMemorizeCards`.

- [ ] **Step 3: Write the hook**

```ts
// src/notepad/study/memorize/useMemorizeCards.ts
// Adapter-selecting hook for Memorize cards. Signed-in -> SupabaseMemorizeAdapter;
// guest (no adapter) -> React state mirrored to localStorage. Optimistic updates +
// rollback-to-prev + sonner error toasts live HERE (adapters just throw).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { loadMemorizeCards, saveMemorizeCards } from '@/notepad/session/session-storage';
import { cardKey, type AttemptUpdate, type MemorizeAdapter, type MemorizeCard, type NewMemorizeCard } from './memorize-types';
import { SupabaseMemorizeAdapter } from './supabase-memorize-adapter';

export interface UseMemorizeCardsOptions {
  /** Tests inject an adapter; omit in production to build from supabase + userId.
      `null` forces the guest (localStorage) path. */
  adapterOverride?: MemorizeAdapter | null;
}

export interface UseMemorizeCardsResult {
  cards: MemorizeCard[];
  canSave: boolean;
  loading: boolean;
  addCards: (cards: NewMemorizeCard[]) => Promise<MemorizeCard[]>;
  updateAfterAttempt: (id: string, update: AttemptUpdate) => Promise<void>;
  removeCard: (id: string) => Promise<void>;
  /** Re-read from the store (used to sync a pane when it becomes active). */
  refetch: () => void;
}

function newGuestId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `g-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export function useMemorizeCards(opts: UseMemorizeCardsOptions = {}): UseMemorizeCardsResult {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;

  const adapter: MemorizeAdapter | null = useMemo(() => {
    if (opts.adapterOverride !== undefined) return opts.adapterOverride;
    if (supabase && userId) return new SupabaseMemorizeAdapter(supabase, userId);
    return null;
  }, [opts.adapterOverride, userId]);

  const canSave = adapter != null;

  const [cards, setCards] = useState<MemorizeCard[]>(() => (adapter ? [] : loadMemorizeCards()));
  const [loading, setLoading] = useState<boolean>(adapter != null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load: from the adapter when present, else from localStorage (guest).
  useEffect(() => {
    if (!adapter) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCards(loadMemorizeCards());
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    adapter.list()
      .then((loaded) => { if (!cancelled) { setCards(loaded); setLoading(false); } })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useMemorizeCards] load failed:', err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [adapter, refreshKey]);

  const persistGuest = useCallback((next: MemorizeCard[]) => {
    setCards(next);
    saveMemorizeCards(next);
  }, []);

  const addCards = useCallback(async (incoming: NewMemorizeCard[]): Promise<MemorizeCard[]> => {
    if (incoming.length === 0) return [];
    if (!adapter) {
      // Guest: de-dupe against current cards, append with fresh ids + positions.
      const seen = new Set(cards.map(cardKey));
      let position = cards.length;
      const created: MemorizeCard[] = [];
      for (const c of incoming) {
        const k = cardKey(c);
        if (seen.has(k)) continue;
        seen.add(k);
        created.push({
          id: newGuestId(),
          book: c.book, chapter: c.chapter, verse: c.verse,
          translation: c.translation, text: c.text,
          mastery: 0, attempts: 0, lastPracticedAt: null, position: position++,
        });
      }
      if (created.length > 0) persistGuest([...cards, ...created]);
      return created;
    }
    const prev = cards;
    try {
      const created = await adapter.add(incoming);
      setCards((cur) => [...cur, ...created]);
      return created;
    } catch (err) {
      console.warn('[useMemorizeCards] add failed:', err);
      setCards(prev);
      toast.error('Could not add to Memorize. Please try again.');
      return [];
    }
  }, [adapter, cards, persistGuest]);

  const updateAfterAttempt = useCallback(async (id: string, update: AttemptUpdate) => {
    const apply = (list: MemorizeCard[]) => list.map((c) => (c.id === id ? { ...c, ...update } : c));
    if (!adapter) { persistGuest(apply(cards)); return; }
    const prev = cards;
    setCards(apply);
    try {
      await adapter.updateAfterAttempt(id, update);
    } catch (err) {
      console.warn('[useMemorizeCards] updateAfterAttempt failed:', err);
      setCards(prev);
      toast.error('Could not save your progress. Please try again.');
    }
  }, [adapter, cards, persistGuest]);

  const removeCard = useCallback(async (id: string) => {
    if (!adapter) {
      persistGuest(cards.filter((c) => c.id !== id).map((c, position) => ({ ...c, position })));
      return;
    }
    const prev = cards;
    setCards((cur) => cur.filter((c) => c.id !== id).map((c, position) => ({ ...c, position })));
    try {
      await adapter.remove(id);
    } catch (err) {
      console.warn('[useMemorizeCards] remove failed:', err);
      setCards(prev);
      toast.error('Could not remove the card. Please try again.');
    }
  }, [adapter, cards, persistGuest]);

  return { cards, canSave, loading, addCards, updateAfterAttempt, removeCard, refetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/useMemorizeCards.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/useMemorizeCards.ts src/notepad/study/memorize/useMemorizeCards.test.tsx
git commit -m "feat(memorize): add useMemorizeCards hook (adapter + guest, optimistic)"
```

---

## Task 9: Migration `049_memorize_cards.sql`

**Files:**
- Create: `supabase/migrations/049_memorize_cards.sql`

There is no unit test for SQL; the acceptance check is that it parses and mirrors 042 conventions exactly (single flat table, profiles FK, one-policy-per-verb, shared trigger reuse).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/049_memorize_cards.sql
-- Per-user Memorize cards: a flat, per-user set of memorization cards (card = one
-- verse). Unlike scripture_focus_lists (which store ref-only), a card SNAPSHOTS the
-- verse text + translation so a quiz stays stable even if the reader's translation
-- later changes. Owner-only RLS mirrors 042_scripture_focus_lists.sql
-- (auth.uid() = user_id; user_id references public.profiles, not auth.users).
create table if not exists public.memorize_cards (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  book              text not null,        -- OSIS abbrev, e.g. 'jhn'
  chapter           integer not null,
  verse             integer not null,     -- one verse per card
  translation       text not null,        -- snapshot's translation, e.g. 'BSB'
  text              text not null,        -- frozen snapshot of the verse text
  mastery           integer not null default 0,   -- 0-100
  attempts          integer not null default 0,
  last_practiced_at timestamptz,          -- null until first practice
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, book, chapter, verse, translation)
);

create index if not exists memorize_cards_user_idx
  on public.memorize_cards (user_id, position);

alter table public.memorize_cards enable row level security;

-- Owner-only on every verb.
create policy "Users can view own memorize cards"
  on public.memorize_cards for select using (auth.uid() = user_id);
create policy "Users can insert own memorize cards"
  on public.memorize_cards for insert with check (auth.uid() = user_id);
create policy "Users can update own memorize cards"
  on public.memorize_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own memorize cards"
  on public.memorize_cards for delete using (auth.uid() = user_id);

-- Reuse the shared updated_at trigger fn (defined once in 003_triggers.sql).
create trigger memorize_cards_updated_at
  before update on public.memorize_cards
  for each row execute function public.update_updated_at();
```

- [ ] **Step 2: Sanity-check numbering + FK target**

Run: `ls supabase/migrations/ | sort | tail -3`
Expected: `047_… 048_bible_etymology.sql 049_memorize_cards.sql` (049 is the new highest).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/049_memorize_cards.sql
git commit -m "feat(memorize): add 049 memorize_cards table + RLS"
```

> **Note:** applying to the linked prod DB (`--linked`, project `xnldoqfpzlwxjuwvkmqa`) is an operational step done later with the user's go-ahead — NOT part of building/testing this branch.

---

## Task 10: Cloze quiz mode (`ClozeQuiz.tsx`)

**Files:**
- Create: `src/notepad/study/memorize/ClozeQuiz.tsx`
- Test: `src/notepad/study/memorize/ClozeQuiz.test.tsx`

**Interfaces:**
- Consumes: `tokenize`, `selectBlankIndices`, `gradeCloze`, `seedFromString` from `./cloze`; `MemorizeCard` from `./memorize-types`.
- Produces: `function ClozeQuiz(props: { card: MemorizeCard; seedSalt: number; onGraded: (scorePercent: number) => void })`.

Behavior: on mount, tokenize `card.text`, select blanks at difficulty `0.35` with seed `seedFromString(card.id) + seedSalt` (salt makes re-practice reshuffle across sessions while staying stable within one). Render the verse with `<input>` boxes at blank positions; a **Check** button grades and shows per-blank ✓/✗ plus a score, then a **Continue** button calls `onGraded(scorePercent)`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/memorize/ClozeQuiz.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClozeQuiz } from './ClozeQuiz';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const card: MemorizeCard = {
  id: 'card-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved the world', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('ClozeQuiz', () => {
  it('renders an input per blank and reports 100% when all correct', () => {
    const onGraded = vi.fn();
    render(<ClozeQuiz card={card} seedSalt={0} onGraded={onGraded} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
    // Fill each blank with its expected word (exposed via data-answer for the test).
    inputs.forEach((el) => {
      const expected = (el as HTMLInputElement).getAttribute('data-answer') ?? '';
      fireEvent.change(el, { target: { value: expected } });
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith(100);
  });

  it('reports a partial score when a blank is wrong', () => {
    const onGraded = vi.fn();
    render(<ClozeQuiz card={card} seedSalt={0} onGraded={onGraded} />);
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((el, i) => {
      const expected = (el as HTMLInputElement).getAttribute('data-answer') ?? '';
      fireEvent.change(el, { target: { value: i === 0 ? 'WRONG' : expected } });
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const score = onGraded.mock.calls[0][0];
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/ClozeQuiz.test.tsx`
Expected: FAIL — cannot resolve `./ClozeQuiz`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/memorize/ClozeQuiz.tsx
// Fill-in-the-blank mode. Blanks are chosen deterministically (seeded) so they
// don't reshuffle mid-attempt. Grading normalizes case/punctuation.
import { useMemo, useState } from 'react';
import { tokenize, selectBlankIndices, gradeCloze, seedFromString, type Token } from './cloze';
import type { MemorizeCard } from './memorize-types';

const DIFFICULTY = 0.35;

export interface ClozeQuizProps {
  card: MemorizeCard;
  /** Varies the blank selection between sessions while staying stable within one. */
  seedSalt: number;
  onGraded: (scorePercent: number) => void;
}

export function ClozeQuiz({ card, seedSalt, onGraded }: ClozeQuizProps) {
  const tokens = useMemo<Token[]>(() => tokenize(card.text), [card.text]);
  const blankIndices = useMemo(
    () => selectBlankIndices(tokens, DIFFICULTY, seedFromString(card.id) + seedSalt),
    [tokens, card.id, seedSalt],
  );
  const blankSlot = useMemo(() => {
    const map = new Map<number, number>(); // token index -> blank ordinal
    blankIndices.forEach((tokenIndex, ordinal) => map.set(tokenIndex, ordinal));
    return map;
  }, [blankIndices]);

  const [answers, setAnswers] = useState<string[]>(() => blankIndices.map(() => ''));
  const [graded, setGraded] = useState<ReturnType<typeof gradeCloze> | null>(null);

  const setAnswer = (ordinal: number, value: string) => {
    setAnswers((cur) => { const next = [...cur]; next[ordinal] = value; return next; });
  };

  const check = () => setGraded(gradeCloze(tokens, blankIndices, answers));

  return (
    <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 2, color: 'var(--deep-umber)' }}>
      <p>
        {tokens.map((t) => {
          const ordinal = blankSlot.get(t.index);
          if (ordinal === undefined) return <span key={t.index}>{t.text}</span>;
          const ok = graded?.perBlank[ordinal];
          return (
            <input
              key={t.index}
              aria-label={`Blank ${ordinal + 1}`}
              data-answer={t.text}
              value={answers[ordinal]}
              disabled={graded != null}
              onChange={(e) => setAnswer(ordinal, e.target.value)}
              style={{
                width: `${Math.max(3, t.text.length)}ch`,
                margin: '0 2px',
                borderRadius: 4,
                border: `1px solid ${graded == null ? 'var(--pale-stone)' : ok ? '#3f9d5a' : '#b45454'}`,
                background: 'transparent',
                color: graded == null ? 'var(--deep-umber)' : ok ? '#3f9d5a' : '#b45454',
                fontFamily: 'Georgia, serif',
                padding: '2px 4px',
              }}
            />
          );
        })}
      </p>
      {graded == null ? (
        <button type="button" onClick={check} style={primaryBtn}>Check</button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13, marginBottom: 8 }}>
            You got {graded.correct}/{graded.total} — {graded.scorePercent}%
          </p>
          <button type="button" onClick={() => onGraded(graded.scorePercent)} style={primaryBtn}>Continue</button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--lamplight-accent)',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'Outfit, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  minHeight: 40,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/ClozeQuiz.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/ClozeQuiz.tsx src/notepad/study/memorize/ClozeQuiz.test.tsx
git commit -m "feat(memorize): add ClozeQuiz mode component"
```

---

## Task 11: Blank-page quiz mode (`BlankPageQuiz.tsx`)

**Files:**
- Create: `src/notepad/study/memorize/BlankPageQuiz.tsx`
- Test: `src/notepad/study/memorize/BlankPageQuiz.test.tsx`

**Interfaces:**
- Consumes: `diffRecall` from `./blank-page-diff`; `MemorizeCard` from `./memorize-types`.
- Produces: `function BlankPageQuiz(props: { card: MemorizeCard; onGraded: (scorePercent: number) => void })`.

Behavior: a `<textarea>` for the recall + a **Reveal & compare** button that renders the diff (matched normal, missed struck/amber, extra red) and the % matched, then a **Continue** button that calls `onGraded(scorePercent)`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/memorize/BlankPageQuiz.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BlankPageQuiz } from './BlankPageQuiz';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const card: MemorizeCard = {
  id: 'card-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('BlankPageQuiz', () => {
  it('scores 100% on a perfect recall and passes it on Continue', () => {
    const onGraded = vi.fn();
    render(<BlankPageQuiz card={card} onGraded={onGraded} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'for god so loved' } });
    fireEvent.click(screen.getByRole('button', { name: /reveal|compare/i }));
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith(100);
  });

  it('scores partially when a word is missed', () => {
    const onGraded = vi.fn();
    render(<BlankPageQuiz card={card} onGraded={onGraded} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'For God loved' } });
    fireEvent.click(screen.getByRole('button', { name: /reveal|compare/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith(75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/BlankPageQuiz.test.tsx`
Expected: FAIL — cannot resolve `./BlankPageQuiz`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/memorize/BlankPageQuiz.tsx
// "Blank page" full-recall mode: type the verse from memory, then reveal a
// word-level diff against the frozen snapshot and self-confirm.
import { useState } from 'react';
import { diffRecall, type BlankPageDiff } from './blank-page-diff';
import type { MemorizeCard } from './memorize-types';

export interface BlankPageQuizProps {
  card: MemorizeCard;
  onGraded: (scorePercent: number) => void;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  matched: { color: 'var(--deep-umber)' },
  missed: { color: '#b58a3c', textDecoration: 'underline' },
  extra: { color: '#b45454', textDecoration: 'line-through' },
};

export function BlankPageQuiz({ card, onGraded }: BlankPageQuizProps) {
  const [entry, setEntry] = useState('');
  const [diff, setDiff] = useState<BlankPageDiff | null>(null);

  return (
    <div style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)' }}>
      {diff == null ? (
        <>
          <textarea
            aria-label="Type the verse from memory"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            rows={4}
            placeholder="Type the verse from memory…"
            style={{
              width: '100%', borderRadius: 6, border: '1px solid var(--pale-stone)',
              background: 'transparent', color: 'var(--deep-umber)', padding: 10,
              fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 1.7, resize: 'vertical',
            }}
          />
          <button type="button" onClick={() => setDiff(diffRecall(card.text, entry))} style={primaryBtn}>
            Reveal &amp; compare
          </button>
        </>
      ) : (
        <div>
          <p style={{ fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 2 }}>
            {diff.tokens.map((t, i) => (
              <span key={i} style={STATUS_STYLE[t.status]}>{t.text}{' '}</span>
            ))}
          </p>
          <p style={{ fontSize: 13, margin: '8px 0' }}>
            {diff.matched}/{diff.totalExpected} words — {diff.scorePercent}%
          </p>
          <button type="button" onClick={() => onGraded(diff.scorePercent)} style={primaryBtn}>Continue</button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  marginTop: 12, padding: '9px 18px', borderRadius: 6, border: 'none',
  background: 'var(--lamplight-accent)', color: '#fff', cursor: 'pointer',
  fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 500, minHeight: 40,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/BlankPageQuiz.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/BlankPageQuiz.tsx src/notepad/study/memorize/BlankPageQuiz.test.tsx
git commit -m "feat(memorize): add BlankPageQuiz recall mode"
```

---

## Task 12: Flashcard quiz mode (`FlashcardQuiz.tsx`)

**Files:**
- Create: `src/notepad/study/memorize/FlashcardQuiz.tsx`
- Test: `src/notepad/study/memorize/FlashcardQuiz.test.tsx`

**Interfaces:**
- Consumes: `formatCardRef`, `MemorizeCard` from `./memorize-types`.
- Produces: `function FlashcardQuiz(props: { card: MemorizeCard; onGraded: (scorePercent: number) => void })`.

Behavior: shows the **reference** (`formatCardRef(card)`) as the prompt; a **Reveal** button flips to show `card.text`; then **Again** (→ `onGraded(0)`) and **Got it** (→ `onGraded(100)`).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/memorize/FlashcardQuiz.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FlashcardQuiz } from './FlashcardQuiz';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const card: MemorizeCard = {
  id: 'card-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved the world', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('FlashcardQuiz', () => {
  it('shows the reference, reveals the text, and grades Got it as 100', () => {
    const onGraded = vi.fn();
    render(<FlashcardQuiz card={card} onGraded={onGraded} />);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.queryByText(/for god so loved/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    expect(screen.getByText(/for god so loved the world/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onGraded).toHaveBeenCalledWith(100);
  });

  it('grades Again as 0', () => {
    const onGraded = vi.fn();
    render(<FlashcardQuiz card={card} onGraded={onGraded} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    fireEvent.click(screen.getByRole('button', { name: /again/i }));
    expect(onGraded).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/FlashcardQuiz.test.tsx`
Expected: FAIL — cannot resolve `./FlashcardQuiz`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/memorize/FlashcardQuiz.tsx
// Reference flashcard mode: prompt with the reference, reveal the verse, self-rate.
import { useState } from 'react';
import { formatCardRef, type MemorizeCard } from './memorize-types';

export interface FlashcardQuizProps {
  card: MemorizeCard;
  onGraded: (scorePercent: number) => void;
}

export function FlashcardQuiz({ card, onGraded }: FlashcardQuizProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)', textAlign: 'center' }}>
      <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>{formatCardRef(card)}</p>
      {revealed ? (
        <>
          <p style={{ fontFamily: 'Georgia, serif', fontSize: 16, lineHeight: 1.8, marginBottom: 20 }}>{card.text}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button type="button" onClick={() => onGraded(0)} style={{ ...rateBtn, background: '#efe4e0', color: '#b45454' }}>Again</button>
            <button type="button" onClick={() => onGraded(100)} style={{ ...rateBtn, background: 'var(--lamplight-accent)', color: '#fff' }}>Got it</button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setRevealed(true)} style={{ ...rateBtn, background: 'var(--lamplight-accent)', color: '#fff' }}>
          Reveal
        </button>
      )}
    </div>
  );
}

const rateBtn: React.CSSProperties = {
  padding: '10px 22px', borderRadius: 6, border: 'none', cursor: 'pointer',
  fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 500, minHeight: 44,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/FlashcardQuiz.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/FlashcardQuiz.tsx src/notepad/study/memorize/FlashcardQuiz.test.tsx
git commit -m "feat(memorize): add FlashcardQuiz mode"
```

---

## Task 13: Quiz session runner (`QuizSession.tsx`)

**Files:**
- Create: `src/notepad/study/memorize/QuizSession.tsx`
- Test: `src/notepad/study/memorize/QuizSession.test.tsx`

**Interfaces:**
- Consumes: `ClozeQuiz`, `BlankPageQuiz`, `FlashcardQuiz`; `formatCardRef`, `MemorizeCard` from `./memorize-types`.
- Produces:
  - `type QuizMode = 'cloze' | 'blank-page' | 'flashcard'`
  - `function QuizSession(props: { cards: MemorizeCard[]; onCommit: (results: Array<{ id: string; attemptScore: number }>) => void; onExit: () => void })`

Behavior: mode chips (default `'cloze'`); progress dots (`i+1 / cards.length`); renders the active mode component for the current card; each `onGraded(score)` records `{ id, attemptScore }` and advances; after the last card shows a summary (average %) with a **Done** button that calls `onCommit(results)` then `onExit()`. Changing mode restarts the run (index 0, results cleared). A `seedSalt` (from a mount-time counter that increments each restart) is threaded into `ClozeQuiz`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/memorize/QuizSession.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QuizSession } from './QuizSession';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const mk = (id: string, verse: number): MemorizeCard => ({
  id, book: 'jhn', chapter: 3, verse, translation: 'BSB',
  text: 'For God so loved the world', mastery: 0, attempts: 0, lastPracticedAt: null, position: verse,
});

describe('QuizSession', () => {
  it('runs flashcard mode across two cards and commits per-card scores', () => {
    const onCommit = vi.fn();
    const onExit = vi.fn();
    render(<QuizSession cards={[mk('a', 16), mk('b', 17)]} onCommit={onCommit} onExit={onExit} />);

    // Switch to Flashcard (deterministic, no typing needed).
    fireEvent.click(screen.getByRole('button', { name: /flashcard/i }));

    // Card 1
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    // Card 2
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    fireEvent.click(screen.getByRole('button', { name: /again/i }));

    // Summary -> Done
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onCommit).toHaveBeenCalledWith([
      { id: 'a', attemptScore: 100 },
      { id: 'b', attemptScore: 0 },
    ]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('exits when the close control is used', () => {
    const onExit = vi.fn();
    render(<QuizSession cards={[mk('a', 16)]} onCommit={vi.fn()} onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: /close quiz|exit/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/QuizSession.test.tsx`
Expected: FAIL — cannot resolve `./QuizSession`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/memorize/QuizSession.tsx
// Runs a passage's cards one at a time in a chosen mode, then hands the per-card
// attempt scores back for mastery write-back.
import { useState } from 'react';
import { X } from 'lucide-react';
import { ClozeQuiz } from './ClozeQuiz';
import { BlankPageQuiz } from './BlankPageQuiz';
import { FlashcardQuiz } from './FlashcardQuiz';
import { formatCardRef, type MemorizeCard } from './memorize-types';

export type QuizMode = 'cloze' | 'blank-page' | 'flashcard';

const MODES: Array<{ id: QuizMode; label: string }> = [
  { id: 'cloze', label: 'Cloze' },
  { id: 'blank-page', label: 'Blank-page' },
  { id: 'flashcard', label: 'Flashcard' },
];

export interface QuizSessionProps {
  cards: MemorizeCard[];
  onCommit: (results: Array<{ id: string; attemptScore: number }>) => void;
  onExit: () => void;
}

export function QuizSession({ cards, onCommit, onExit }: QuizSessionProps) {
  const [mode, setMode] = useState<QuizMode>('cloze');
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Array<{ id: string; attemptScore: number }>>([]);
  const [salt, setSalt] = useState(0); // reshuffles cloze blanks on restart

  const restart = (nextMode: QuizMode) => {
    setMode(nextMode);
    setIndex(0);
    setResults([]);
    setSalt((s) => s + 1);
  };

  const record = (attemptScore: number) => {
    const card = cards[index];
    setResults((cur) => [...cur, { id: card.id, attemptScore }]);
    setIndex((i) => i + 1);
  };

  const done = index >= cards.length && cards.length > 0;
  const current = cards[index];
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.attemptScore, 0) / results.length) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderBottom: '1px solid var(--pale-stone)' }}>
        <div role="tablist" aria-label="Quiz mode" style={{ display: 'flex', gap: 6, flex: 1 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => restart(m.id)}
              style={{
                padding: '6px 12px', borderRadius: 999, minHeight: 34, cursor: 'pointer',
                fontSize: 12, fontFamily: 'Outfit, sans-serif',
                border: `1px solid ${mode === m.id ? 'var(--lamplight-accent)' : 'var(--pale-stone)'}`,
                background: mode === m.id ? 'var(--lamplight-accent)' : 'transparent',
                color: mode === m.id ? '#fff' : 'var(--silica)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Close quiz" onClick={onExit} style={iconBtn}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', padding: 16 }}>
        {done ? (
          <div style={{ textAlign: 'center', color: 'var(--deep-umber)' }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Session complete</p>
            <p style={{ fontSize: 13, color: 'var(--silica)', marginBottom: 20 }}>Average score {avg}%</p>
            <button type="button" onClick={() => { onCommit(results); onExit(); }} style={primaryBtn}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--silica)' }}>{formatCardRef(current)}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--silica)' }}>{index + 1} / {cards.length}</span>
            </div>
            {mode === 'cloze' && <ClozeQuiz key={`${current.id}-${salt}`} card={current} seedSalt={salt} onGraded={record} />}
            {mode === 'blank-page' && <BlankPageQuiz key={`${current.id}-${salt}`} card={current} onGraded={record} />}
            {mode === 'flashcard' && <FlashcardQuiz key={`${current.id}-${salt}`} card={current} onGraded={record} />}
          </>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
  border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)', borderRadius: 6,
};
const primaryBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 6, border: 'none', background: 'var(--lamplight-accent)',
  color: '#fff', cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 500, minHeight: 40,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/QuizSession.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/QuizSession.tsx src/notepad/study/memorize/QuizSession.test.tsx
git commit -m "feat(memorize): add QuizSession runner with mode chips + summary"
```

---

## Task 14: Memorize home panel (`MemorizePanel.tsx`)

**Files:**
- Create: `src/notepad/study/memorize/MemorizePanel.tsx`
- Test: `src/notepad/study/memorize/MemorizePanel.test.tsx`

**Interfaces:**
- Consumes: `useMemorizeCards`; `useBiblePrefs` from `@/notepad/bible/prefs/bible-prefs-context`; `useBiblePassages` from `@/notepad/bible/useBiblePassages`; `QuizSession`; `formatCardRef`, `applyAttempt`, types.
- Produces: `function MemorizePanel(props: { book: string; chapter: number; userId: string | null; active: boolean })`.

Behavior:
- Header row: title + **＋ Add current passage** button (adds every verse of the Reader's current `book/chapter` at the active translation via `addCards`).
- Cards grouped by `book+chapter`; each group has a header with the passage ref (`formatCardRef` of its first verse, book+chapter part) and a **Practice ▸** button; each row shows the verse ref + a truncated text preview + a **mastery bar** (0–100%) + a remove (✕) control.
- Empty state when `cards.length === 0`.
- **Practice** opens `QuizSession` (display-toggled, so a quiz survives tab switches) scoped to that group's cards; on commit, for each result call `updateAfterAttempt(id, applyAttempt(card, attemptScore, new Date().toISOString()))`.
- **Cross-pane sync mitigation:** when `active` transitions false→true, call `refetch()` (an added-from-Reader card shows up without a full remount). Implemented with a `usePrevious`-style ref.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/memorize/MemorizePanel.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// Mock the data hooks so the panel is testable without supabase/providers.
const addCards = vi.fn().mockResolvedValue([]);
const refetch = vi.fn();
vi.mock('./useMemorizeCards', () => ({
  useMemorizeCards: () => ({
    cards: [
      { id: 'a', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world', mastery: 40, attempts: 1, lastPracticedAt: null, position: 0 },
    ],
    canSave: true, loading: false, addCards, updateAfterAttempt: vi.fn(), removeCard: vi.fn(), refetch,
  }),
}));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('@/notepad/bible/useBiblePassages', () => ({
  useBiblePassages: () => ({ verses: [{ verse: 16, text: 'For God so loved the world' }], loading: false, error: null }),
}));

import { MemorizePanel } from './MemorizePanel';

afterEach(() => { cleanup(); addCards.mockClear(); refetch.mockClear(); });

describe('MemorizePanel', () => {
  it('lists a saved card with its reference', () => {
    render(<MemorizePanel book="jhn" chapter={3} userId="u1" active />);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
  });

  it('adds the current passage', async () => {
    render(<MemorizePanel book="jhn" chapter={3} userId="u1" active />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add current passage/i })); });
    expect(addCards).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world' },
    ]);
  });

  it('refetches when it becomes active (false -> true)', () => {
    const { rerender } = render(<MemorizePanel book="jhn" chapter={3} userId="u1" active={false} />);
    refetch.mockClear();
    rerender(<MemorizePanel book="jhn" chapter={3} userId="u1" active />);
    expect(refetch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/memorize/MemorizePanel.test.tsx`
Expected: FAIL — cannot resolve `./MemorizePanel`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/memorize/MemorizePanel.tsx
// Memorize home: grouped saved cards with mastery bars + entry into a quiz session.
// Verses are snapshotted (text + translation) so a quiz is stable across
// translation changes. Guests persist to localStorage; signed-in users to Supabase.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Play, X } from 'lucide-react';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { useBiblePassages } from '@/notepad/bible/useBiblePassages';
import { useMemorizeCards } from './useMemorizeCards';
import { QuizSession } from './QuizSession';
import { formatCardRef, type MemorizeCard } from './memorize-types';
import { applyAttempt } from './mastery';
import { bookByAbbrev } from '@/notepad/bible/bible-books';

export interface MemorizePanelProps {
  book: string;
  chapter: number;
  userId: string | null;
  /** True when the Memorize tab is the visible pane. Used to refetch on activation. */
  active: boolean;
}

interface Group {
  key: string;
  book: string;
  chapter: number;
  cards: MemorizeCard[];
}

function groupCards(cards: MemorizeCard[]): Group[] {
  const map = new Map<string, Group>();
  for (const c of cards) {
    const key = `${c.book}|${c.chapter}`;
    let g = map.get(key);
    if (!g) { g = { key, book: c.book, chapter: c.chapter, cards: [] }; map.set(key, g); }
    g.cards.push(c);
  }
  return [...map.values()];
}

export function MemorizePanel({ book, chapter, active }: MemorizePanelProps) {
  const { translation } = useBiblePrefs();
  const { verses } = useBiblePassages(book, chapter, translation);
  const { cards, addCards, updateAfterAttempt, removeCard, refetch } = useMemorizeCards();
  const [sessionKey, setSessionKey] = useState<string | null>(null);

  // Refetch when this pane becomes active (a card added from the Reader popover by
  // a separate hook instance won't be in our state until we re-read the store).
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) refetch();
    wasActive.current = active;
  }, [active, refetch]);

  const groups = useMemo(() => groupCards(cards), [cards]);
  const sessionCards = useMemo(
    () => (sessionKey ? groups.find((g) => g.key === sessionKey)?.cards ?? [] : []),
    [sessionKey, groups],
  );

  const addCurrentPassage = () => {
    if (verses.length === 0) return;
    void addCards(verses.map((v) => ({ book, chapter, verse: v.verse, translation, text: v.text })));
  };

  const commit = (results: Array<{ id: string; attemptScore: number }>) => {
    const now = new Date().toISOString();
    for (const r of results) {
      const card = cards.find((c) => c.id === r.id);
      if (card) void updateAfterAttempt(r.id, applyAttempt(card, r.attemptScore, now));
    }
  };

  const inSession = sessionKey != null && sessionCards.length > 0;
  const passageLabel = (g: Group) => `${bookByAbbrev(g.book)?.name ?? g.book} ${g.chapter}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      {/* Quiz session overlays the home view but stays mounted (display toggle). */}
      <div style={{ display: inSession ? 'block' : 'none', height: '100%' }}>
        {inSession && (
          <QuizSession
            key={sessionKey}
            cards={sessionCards}
            onCommit={commit}
            onExit={() => setSessionKey(null)}
          />
        )}
      </div>

      <div style={{ display: inSession ? 'none' : 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderBottom: '1px solid var(--pale-stone)' }}>
          <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--silica)' }}>Memorize</span>
          <button type="button" onClick={addCurrentPassage} style={addBtn}>
            <Plus className="w-3.5 h-3.5" /> Add current passage
          </button>
        </div>

        <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', padding: 12 }}>
          {cards.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--silica)', padding: '32px 16px', fontSize: 13 }}>
              No verses yet. Tap <strong>Add current passage</strong> to start memorizing {bookByAbbrev(book)?.name ?? book} {chapter}.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--deep-umber)' }}>{passageLabel(g)}</span>
                  <button type="button" onClick={() => setSessionKey(g.key)} style={practiceBtn}>
                    <Play className="w-3 h-3" /> Practice
                  </button>
                </div>
                {g.cards.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--deep-umber)' }}>{formatCardRef(c)}</div>
                      <div style={{ fontSize: 11, color: 'var(--silica)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                      <div aria-label={`Mastery ${c.mastery}%`} style={{ height: 4, borderRadius: 2, background: 'var(--pale-stone)', marginTop: 4 }}>
                        <div style={{ width: `${c.mastery}%`, height: '100%', borderRadius: 2, background: 'var(--lamplight-accent)' }} />
                      </div>
                    </div>
                    <button type="button" aria-label={`Remove ${formatCardRef(c)}`} onClick={() => void removeCard(c.id)} style={iconBtn}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const addBtn: React.CSSProperties = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px',
  borderRadius: 6, border: 'none', background: 'var(--lamplight-accent)', color: '#fff',
  cursor: 'pointer', fontSize: 12, fontWeight: 500, minHeight: 34,
};
const practiceBtn: React.CSSProperties = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  borderRadius: 6, border: '1px solid var(--pale-stone)', background: 'transparent',
  color: 'var(--deep-umber)', cursor: 'pointer', fontSize: 11, minHeight: 30,
};
const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)', borderRadius: 6,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/memorize/MemorizePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/memorize/MemorizePanel.tsx src/notepad/study/memorize/MemorizePanel.test.tsx
git commit -m "feat(memorize): add MemorizePanel home view + quiz entry + active refetch"
```

---

## Task 15: Wire the `memorize` tab into `StudySidePanel.tsx`

**Files:**
- Modify: `src/notepad/study/panes/StudySidePanel.tsx`
- Modify: `src/notepad/study/panes/StudySidePanel.test.tsx`

**Interfaces:**
- Consumes: `MemorizePanel` from `../../memorize/MemorizePanel` (path from `panes/` → `memorize/`).

- [ ] **Step 1: Extend the test (write the failing assertions first)**

In `StudySidePanel.test.tsx`, add the MemorizePanel mock after the existing mocks (line 12):

```tsx
vi.mock('./LamplightStudyPanel', () => ({ LamplightStudyPanel: () => <div>chat-panel</div> }));
vi.mock('../../memorize/MemorizePanel', () => ({ MemorizePanel: () => <div>memorize-panel</div> }));
```

Then add these tests inside the `describe('StudySidePanel', …)` block:

```tsx
it('renders a Memorize tab, unselected by default', () => {
  render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
  expect(screen.getByRole('tab', { name: /memorize/i }).getAttribute('aria-selected')).toBe('false');
});

it('clicking the Memorize tab switches selection and shows the panel', () => {
  render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
  fireEvent.click(screen.getByRole('tab', { name: /memorize/i }));
  expect(screen.getByRole('tab', { name: /memorize/i }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: /notes/i }).getAttribute('aria-selected')).toBe('false');
  expect(screen.getByText('memorize-panel')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/notepad/study/panes/StudySidePanel.test.tsx`
Expected: FAIL — no `memorize` tab.

- [ ] **Step 3: Add the import + union + button + pane**

In `StudySidePanel.tsx`:

a) Add the import after the `LamplightStudyPanel` import (line 14):

```tsx
import { LamplightStudyPanel } from './LamplightStudyPanel';
import { MemorizePanel } from '../../memorize/MemorizePanel';
```

b) Widen the union (line 16):

```tsx
type StudyTab = 'notes' | 'chat' | 'memorize';
```

c) Add the third tab button inside the `role="tablist"` div, right after the Chat button (after line 189):

```tsx
          <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')} style={tabStyle(tab === 'chat')}>
            Chat
          </button>
          <button role="tab" aria-selected={tab === 'memorize'} onClick={() => setTab('memorize')} style={tabStyle(tab === 'memorize')}>
            Memorize
          </button>
```

d) Add the fourth pane after the chat pane (after the closing `</div>` of the chat pane at line 230):

```tsx
      <div
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          overflow: 'auto',
          display: tab === 'memorize' ? 'block' : 'none',
        }}
      >
        <MemorizePanel book={book} chapter={chapter} userId={userId} active={tab === 'memorize'} />
      </div>
```

- [ ] **Step 4: Run to verify the panel tests pass**

Run: `npx vitest run src/notepad/study/panes/StudySidePanel.test.tsx`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/panes/StudySidePanel.tsx src/notepad/study/panes/StudySidePanel.test.tsx
git commit -m "feat(memorize): add Memorize tab to the Study side panel"
```

---

## Task 16: "Add to Memorize" Reader affordance (`BibleReader.tsx` + wire in `StudyReader.tsx`)

**Files:**
- Modify: `src/notepad/bible/BibleReader.tsx`
- Modify: `src/notepad/bible/BibleReader.test.tsx` (add cases; if the file does not exist, create it with the jsdom pragma + house style)
- Modify: `src/notepad/study/panes/StudyReader.tsx`
- Modify: `src/notepad/study/panes/StudyReader.test.tsx` (add a wiring case; create if absent)

**Interfaces:**
- BibleReader gains prop `onAddToMemorize?: (ref: VerseRef, text: string) => void`.
- StudyReader builds one `useMemorizeCards()` and passes `onAddToMemorize`.

**Design decisions (from the handoff):**
- BibleReader has no auth/supabase — persistence is delegated to the parent (like `onSetHighlight`).
- **The picker gate must be broadened.** Today `highlightingEnabled = !!onSetHighlight` gates BOTH `selectVerse`'s anchor logic AND the popover render. StudyReader does NOT pass `onSetHighlight`, so introduce `memorizeEnabled` and a combined `pickerEnabled`, gating the anchor logic on `pickerEnabled`. Render the highlight popover only when `highlightingEnabled`; render a separate **"Add to Memorize"** button when `memorizeEnabled` (avoids editing the shared `HighlightPill`/`HighlightSwatchPopover`).

- [ ] **Step 1: Write the failing BibleReader test**

Create/append `src/notepad/bible/BibleReader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BibleReader } from './BibleReader';

// useBiblePassages hits supabase; stub it with a fixed verse set.
vi.mock('./useBiblePassages', () => ({
  useBiblePassages: () => ({ verses: [{ verse: 1, text: 'In the beginning was the Word' }], loading: false, error: null }),
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(cleanup);

describe('BibleReader — Add to Memorize', () => {
  it('opens an Add to Memorize action on verse tap and reports ref + text', async () => {
    const onAddToMemorize = vi.fn();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={vi.fn()} onAddToMemorize={onAddToMemorize} />);
    fireEvent.click(screen.getByText(/in the beginning was the word/i));
    const addBtn = await screen.findByRole('button', { name: /add to memorize/i });
    fireEvent.click(addBtn);
    expect(onAddToMemorize).toHaveBeenCalledWith(
      { book: 'jhn', chapter: 1, verse: 1 },
      'In the beginning was the Word',
    );
  });

  it('does not render the action when onAddToMemorize is absent', () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/in the beginning was the word/i));
    expect(screen.queryByRole('button', { name: /add to memorize/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: FAIL — no Add to Memorize action.

- [ ] **Step 3: Edit `BibleReader.tsx`**

a) Add the prop to `BibleReaderProps` (after `onRemoveHighlight`, line 52):

```tsx
  /** Remove a verse highlight. */
  onRemoveHighlight?: (verse: number) => void;
  /** Snapshot a verse into the Memorize collection (delegated to the parent). */
  onAddToMemorize?: (ref: VerseRef, text: string) => void;
```

b) Destructure it in the component signature (after `onRemoveHighlight`, line 74):

```tsx
  onRemoveHighlight,
  onAddToMemorize,
```

c) Add the memorize gate + combined gate next to `highlightingEnabled` (line 89):

```tsx
  const highlightingEnabled = !!onSetHighlight;
  const memorizeEnabled = !!onAddToMemorize;
  const pickerEnabled = highlightingEnabled || memorizeEnabled;
```

d) Broaden `selectVerse` to open the anchor when `pickerEnabled` (replace the `if (highlightingEnabled) {` guard at line 165):

```tsx
  const selectVerse = (verse: number) => {
    setSelectedVerse(verse);
    onSelectVerse?.({ book, chapter, verse });
    if (pickerEnabled) {
      const rect = document.getElementById(`bible-verse-${verse}`)?.getBoundingClientRect();
      if (rect) {
        const left = Math.min(rect.left, window.innerWidth - 210);
        setPickerAnchor({ top: rect.bottom + 6, left: Math.max(8, left) });
        setPickerVerse(verse);
        setPickerQuery('');
      }
    }
  };
```

e) Add the Memorize action alongside the highlight popover. Immediately AFTER the existing `{highlightingEnabled && pickerVerse != null && pickerAnchor && ( … )}` block (ends line 440), add:

```tsx
        {memorizeEnabled && pickerVerse != null && pickerAnchor && (
          <div
            style={{
              position: 'fixed',
              top: pickerAnchor.top,
              left: pickerAnchor.left,
              zIndex: 50,
              background: 'var(--parchment, #fff)',
              border: '1px solid var(--pale-stone)',
              borderRadius: 8,
              boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
              padding: 6,
            }}
          >
            <button
              type="button"
              onClick={() => {
                const text = verses.find((v) => v.verse === pickerVerse)?.text ?? '';
                onAddToMemorize?.({ book, chapter, verse: pickerVerse }, text);
                closePicker();
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif', fontSize: 12, minHeight: 40,
              }}
            >
              Add to Memorize
            </button>
          </div>
        )}
```

- [ ] **Step 4: Run to verify BibleReader tests pass**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing StudyReader wiring test**

Create/append `src/notepad/study/panes/StudyReader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const addCards = vi.fn().mockResolvedValue([]);
vi.mock('@/notepad/study/memorize/useMemorizeCards', () => ({ useMemorizeCards: () => ({ addCards }) }));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({
  useBiblePrefs: () => ({ translation: 'BSB', setLocalTranslation: vi.fn(), verseLayout: 'inline', setLocalVerseLayout: vi.fn() }),
}));
// Capture the onAddToMemorize prop BibleReader receives.
let captured: ((ref: { book: string; chapter: number; verse: number }, text: string) => void) | undefined;
vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: { onAddToMemorize?: typeof captured }) => {
    captured = props.onAddToMemorize;
    return <div>reader</div>;
  },
}));

import { StudyReader } from './StudyReader';

afterEach(() => { cleanup(); addCards.mockClear(); captured = undefined; });

describe('StudyReader', () => {
  it('wires onAddToMemorize to addCards with the active translation + snapshot text', () => {
    render(<StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} />);
    expect(typeof captured).toBe('function');
    captured?.({ book: 'jhn', chapter: 3, verse: 16 }, 'For God so loved the world');
    expect(addCards).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world' },
    ]);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/notepad/study/panes/StudyReader.test.tsx`
Expected: FAIL — `onAddToMemorize` is undefined (not wired).

- [ ] **Step 7: Edit `StudyReader.tsx`**

Replace the file body with the wired version:

```tsx
// src/notepad/study/panes/StudyReader.tsx
import { BibleReader, type VerseRef } from '@/notepad/bible/BibleReader';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { useMemorizeCards } from '@/notepad/study/memorize/useMemorizeCards';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
  onSelectVerse?: (ref: VerseRef) => void;
}

export function StudyReader({ book, chapter, onPassageChange, onSelectVerse }: StudyReaderProps) {
  const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout } = useBiblePrefs();
  const { addCards } = useMemorizeCards();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setLocalTranslation}
      verseLayout={verseLayout}
      onVerseLayoutChange={setLocalVerseLayout}
      onPassageChange={onPassageChange}
      onSelectVerse={onSelectVerse}
      onAddToMemorize={(ref, text) => { void addCards([{ ...ref, translation, text }]); }}
      verseNumberColor="var(--study-verse-num)"
    />
  );
}
```

- [ ] **Step 8: Run to verify StudyReader tests pass**

Run: `npx vitest run src/notepad/study/panes/StudyReader.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleReader.test.tsx src/notepad/study/panes/StudyReader.tsx src/notepad/study/panes/StudyReader.test.tsx
git commit -m "feat(memorize): add 'Add to Memorize' reader affordance wired via StudyReader"
```

---

## Task 17: Full-suite gate + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc -b`
Expected: 0 errors. (Fix any before proceeding — the repo lesson: eslint+vitest alone has hidden a prod-build-breaking tsc error.)

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: green **except** the pre-existing `garden-scene` failure, which is NOT ours.

- [ ] **Step 3: Lint every touched file**

Run:
```bash
npx eslint \
  src/notepad/study/memorize/*.ts src/notepad/study/memorize/*.tsx \
  src/notepad/session/session-storage.ts \
  src/notepad/study/panes/StudySidePanel.tsx \
  src/notepad/bible/BibleReader.tsx \
  src/notepad/study/panes/StudyReader.tsx
```
Expected: 0 errors.

- [ ] **Step 4: Browser-verify the tab** (use superpowers:verification-before-completion + the preview tools)

1. `preview_start` the dev server (config **"nba"** is the 3D app — for Psalms use the project's default dev config; if none is named, add one to `.claude/launch.json` running `npm run dev`).
2. Open the notebook → a note → Study side panel. Confirm the **Notes · Chat · Memorize** tabs render and Memorize is reachable.
3. In the Memorize tab, click **Add current passage** → cards appear grouped with mastery bars. Click **Practice** → run one card in each mode (Cloze / Blank-page / Flashcard) → **Done** → confirm the mastery bar moved.
4. In the Study Reader, tap a verse → **Add to Memorize** → switch to the Memorize tab → confirm the verse appears (this exercises the active-refetch cross-pane path).
5. Confirm no console errors (`read_console_messages`).

- [ ] **Step 5: Report evidence** (screenshot the Memorize tab + a quiz in progress). Do NOT claim done without the gate output.

---

## Self-Review (author's checklist — completed)

**1. Spec coverage:**
- §3 placement / display-toggle / mobile-automatic → Task 15 (+ untouched `StudyTabBar` honored).
- §4a home (grouped, mastery bars, add-current-passage, practice, empty state) → Task 14.
- §4b quiz session (mode chips, per-card, summary, mastery write-back) → Task 13.
- §5 snapshot model + both entry points → Task 14 (add current passage) + Task 16 (reader popover).
- §6 cloze / blank-page / flashcard / mastery (pure, TDD) → Tasks 2, 3, 12, 4.
- §7 table + RLS + uniqueness/no-op upsert + adapter split + guest → Tasks 9, 1, 5, 6, 8, 7.
- §8 testing conventions → honored per task (node vs jsdom pragma, `afterEach(cleanup)`, gate trio).
- §9 file plan → every file mapped to a task.
- §10 out-of-scope → nothing built (no first-letter mode, note cards, mind-map, SM-2, reviews table, cross-device guest sync).

**2. Placeholder scan:** none — every code step contains full code; no TODO/TBD/"handle edge cases".

**3. Type consistency:** `MemorizeCard`/`NewMemorizeCard`/`AttemptUpdate`/`MemorizeAdapter` defined in Task 1 and consumed unchanged downstream; `cardKey`/`formatCardRef`/`applyAttempt`/`nextMastery`/`tokenize`/`selectBlankIndices`/`gradeCloze`/`diffRecall`/`seedFromString` signatures match every call site; hook result shape (`cards/canSave/loading/addCards/updateAfterAttempt/removeCard/refetch`) matches `MemorizePanel` + `StudyReader` usage; `onAddToMemorize: (ref: VerseRef, text: string) => void` matches both the BibleReader render and the StudyReader wiring.

## Cross-pane sync — decision of record (flag to the user)

`MemorizePanel` owns a `useMemorizeCards` instance and `StudyReader` owns a **second** instance (for the popover "Add to Memorize"). Both persist to the same store (Supabase table / the one localStorage key), so data is **consistent on next load**, but a card added from the Reader popover while the Memorize tab is already open won't appear **live** until the panel re-reads. **Mitigation (in this plan):** `StudySidePanel` passes `active={tab === 'memorize'}`; `MemorizePanel` calls `refetch()` on the `active` false→true edge (Task 14). This avoids lifting the hook to workspace level (which would touch `StudyWorkspace` + `MobileStudyWorkspace` + their tests — beyond spec scope). Accepted tradeoff: a card added from the Reader while Memorize is *already* the visible tab appears only after a tab round-trip. If the user wants live cross-pane sync, that is a follow-up (lift the hook or add a lightweight store event).
