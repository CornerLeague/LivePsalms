# Etymology Study Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible **Etymology** panel beneath Original Language in the Study tab — a verse-driven deck where Lamplight explains how key Hebrew words grew from their roots, grounded in a real lexicon (never invented), plus an on-demand shared per-verse insight.

**Architecture:** Core etymology content is pre-generated offline, human-proofed, and cached in two shared public-read tables (`bible_etymology`, `bible_etymology_verse_insight`). The panel reads them with pure client Supabase queries (cloning `useStrongsEntry`); reads are free and public. The *only* gated, on-demand action is **generating** a not-yet-existing verse insight, which routes through a new `etymology-insight` edge function (Anthropic key stays server-side) using the shared `runGeneration` lifecycle seam.

**Tech Stack:** React + TypeScript + Vite · Supabase (Postgres + RLS + Edge Functions/Deno) · Anthropic (Opus, tool-use) · vitest + @testing-library/react (jsdom) for all tests, including the edge-fn logic modules.

## Global Constraints

_Every task's requirements implicitly include this section._

- **v1 scope = Psalms + Hebrew only.** Greek/NT and the rest of the OT are deferred; the schema grows by adding rows, not by changing shape.
- **Reads are free/public for everyone (logged-out included); only insight *generation* is gated** through the existing Lamplight entitlement.
- **Never-invent grounding.** All etymology narration retells only verified lexicon facts (OpenScriptures Strong's `derivation` + BDB). The runtime insight is conditioned on the word's already-reviewed entry + the verse text.
- **Completion gate MUST run `npx tsc -b`** (not just `eslint` + `vitest`) — a prod-build type error can hide behind passing lint and tests. `build` = `tsc -b && vite build`; `test` = `vitest run`; `lint` = `eslint .`.
- **TDD + deletion-test discipline.** Write the failing test first; watch it fail; implement minimally; watch it pass; commit.
- **Branch:** `feat/etymology-study` (isolated from onboarding PR #77). Commit each task.
- **Migration number: `048`.**
- **`verse_id` is text OSIS** (e.g. `'psa.23.1'`) everywhere — matches `bible_interlinear`, `bible_passages`, `bible_etymology_verse_insight`.
- **RTL reading order = `position asc`** (already the order `useVerseLexicon` returns). "Next = left chevron" is a UI-only concern.

---

## ⚠️ Open Decision — confirm before executing Task 6

The spec (§8, Q8) says generation is gated through "the existing Lamplight entitlement" but does not name a tier. **This plan interprets that as the existing `'inline'` feature = Plus-or-promo:**

- **Client:** `useLamplightEntitlement(...).hasAccess('inline')` (already returns `true` only for Plus or an active promo; `lite` gets `today`/`weekly` only).
- **Server:** new `hasInlineInsightAccess({ tier, promoActive }) = promoActive || tier === 'plus'`, mirroring `hasChatAccess`/`hasReflectionAccess`.

**Veto point:** if `lite` users should *also* be able to generate insights, say so and Task 6 changes to a `hasAccess`-style check that includes `lite`. Everything else in the plan is unaffected. Default (unless vetoed): **Plus/promo only.**

---

## File Structure

**New (client):**
- `src/notepad/study/lexicon/buildEtymologyDeck.ts` — pure deck builder + `isFunctionWord` + card/entry types (Task 2).
- `src/notepad/study/lexicon/useReviewedEtymologyEntries.ts` — batched, `reviewed=true`-filtered entry reader (Task 3).
- `src/notepad/study/lexicon/useEtymologyVerseInsight.ts` — read-or-generate insight hook (Task 4).
- `src/notepad/study/lexicon/EtymologyPanel.tsx` — the deck component (Tasks 7 + 9).

**New (server/scripts):**
- `supabase/migrations/048_bible_etymology.sql` — the two tables + RLS (Task 1).
- `supabase/functions/etymology-insight/index.ts` — edge-fn shell (Task 6).
- `supabase/functions/etymology-insight/insight-body.ts` — extracted, vitest-testable generation logic (Task 6).
- `supabase/functions/etymology-insight/prompts/verse-insight.ts` — the grounded prompt module (Task 6).
- `scripts/etymology/etymology-grounding.ts` — pure grounding-record builder + anti-hallucination validator (Task 10).
- `scripts/etymology/seed-etymology.ts` — offline seed runner (Task 10).

**Modified:**
- `src/notepad/storage/lamplight-adapter.ts` — add `generateEtymologyInsight` to the interface + `EtymologyInsightResult` (Task 5).
- `src/notepad/storage/supabase-lamplight-adapter.ts` — implement it (Task 5).
- `src/notepad/storage/fake-lamplight-adapter.ts` — implement it for tests (Task 5).
- `supabase/functions/_shared/entitlement.ts` — add `hasInlineInsightAccess` (Task 6).
- `supabase/functions/_shared/quota.ts` — add `'etymology_insight'` to `GENERATION_KINDS` (Task 6).
- `src/notepad/study/panes/ApparatusRail.tsx` — mount `<EtymologyPanel>`; thread `userId`/`adapter` props (Task 8).
- `src/notepad/study/StudyWorkspace.tsx` + `src/notepad/study/mobile/MobileStudyWorkspace.tsx` — supply `userId`/`adapter` to the rail (Task 8).

---

## Task 1: Migration — the two shared tables

**Files:**
- Create: `supabase/migrations/048_bible_etymology.sql`

**Interfaces:**
- Produces: tables `bible_etymology` (PK `strongs`) and `bible_etymology_verse_insight` (PK `(strongs, verse_id)`), both public-read. Every later data task reads/writes these.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/048_bible_etymology.sql
-- Etymology Study feature (v1: Psalms + Hebrew).
-- Two shared, public-read tables mirroring the bible_strongs caching pattern.
-- Rows are written ONLY by the offline seed script and the etymology-insight
-- edge function, both via the service role (which bypasses RLS) — so SELECT is
-- the only policy either table needs.

create table if not exists public.bible_etymology (
  strongs        text primary key,
  lemma          text not null,
  root           text not null,
  root_gloss     text not null,
  development    text not null,
  related        jsonb not null default '[]'::jsonb,
  study_value    int  not null default 0,
  source         text not null default '',
  model_used     text,
  prompt_version text,
  reviewed       boolean not null default false,
  created_at     timestamptz not null default now()
);

alter table public.bible_etymology enable row level security;

create policy "bible_etymology public read"
  on public.bible_etymology for select
  using (true);

create table if not exists public.bible_etymology_verse_insight (
  strongs        text not null,
  verse_id       text not null,
  body           text not null,
  model_used     text,
  prompt_version text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  primary key (strongs, verse_id)
);

alter table public.bible_etymology_verse_insight enable row level security;

create policy "bible_etymology_verse_insight public read"
  on public.bible_etymology_verse_insight for select
  using (true);
```

- [ ] **Step 2: Apply the migration to the linked project**

Run: `supabase db push`
Expected: output lists `048_bible_etymology.sql` as applied, no error.

- [ ] **Step 3: Verify the tables exist and read as public (0 rows, no error)**

Run: `supabase db query --linked "select count(*) as n from public.bible_etymology; select count(*) as n from public.bible_etymology_verse_insight;"`
Expected: two results, each `n = 0`, no permission error (confirms the tables exist and the SELECT policy is live).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/048_bible_etymology.sql
git commit -m "feat(etymology): add bible_etymology + verse_insight tables (048)"
```

---

## Task 2: `buildEtymologyDeck` — pure deck builder + classifier + types

**Files:**
- Create: `src/notepad/study/lexicon/buildEtymologyDeck.ts`
- Test: `src/notepad/study/lexicon/buildEtymologyDeck.test.ts`

**Interfaces:**
- Consumes: `InterlinearWord` from `./useVerseLexicon` (`{ position, original, transliteration, strongs: string|null, morph, gloss }`, ordered `position asc`); `normalizeStrongs(raw: string): string` from `./normalizeStrongs`.
- Produces:
  - `RelatedWord = { strongs: string; word: string; gloss: string }`
  - `EtymologyEntry = { strongs; lemma; root; rootGloss; development; related: RelatedWord[]; studyValue: number; source: string }`
  - `EtymologyDeckCard = { kind:'lexical'; position; strongs; entry: EtymologyEntry; word: InterlinearWord; starred: boolean } | { kind:'function'; position; word: InterlinearWord }`
  - `isFunctionWord(morph: string): boolean`
  - `buildEtymologyDeck(words: InterlinearWord[], entries: Map<string, EtymologyEntry>): { cards: EtymologyDeckCard[]; firstStarredIndex: number }`

**Classifier rule (confirmed against real `psa.23.1` DB data):** POS letter = the char after the `H`/`A`/`G` language prefix of the **first `/`-segment** of `morph` (i.e. `morph.split('/')[0][1]`). **`LEXICAL_POS = {N, V, A}`** (noun/verb/adjective). Everything else (C, D, P, R, T, S…) and empty/short morph → **function word**. A particle is a function-word card **even if it carries a strongs** (e.g. `לֹא` "not" has `H3808` but stays a grammar note).

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/study/lexicon/buildEtymologyDeck.test.ts
import { describe, it, expect } from 'vitest';
import { isFunctionWord, buildEtymologyDeck, type EtymologyEntry } from './buildEtymologyDeck';
import type { InterlinearWord } from './useVerseLexicon';

// Real psa.23.1 tokens (subset), position asc = Hebrew reading order.
const YAHWEH:   InterlinearWord = { position: 3, original: 'יְהוָה', transliteration: 'Yahweh', strongs: 'H3068', morph: 'HNpt', gloss: 'the LORD' };
const SHEPHERD: InterlinearWord = { position: 4, original: 'רֹעִי', transliteration: 'roi', strongs: 'H7462', morph: 'HVqrmsc/Sp1bs', gloss: 'my shepherd' };
const NOT:      InterlinearWord = { position: 5, original: 'לֹא', transliteration: 'lo', strongs: 'H3808', morph: 'HTn', gloss: 'not' };
const LACK:     InterlinearWord = { position: 6, original: 'אֶחְסָר', transliteration: 'echsar', strongs: 'H2637', morph: 'HVqi1cs', gloss: 'I shall lack' };

function entry(strongs: string, studyValue: number): EtymologyEntry {
  return { strongs, lemma: 'x', root: 'r', rootGloss: 'rg', development: 'd', related: [], studyValue, source: "Strong's + BDB" };
}

describe('isFunctionWord', () => {
  it('classifies N/V/A as lexical and particles/unknown as function', () => {
    expect(isFunctionWord('HNpt')).toBe(false);          // noun → lexical
    expect(isFunctionWord('HVqrmsc/Sp1bs')).toBe(false); // verb (first segment) → lexical
    expect(isFunctionWord('HVqi1cs')).toBe(false);       // verb → lexical
    expect(isFunctionWord('HTn')).toBe(true);            // particle → function
    expect(isFunctionWord('')).toBe(true);               // empty → function
    expect(isFunctionWord('H')).toBe(true);              // too short → function
  });
});

describe('buildEtymologyDeck', () => {
  it('builds RTL order, function card for particles, omits lexical tokens with no reviewed entry', () => {
    const entries = new Map<string, EtymologyEntry>([
      ['H3068', entry('H3068', 10)],
      ['H7462', entry('H7462', 9)],
      // H2637 (LACK) intentionally absent → omitted
    ]);
    const { cards } = buildEtymologyDeck([YAHWEH, SHEPHERD, NOT, LACK], entries);
    expect(cards.map((c) => c.kind)).toEqual(['lexical', 'lexical', 'function']); // LACK omitted
    expect(cards.map((c) => c.position)).toEqual([3, 4, 5]);                       // position asc
    const notCard = cards[2];
    expect(notCard.kind).toBe('function'); // particle even though it has a strongs
  });

  it('stars top min(4, lexicalCount) by studyValue desc (tiebreak position asc) and reports firstStarredIndex', () => {
    const entries = new Map<string, EtymologyEntry>([
      ['H3068', entry('H3068', 5)],
      ['H7462', entry('H7462', 9)],
      ['H2637', entry('H2637', 7)],
    ]);
    const { cards, firstStarredIndex } = buildEtymologyDeck([YAHWEH, SHEPHERD, NOT, LACK], entries);
    const starred = cards.filter((c) => c.kind === 'lexical' && c.starred);
    expect(starred).toHaveLength(3);      // min(4,3)
    expect(firstStarredIndex).toBe(0);    // YAHWEH is lexical+starred at deck index 0
  });

  it('caps stars at 4 when more than four lexical cards qualify', () => {
    const words: InterlinearWord[] = [1, 2, 3, 4, 5].map((i) => ({
      position: i, original: 'w', transliteration: 't', strongs: `H${100 + i}`, morph: 'HNc', gloss: 'g',
    }));
    const entries = new Map<string, EtymologyEntry>(words.map((w, i) => [w.strongs as string, entry(w.strongs as string, i)]));
    const { cards } = buildEtymologyDeck(words, entries);
    expect(cards.filter((c) => c.kind === 'lexical' && c.starred)).toHaveLength(4);
  });

  it('a verse of only function words yields no lexical card (panel-activation gate is false)', () => {
    const { cards } = buildEtymologyDeck([NOT], new Map());
    expect(cards.some((c) => c.kind === 'lexical')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/buildEtymologyDeck.test.ts`
Expected: FAIL — `Failed to resolve import "./buildEtymologyDeck"` / `isFunctionWord is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
// src/notepad/study/lexicon/buildEtymologyDeck.ts
import { normalizeStrongs } from './normalizeStrongs';
import type { InterlinearWord } from './useVerseLexicon';

export interface RelatedWord {
  strongs: string;
  word: string;
  gloss: string;
}

export interface EtymologyEntry {
  strongs: string;
  lemma: string;
  root: string;
  rootGloss: string;
  development: string;
  related: RelatedWord[];
  studyValue: number;
  source: string;
}

export type EtymologyDeckCard =
  | { kind: 'lexical'; position: number; strongs: string; entry: EtymologyEntry; word: InterlinearWord; starred: boolean }
  | { kind: 'function'; position: number; word: InterlinearWord };

// Parts of speech that earn a full etymology card. Everything else (conjunction,
// adverb, pronoun, preposition, particle, suffix, unknown) is a grammar-note-only
// function-word card, keeping reading order intact without inventing etymology.
const LEXICAL_POS = new Set(['N', 'V', 'A']);
const MAX_STARS = 4;

/**
 * A token is a function word unless the POS letter of its morphology's first
 * `/`-segment is Noun/Verb/Adjective. The POS letter sits right after the
 * H/A/G language prefix, so it is char index 1 of that segment.
 */
export function isFunctionWord(morph: string): boolean {
  const segment = (morph ?? '').split('/')[0] ?? '';
  if (segment.length < 2) return true;
  return !LEXICAL_POS.has(segment[1]);
}

export function buildEtymologyDeck(
  words: InterlinearWord[],
  entries: Map<string, EtymologyEntry>,
): { cards: EtymologyDeckCard[]; firstStarredIndex: number } {
  const ordered = [...words].sort((a, b) => a.position - b.position);

  const cards: EtymologyDeckCard[] = [];
  for (const word of ordered) {
    if (isFunctionWord(word.morph)) {
      cards.push({ kind: 'function', position: word.position, word });
      continue;
    }
    const strongs = word.strongs ? normalizeStrongs(word.strongs) || null : null;
    const entry = strongs ? entries.get(strongs) : undefined;
    if (strongs && entry) {
      cards.push({ kind: 'lexical', position: word.position, strongs, entry, word, starred: false });
    }
    // else: lexical token with no reviewed entry → omitted (spec §8)
  }

  const lexical = cards.filter(
    (c): c is Extract<EtymologyDeckCard, { kind: 'lexical' }> => c.kind === 'lexical',
  );
  const starredPositions = new Set(
    [...lexical]
      .sort((a, b) => b.entry.studyValue - a.entry.studyValue || a.position - b.position)
      .slice(0, Math.min(MAX_STARS, lexical.length))
      .map((c) => c.position),
  );
  for (const c of cards) {
    if (c.kind === 'lexical' && starredPositions.has(c.position)) c.starred = true;
  }

  const firstStarredIndex = cards.findIndex((c) => c.kind === 'lexical' && c.starred);
  return { cards, firstStarredIndex: firstStarredIndex >= 0 ? firstStarredIndex : 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/lexicon/buildEtymologyDeck.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/lexicon/buildEtymologyDeck.ts src/notepad/study/lexicon/buildEtymologyDeck.test.ts
git commit -m "feat(etymology): pure deck builder + particle classifier"
```

---

## Task 3: `useReviewedEtymologyEntries` — batched, reviewed-only entry reader

Realizes the spec's `useEtymologyEntry` as the batched variant the spec sanctions ("a batched read … over the token set — batching is a plan-level implementation detail"). Resolving the whole set before building is what lets omission + star ranking happen at build time (spec §7).

**Files:**
- Create: `src/notepad/study/lexicon/useReviewedEtymologyEntries.ts`
- Test: `src/notepad/study/lexicon/useReviewedEtymologyEntries.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `EtymologyEntry`/`RelatedWord` from `./buildEtymologyDeck`.
- Produces: `useReviewedEtymologyEntries(strongsKeys: string[]): { entries: Map<string, EtymologyEntry>; loading: boolean; error: string | null }`. Only `reviewed = true` rows are ever returned; unknown/unreviewed keys are simply absent from the map. Module-level cache keyed by strongs (immutable reference data).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// src/notepad/study/lexicon/useReviewedEtymologyEntries.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { from, select, inFn, eq, getBuilder, setResult } = vi.hoisted(() => {
  const select = vi.fn();
  const inFn = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const builder = { select, in: inFn, eq };
  select.mockImplementation(() => builder);
  inFn.mockImplementation(() => builder);
  eq.mockImplementation(() => Promise.resolve(result)); // terminal: .eq('reviewed', true)
  from.mockImplementation(() => builder);
  return { from, select, inFn, eq, getBuilder: () => builder, setResult: (v: { data: unknown; error: unknown }) => { result = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useReviewedEtymologyEntries } from './useReviewedEtymologyEntries';

const ROW = {
  strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', root_gloss: 'to tend, graze',
  development: 'From the root of tending a flock…', related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }],
  study_value: 9, source: "Strong's + BDB",
};

beforeEach(() => {
  from.mockClear(); select.mockClear(); inFn.mockClear(); eq.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  inFn.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setResult({ data: [], error: null });
  eq.mockImplementation(() => Promise.resolve({ data: [], error: null }));
});
afterEach(cleanup);

describe('useReviewedEtymologyEntries', () => {
  it('fetches reviewed rows and maps snake_case → camelCase into a Map keyed by strongs', async () => {
    setResult({ data: [ROW], error: null });
    eq.mockImplementation(() => Promise.resolve({ data: [ROW], error: null }));
    const { result } = renderHook(() => useReviewedEtymologyEntries(['H7462']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).toHaveBeenCalledWith('bible_etymology');
    expect(eq).toHaveBeenCalledWith('reviewed', true);
    expect(result.current.entries.get('H7462')).toEqual({
      strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze',
      development: 'From the root of tending a flock…',
      related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }],
      studyValue: 9, source: "Strong's + BDB",
    });
  });

  it('returns an empty map without querying when given no keys', async () => {
    const { result } = renderHook(() => useReviewedEtymologyEntries([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.entries.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/useReviewedEtymologyEntries.test.ts`
Expected: FAIL — `Failed to resolve import "./useReviewedEtymologyEntries"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/notepad/study/lexicon/useReviewedEtymologyEntries.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { EtymologyEntry, RelatedWord } from './buildEtymologyDeck';

interface EtymologyRow {
  strongs: string;
  lemma: string;
  root: string;
  root_gloss: string;
  development: string;
  related: RelatedWord[] | null;
  study_value: number;
  source: string;
}

export interface UseReviewedEtymologyEntriesResult {
  entries: Map<string, EtymologyEntry>;
  loading: boolean;
  error: string | null;
}

// Etymology entries are immutable reference data — one fetch per strongs suffices
// for the whole session, no matter how many verses reference it.
const cache = new Map<string, EtymologyEntry>();

function mapRow(r: EtymologyRow): EtymologyEntry {
  return {
    strongs: r.strongs,
    lemma: r.lemma,
    root: r.root,
    rootGloss: r.root_gloss,
    development: r.development,
    related: r.related ?? [],
    studyValue: r.study_value,
    source: r.source,
  };
}

/**
 * Batched reader for the reviewed etymology entries of a verse's tokens. Only
 * `reviewed = true` rows are returned; any key without a reviewed row is simply
 * absent from the map (the deck builder then omits that lexical token).
 */
export function useReviewedEtymologyEntries(strongsKeys: string[]): UseReviewedEtymologyEntriesResult {
  const keys = [...new Set(strongsKeys.filter(Boolean))].sort();
  const keySig = keys.join(',');

  const buildFromCache = () => {
    const m = new Map<string, EtymologyEntry>();
    for (const k of keys) {
      const hit = cache.get(k);
      if (hit) m.set(k, hit);
    }
    return m;
  };

  const [entries, setEntries] = useState<Map<string, EtymologyEntry>>(buildFromCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (keys.length === 0) {
      setEntries(new Map()); setLoading(false); setError(null);
      return;
    }
    const missing = keys.filter((k) => !cache.has(k));
    if (missing.length === 0) {
      setEntries(buildFromCache()); setLoading(false); setError(null);
      return;
    }
    if (!supabase) {
      setEntries(buildFromCache()); setError('Etymology is unavailable.'); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_etymology')
        .select('strongs, lemma, root, root_gloss, development, related, study_value, source')
        .in('strongs', missing)
        .eq('reviewed', true);
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setEntries(buildFromCache());
      } else {
        for (const row of (data ?? []) as EtymologyRow[]) {
          cache.set(row.strongs, mapRow(row));
        }
        setEntries(buildFromCache());
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig]);

  return { entries, loading, error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/lexicon/useReviewedEtymologyEntries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/lexicon/useReviewedEtymologyEntries.ts src/notepad/study/lexicon/useReviewedEtymologyEntries.test.ts
git commit -m "feat(etymology): batched reviewed-entry reader hook"
```

---

## Task 4: `useEtymologyVerseInsight` — read-or-generate insight hook

**Files:**
- Create: `src/notepad/study/lexicon/useEtymologyVerseInsight.ts`
- Test: `src/notepad/study/lexicon/useEtymologyVerseInsight.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase` (read); `LamplightAdapter.generateEtymologyInsight` (generate — defined in Task 5, referenced by type here). To keep Task 4 independently testable ahead of Task 5, this hook types the adapter as a narrow local shape.
- Produces: `useEtymologyVerseInsight(strongs: string | null, verseId: string | null, adapter: InsightGenerator | null): { insight: { body: string } | null; loading: boolean; error: string | null; generating: boolean; generate: () => Promise<void> }` where `InsightGenerator = { generateEtymologyInsight(strongs: string, verseId: string): Promise<{ ok: true; body: string; cached: boolean } | { ok: false; reason: 'no_entry' | 'network' }> }`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// src/notepad/study/lexicon/useEtymologyVerseInsight.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const { from, select, eq, maybeSingle, getBuilder, setResult } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const builder = { select, eq, maybeSingle };
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  maybeSingle.mockImplementation(() => Promise.resolve(result));
  from.mockImplementation(() => builder);
  return { from, select, eq, maybeSingle, getBuilder: () => builder, setResult: (v: { data: unknown; error: unknown }) => { result = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useEtymologyVerseInsight } from './useEtymologyVerseInsight';

beforeEach(() => {
  from.mockClear(); select.mockClear(); eq.mockClear(); maybeSingle.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setResult({ data: null, error: null });
  maybeSingle.mockImplementation(() => Promise.resolve({ data: null, error: null }));
});
afterEach(cleanup);

describe('useEtymologyVerseInsight', () => {
  it('renders an existing insight row for free (read hit), never calling generate', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({ data: { body: 'A shared insight.' }, error: null }));
    const adapter = { generateEtymologyInsight: vi.fn() };
    const { result } = renderHook(() => useEtymologyVerseInsight('H7462', 'psa.23.1', adapter));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.insight).toEqual({ body: 'A shared insight.' });
    expect(adapter.generateEtymologyInsight).not.toHaveBeenCalled();
  });

  it('on read miss, generate() calls the adapter and shows the returned body inline', async () => {
    const adapter = {
      generateEtymologyInsight: vi.fn().mockResolvedValue({ ok: true, body: 'Freshly generated.', cached: false }),
    };
    const { result } = renderHook(() => useEtymologyVerseInsight('H7462', 'psa.23.1', adapter));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.insight).toBeNull();
    await act(async () => { await result.current.generate(); });
    expect(adapter.generateEtymologyInsight).toHaveBeenCalledWith('H7462', 'psa.23.1');
    expect(result.current.insight).toEqual({ body: 'Freshly generated.' });
  });

  it('surfaces a soft error and no insight when generation fails', async () => {
    const adapter = {
      generateEtymologyInsight: vi.fn().mockResolvedValue({ ok: false, reason: 'network' }),
    };
    const { result } = renderHook(() => useEtymologyVerseInsight('H7462', 'psa.23.1', adapter));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });
    expect(result.current.insight).toBeNull();
    expect(result.current.error).toBe('network');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/useEtymologyVerseInsight.test.ts`
Expected: FAIL — `Failed to resolve import "./useEtymologyVerseInsight"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/notepad/study/lexicon/useEtymologyVerseInsight.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type InsightGenerateResult =
  | { ok: true; body: string; cached: boolean }
  | { ok: false; reason: 'no_entry' | 'network' };

export interface InsightGenerator {
  generateEtymologyInsight(strongs: string, verseId: string): Promise<InsightGenerateResult>;
}

export interface UseEtymologyVerseInsightResult {
  insight: { body: string } | null;
  loading: boolean;
  error: string | null;
  generating: boolean;
  generate: () => Promise<void>;
}

/**
 * Reads the shared per-(word, verse) insight. A present row renders free for
 * everyone (it's a DB read). On a miss, `generate()` routes through the adapter
 * (edge function) — callers gate that button on entitlement before showing it.
 */
export function useEtymologyVerseInsight(
  strongs: string | null,
  verseId: string | null,
  adapter: InsightGenerator | null,
): UseEtymologyVerseInsightResult {
  const [insight, setInsight] = useState<{ body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (strongs == null || verseId == null || !supabase) {
      setInsight(null); setLoading(false); setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInsight(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_etymology_verse_insight')
        .select('body')
        .eq('strongs', strongs)
        .eq('verse_id', verseId)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setInsight(null); // a failed read degrades to the Ask button, never blanks
      } else if (data) {
        setInsight({ body: (data as { body: string }).body });
      } else {
        setInsight(null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [strongs, verseId]);

  const generate = useCallback(async () => {
    if (!adapter || strongs == null || verseId == null) { setError('network'); return; }
    setGenerating(true);
    setError(null);
    const res = await adapter.generateEtymologyInsight(strongs, verseId);
    if (res.ok) {
      setInsight({ body: res.body });
    } else {
      setError(res.reason);
    }
    setGenerating(false);
  }, [adapter, strongs, verseId]);

  return { insight, loading, error, generating, generate };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/lexicon/useEtymologyVerseInsight.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/lexicon/useEtymologyVerseInsight.ts src/notepad/study/lexicon/useEtymologyVerseInsight.test.ts
git commit -m "feat(etymology): read-or-generate verse-insight hook"
```

---

## Task 5: Adapter extension — `generateEtymologyInsight`

**Files:**
- Modify: `src/notepad/storage/lamplight-adapter.ts` (add result type + interface method — near the `ConnectionWhyResult`/`generateConnectionWhy` block)
- Modify: `src/notepad/storage/supabase-lamplight-adapter.ts` (implement — mirror `generateConnectionWhy` at ~L251)
- Modify: `src/notepad/storage/fake-lamplight-adapter.ts` (implement for tests)
- Test: `src/notepad/storage/supabase-lamplight-adapter.test.ts` (add a describe block — create the file only if it does not already exist; otherwise append)

**Interfaces:**
- Produces: `EtymologyInsightResult = { ok: true; body: string; cached: boolean } | { ok: false; reason: 'no_entry' | 'network' }`; `LamplightAdapter.generateEtymologyInsight(strongs: string, verseId: string): Promise<EtymologyInsightResult>`. This satisfies `InsightGenerator` from Task 4.

- [ ] **Step 1: Add the result type + interface method**

In `src/notepad/storage/lamplight-adapter.ts`, add after the `ConnectionWhyResult` type (~L103):

```ts
export type EtymologyInsightResult =
  | { ok: true; body: string; cached: boolean }
  | { ok: false; reason: 'no_entry' | 'network' };
```

And inside `interface LamplightAdapter`, after `generateConnectionWhy(...)` (~L151):

```ts
  /** Invokes the etymology-insight Edge Function to generate + persist the shared
   *  per-(word, verse) insight. Reads are done directly against the DB, not here. */
  generateEtymologyInsight(strongs: string, verseId: string): Promise<EtymologyInsightResult>;
```

- [ ] **Step 2: Write the failing test (production adapter, mocked client)**

```ts
// src/notepad/storage/supabase-lamplight-adapter.test.ts  (append a describe; keep any existing content)
import { describe, it, expect, vi } from 'vitest';
import { SupabaseLamplightAdapter } from './supabase-lamplight-adapter';

function clientWith(invokeResult: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(invokeResult);
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    functions: { invoke },
  };
  return { client, invoke };
}

describe('SupabaseLamplightAdapter.generateEtymologyInsight', () => {
  it('maps a successful edge-fn response to { ok:true, body, cached }', async () => {
    const { client, invoke } = clientWith({ data: { ok: true, body: 'Insight.', cached: false }, error: null });
    const adapter = new SupabaseLamplightAdapter(client as never);
    const res = await adapter.generateEtymologyInsight('H7462', 'psa.23.1');
    expect(invoke).toHaveBeenCalledWith('etymology-insight', { body: { strongs: 'H7462', verse_id: 'psa.23.1' } });
    expect(res).toEqual({ ok: true, body: 'Insight.', cached: false });
  });

  it('maps a no_entry failure through, and a transport error to network', async () => {
    const noEntry = new SupabaseLamplightAdapter(clientWith({ data: { ok: false, reason: 'no_entry' }, error: null }).client as never);
    expect(await noEntry.generateEtymologyInsight('H1', 'psa.23.1')).toEqual({ ok: false, reason: 'no_entry' });

    const boom = new SupabaseLamplightAdapter(clientWith({ data: null, error: { message: 'boom' } }).client as never);
    expect(await boom.generateEtymologyInsight('H1', 'psa.23.1')).toEqual({ ok: false, reason: 'network' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/notepad/storage/supabase-lamplight-adapter.test.ts`
Expected: FAIL — `generateEtymologyInsight is not a function`.

- [ ] **Step 4: Implement in the production adapter**

In `src/notepad/storage/supabase-lamplight-adapter.ts`, import the new type and add the method (mirrors `generateConnectionWhy`):

```ts
  async generateEtymologyInsight(strongs: string, verseId: string): Promise<EtymologyInsightResult> {
    try {
      const { data, error } = await this.#client.functions.invoke('etymology-insight', {
        body: { strongs, verse_id: verseId },
      });
      if (error) return { ok: false, reason: 'network' };
      if (!data || typeof data !== 'object') return { ok: false, reason: 'network' };
      const d = data as Record<string, unknown>;
      if (d.ok === true && typeof d.body === 'string') {
        return { ok: true, body: d.body, cached: !!d.cached };
      }
      if (d.ok === false && d.reason === 'no_entry') {
        return { ok: false, reason: 'no_entry' };
      }
      return { ok: false, reason: 'network' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }
```

Add `EtymologyInsightResult` to the existing type import from `./lamplight-adapter`.

- [ ] **Step 5: Implement in the fake adapter**

In `src/notepad/storage/fake-lamplight-adapter.ts`, add a seed store + configurable result + the method (mirroring the other fake methods):

```ts
  // Etymology insight: seeded read hits + a configurable generate() outcome.
  etymologyInsights = new Map<string, string>(); // key = `${strongs}:${verseId}` → body
  etymologyGenerateResult: EtymologyInsightResult = { ok: true, body: 'Fake insight.', cached: false };
  generateEtymologyInsightCalls: Array<{ strongs: string; verseId: string }> = [];

  __seedEtymologyInsight(strongs: string, verseId: string, body: string): void {
    this.etymologyInsights.set(`${strongs}:${verseId}`, body);
  }

  async generateEtymologyInsight(strongs: string, verseId: string): Promise<EtymologyInsightResult> {
    this.generateEtymologyInsightCalls.push({ strongs, verseId });
    return this.etymologyGenerateResult;
  }
```

Add `EtymologyInsightResult` to the fake's type import from `./lamplight-adapter`.

- [ ] **Step 6: Run the test to verify it passes + typecheck**

Run: `npx vitest run src/notepad/storage/supabase-lamplight-adapter.test.ts`
Expected: PASS (2 tests).
Run: `npx tsc -b`
Expected: exits 0 (the fake now satisfies the extended interface).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/storage/lamplight-adapter.ts src/notepad/storage/supabase-lamplight-adapter.ts src/notepad/storage/fake-lamplight-adapter.ts src/notepad/storage/supabase-lamplight-adapter.test.ts
git commit -m "feat(etymology): adapter.generateEtymologyInsight (prod + fake)"
```

---

## Task 6: `etymology-insight` edge function (entitlement + quota + grounded generation)

The one live-generated surface. **Confirm the Open Decision above before starting.** The edge-fn *shell* (`index.ts`) is thin and wired like `lamplight-generate/index.ts` (not unit-tested); all real logic lives in vitest-tested modules (`insight-body.ts`, `prompts/verse-insight.ts`) and shared helpers, exactly as the codebase tests `generation-lifecycle`/`entitlement` with plain fakes.

**Files:**
- Modify: `supabase/functions/_shared/entitlement.ts` (add `hasInlineInsightAccess`)
- Modify: `supabase/functions/_shared/entitlement.test.ts` (add cases — create if absent)
- Modify: `supabase/functions/_shared/quota.ts` (add `'etymology_insight'` to `GENERATION_KINDS`, L27)
- Create: `supabase/functions/etymology-insight/prompts/verse-insight.ts`
- Create: `supabase/functions/etymology-insight/prompts/verse-insight.test.ts`
- Create: `supabase/functions/etymology-insight/insight-body.ts`
- Create: `supabase/functions/etymology-insight/insight-body.test.ts`
- Create: `supabase/functions/etymology-insight/index.ts`

**Interfaces:**
- Consumes: `runGeneration`, `GenerationOutcome` (`_shared/generation-lifecycle.ts`); `checkQuota`, `resolveQuotaLimits`, `supabaseQuotaDeps` (`_shared/quota.ts`); `deriveUserId`, `bearerToken` (`_shared/auth-identity.ts`); `serviceClient` (`_shared/supabase.ts`); `createAnthropicAdapter` (`_shared/anthropic.ts`); `fetchPassageText`, `formatVerseRef` (`_shared/bible-passage.ts`); `corsHeaders`, `resolveAllowedOrigins` (`_shared/cors.ts`); `recordLamplightUsage` (`_shared/usage.ts`).
- Produces: HTTP endpoint `POST /etymology-insight` with body `{ strongs, verse_id }` → `{ ok:true, body, cached }` (200) · `{ ok:false, reason:'no_entry' }` (200) · `{ ok:false, reason:'generation_failed' }` (200) · `401` (no user) · `403` (not entitled) · `429` (quota). `hasInlineInsightAccess({ tier, promoActive }): boolean`. `VERSE_INSIGHT_PROMPT_VERSION`, `VERSE_INSIGHT_PROMPT`, `buildEtymologyInsightOutcome`.

**Quota + failure invariant (spec §8):** `checkQuota → countUserUsage` counts `lamplight_usage` rows for the kind **regardless of status**, so recording *any* row spends quota. Therefore `body()` records usage **only on a successful insert** (returns `usage: null` on cache-hit, no-entry, and model failure). No row is inserted on failure. A redundant model call by a concurrency-loser is accepted (it recorded usage because it really did call the model), but the row is never duplicated (`ON CONFLICT DO NOTHING`).

### 6a — `hasInlineInsightAccess`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/entitlement.test.ts  (append; create if absent)
import { describe, it, expect } from 'vitest';
import { hasInlineInsightAccess } from './entitlement';

describe('hasInlineInsightAccess', () => {
  it('grants Plus, and anyone during a promo; denies lite/none otherwise', () => {
    expect(hasInlineInsightAccess({ tier: 'plus', promoActive: false })).toBe(true);
    expect(hasInlineInsightAccess({ tier: 'none', promoActive: true })).toBe(true);
    expect(hasInlineInsightAccess({ tier: 'lite', promoActive: false })).toBe(false);
    expect(hasInlineInsightAccess({ tier: 'none', promoActive: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run supabase/functions/_shared/entitlement.test.ts` → FAIL (`hasInlineInsightAccess` not exported).

- [ ] **Step 3: Implement** — append to `supabase/functions/_shared/entitlement.ts`:

```ts
// Inline verse insights (Etymology Study) are a Plus feature; an active promo
// opens them to all, exactly like hasChatAccess/hasReflectionAccess. Mirrors the
// client's useLamplightEntitlement 'inline' branch so server and UI agree.
export function hasInlineInsightAccess(args: { tier: LamplightTier; promoActive: boolean }): boolean {
  if (args.promoActive) return true;
  return args.tier === 'plus';
}
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

### 6b — quota kind

- [ ] **Step 5: Add the kind + guard test**

Edit `supabase/functions/_shared/quota.ts` L27:

```ts
const GENERATION_KINDS = ['smoke_test', 'daily_devotion', 'connection_card_why', 'bible_chat', 'etymology_insight'];
```

Run: `npx vitest run supabase/functions/_shared/quota.test.ts`
Expected: PASS (adding a kind is additive; if a test asserts the exact array, update it to include `'etymology_insight'`).

### 6c — grounded prompt module

- [ ] **Step 6: Write the failing test**

```ts
// supabase/functions/etymology-insight/prompts/verse-insight.test.ts
import { describe, it, expect } from 'vitest';
import { VERSE_INSIGHT_PROMPT, VERSE_INSIGHT_PROMPT_VERSION } from './verse-insight';

describe('VERSE_INSIGHT_PROMPT', () => {
  it('forces the emit tool and grounds messages on the entry facts + verse text', () => {
    expect(VERSE_INSIGHT_PROMPT.tool.name).toBe('emit_verse_insight');
    expect(VERSE_INSIGHT_PROMPT.promptVersion).toBe(VERSE_INSIGHT_PROMPT_VERSION);
    const msgs = VERSE_INSIGHT_PROMPT.buildMessages({
      reference: 'Psalm 23:1', verseText: 'The LORD is my shepherd; I shall not want.',
      lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze',
      development: 'From tending a flock…', related: [{ word: 'רֹעֶה', gloss: 'shepherd' }],
    });
    const content = msgs[0].content;
    expect(content).toContain('Psalm 23:1');
    expect(content).toContain('רעה');            // root is present as grounding
    expect(content).toContain('shepherd');       // related gloss is present
    expect(VERSE_INSIGHT_PROMPT.system).toMatch(/never|only|invent/i); // never-invent discipline
  });
});
```

- [ ] **Step 7: Run to verify it fails** — `npx vitest run supabase/functions/etymology-insight/prompts/verse-insight.test.ts` → FAIL (import unresolved).

- [ ] **Step 8: Implement the prompt module** (clones `prompts/connection-why.ts`)

```ts
// supabase/functions/etymology-insight/prompts/verse-insight.ts
export const VERSE_INSIGHT_PROMPT_VERSION = 'etymology-verse-insight-2026-07-08-v1';

export interface EtymologyInsightContext {
  reference: string;
  verseText: string;
  lemma: string;
  root: string;
  rootGloss: string;
  development: string;
  related: Array<{ word: string; gloss: string }>;
}

export const VERSE_INSIGHT_PROMPT = {
  promptVersion: VERSE_INSIGHT_PROMPT_VERSION,
  system: [
    'You explain how one already-studied Hebrew word functions in one specific verse.',
    'You are given VERIFIED facts about the word (its root, a short "how it grew" note,',
    'and related words) plus the verse text. In ≤40 words, connect the word to the verse.',
    '',
    'Hard rules:',
    '- Retell ONLY the verified facts supplied. NEVER invent etymology, cognates, or roots.',
    '- Describe — do not advise. No "you should…", no application, no devotional turn.',
    '- Quote at most two or three words of the verse; do not transcribe the whole line.',
    '- No prophetic claims, no interpretation of contested passages beyond plain reading.',
  ].join('\n'),
  tool: {
    name: 'emit_verse_insight',
    description: 'Return the one-paragraph, grounded insight about the word in this verse.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['body'],
      properties: {
        body: { type: 'string', minLength: 12, maxLength: 400 },
      },
    },
  },
  buildMessages(ctx: EtymologyInsightContext): Array<{ role: 'user'; content: string }> {
    const related = ctx.related.length
      ? ctx.related.map((r) => `${r.word} (${r.gloss})`).join(', ')
      : 'none';
    return [{
      role: 'user',
      content:
        `Verse — ${ctx.reference}: "${ctx.verseText}"\n\n` +
        `Word (lemma): ${ctx.lemma}\n` +
        `Verified root: ${ctx.root} — ${ctx.rootGloss}\n` +
        `Verified development: ${ctx.development}\n` +
        `Verified related words: ${related}\n\n` +
        `In ≤40 words, explain how this word works in this verse, using only the facts above.`,
    }];
  },
} as const;
```

- [ ] **Step 9: Run to verify it passes** — same command → PASS.

### 6d — extracted generation logic (`insight-body.ts`)

- [ ] **Step 10: Write the failing test** (vitest + plain fakes, mirrors `generation-lifecycle.test.ts`)

```ts
// supabase/functions/etymology-insight/insight-body.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildEtymologyInsightOutcome, type EtymologyInsightBodyDeps } from './insight-body';

function makeDeps(over: Partial<EtymologyInsightBodyDeps> = {}): EtymologyInsightBodyDeps {
  return {
    loadExistingInsight: async () => null,
    loadEntry: async () => ({ lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend', development: 'grew from tending', related: [] }),
    loadVerseText: async () => ({ reference: 'Psalm 23:1', text: 'The LORD is my shepherd…' }),
    generate: async () => ({ body: 'Grounded insight.', modelUsed: 'claude-opus-4-8', promptTokens: 100, completionTokens: 20 }),
    insertInsight: async () => {},
    reloadInsight: async () => 'Grounded insight.',
    ...over,
  };
}
const args = { strongs: 'H7462', verseId: 'psa.23.1', userId: 'u1' };

describe('buildEtymologyInsightOutcome', () => {
  it('returns a cache hit with NO usage when an insight already exists', async () => {
    const generate = vi.fn();
    const out = await buildEtymologyInsightOutcome(makeDeps({ loadExistingInsight: async () => 'Already here.', generate }), args);
    expect(out).toEqual({ response: { ok: true, body: 'Already here.', cached: true }, usage: null });
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns no_entry with NO usage when the word has no reviewed entry', async () => {
    const out = await buildEtymologyInsightOutcome(makeDeps({ loadEntry: async () => null }), args);
    expect(out).toEqual({ response: { ok: false, reason: 'no_entry' }, usage: null });
  });

  it('on model failure inserts NOTHING and spends NO quota (usage null)', async () => {
    const insertInsight = vi.fn();
    const out = await buildEtymologyInsightOutcome(
      makeDeps({ generate: async () => { throw new Error('model 500'); }, insertInsight }),
      args,
    );
    expect(out).toEqual({ response: { ok: false, reason: 'generation_failed' }, usage: null });
    expect(insertInsight).not.toHaveBeenCalled();
  });

  it('on success inserts once and records ok usage (cached:false)', async () => {
    const insertInsight = vi.fn();
    const out = await buildEtymologyInsightOutcome(makeDeps({ insertInsight }), args);
    expect(insertInsight).toHaveBeenCalledTimes(1);
    expect(out.response).toEqual({ ok: true, body: 'Grounded insight.', cached: false });
    expect(out.usage).toEqual({ model: 'claude-opus-4-8', tokens_in: 100, tokens_out: 20, status: 'ok' });
  });

  it('a concurrency loser reads the winner row and reports cached:true', async () => {
    const out = await buildEtymologyInsightOutcome(
      makeDeps({ reloadInsight: async () => 'Winner insight.' }), // != our generated body
      args,
    );
    expect(out.response).toEqual({ ok: true, body: 'Winner insight.', cached: true });
  });
});
```

- [ ] **Step 11: Run to verify it fails** — `npx vitest run supabase/functions/etymology-insight/insight-body.test.ts` → FAIL (import unresolved).

- [ ] **Step 12: Implement `insight-body.ts`**

```ts
// supabase/functions/etymology-insight/insight-body.ts
// Extracted, side-effect-injected generation logic so it is vitest-testable with
// plain fakes (the index.ts shell wires the real Supabase/Anthropic deps). Returns
// a GenerationOutcome for the shared runGeneration seam. Usage is recorded ONLY on
// a successful insert — cache-hit, no-entry, and model-failure all return usage:null
// so a failure spends no quota and inserts no row (spec §8).
import type { GenerationOutcome } from '../_shared/generation-lifecycle.ts';
import type { UsageCore } from '../_shared/usage.ts';
import { VERSE_INSIGHT_PROMPT_VERSION, type EtymologyInsightContext } from './prompts/verse-insight.ts';

export interface EtymologyEntryFacts {
  lemma: string;
  root: string;
  rootGloss: string;
  development: string;
  related: Array<{ word: string; gloss: string }>;
}

export interface EtymologyInsightBodyDeps {
  loadExistingInsight(strongs: string, verseId: string): Promise<string | null>;
  loadEntry(strongs: string): Promise<EtymologyEntryFacts | null>; // reviewed=true only
  loadVerseText(verseId: string): Promise<{ reference: string; text: string } | null>;
  generate(ctx: EtymologyInsightContext): Promise<{ body: string; modelUsed: string; promptTokens: number; completionTokens: number }>;
  insertInsight(row: {
    strongs: string; verse_id: string; body: string; model_used: string; prompt_version: string; created_by: string;
  }): Promise<void>; // ON CONFLICT (strongs, verse_id) DO NOTHING
  reloadInsight(strongs: string, verseId: string): Promise<string | null>;
}

export async function buildEtymologyInsightOutcome(
  deps: EtymologyInsightBodyDeps,
  args: { strongs: string; verseId: string; userId: string },
): Promise<GenerationOutcome> {
  const { strongs, verseId, userId } = args;

  const existing = await deps.loadExistingInsight(strongs, verseId);
  if (existing) {
    return { response: { ok: true, body: existing, cached: true }, usage: null };
  }

  const entry = await deps.loadEntry(strongs);
  const verse = await deps.loadVerseText(verseId);
  if (!entry || !verse) {
    return { response: { ok: false, reason: 'no_entry' }, usage: null };
  }

  let gen: { body: string; modelUsed: string; promptTokens: number; completionTokens: number };
  try {
    gen = await deps.generate({
      reference: verse.reference,
      verseText: verse.text,
      lemma: entry.lemma,
      root: entry.root,
      rootGloss: entry.rootGloss,
      development: entry.development,
      related: entry.related,
    });
  } catch {
    // No row, no usage → no quota spent (spec §8). Client falls back to Ask + retry.
    return { response: { ok: false, reason: 'generation_failed' }, usage: null };
  }

  await deps.insertInsight({
    strongs, verse_id: verseId, body: gen.body,
    model_used: gen.modelUsed, prompt_version: VERSE_INSIGHT_PROMPT_VERSION, created_by: userId,
  });
  const winner = (await deps.reloadInsight(strongs, verseId)) ?? gen.body;
  const cached = winner !== gen.body; // a conflict-loser reads someone else's winning row

  const usage: UsageCore = {
    model: gen.modelUsed, tokens_in: gen.promptTokens, tokens_out: gen.completionTokens, status: 'ok',
  };
  return { response: { ok: true, body: winner, cached }, usage };
}
```

- [ ] **Step 13: Run to verify it passes** — same command → PASS (5 tests).

### 6e — the edge-fn shell (wiring; verified by `tsc`)

- [ ] **Step 14: Implement `index.ts`** (mirrors `lamplight-generate/index.ts`: CORS, POST-only, top-level try/catch → `jsonResp`, `deriveUserId`, entitlement gate, `runGeneration` with `quotaCfg.generation`)

```ts
// supabase/functions/etymology-insight/index.ts
// Generates + persists the shared per-(word, verse) etymology insight. Reads are
// pure client DB queries; ONLY generation lives here so the Anthropic key stays
// server-side. Gated on the 'inline' entitlement (Plus/promo) — see Open Decision.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { createAnthropicAdapter } from '../_shared/anthropic.ts';
import { fetchPassageText, formatVerseRef } from '../_shared/bible-passage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { hasInlineInsightAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { buildEtymologyInsightOutcome } from './insight-body.ts';
import { VERSE_INSIGHT_PROMPT } from './prompts/verse-insight.ts';

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return jsonResp({ error: 'ANTHROPIC_API_KEY missing' }, 500);

    let body: { strongs?: string; verse_id?: string };
    try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }
    const strongs = typeof body.strongs === 'string' ? body.strongs : '';
    const verseId = typeof body.verse_id === 'string' ? body.verse_id : '';
    if (!strongs || !verseId) return jsonResp({ error: 'bad payload' }, 400);

    const supabase = serviceClient();

    const userId = await deriveUserId(supabase, bearerToken(req));
    if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

    const [{ data: ent }, { data: promoRow }] = await Promise.all([
      supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
    ]);
    const tier = (ent?.tier ?? 'none') as LamplightTier;
    if (!hasInlineInsightAccess({ tier, promoActive: promoRow?.value === true })) {
      return jsonResp({ error: 'inline insight requires Plus' }, 403);
    }

    const quotaCfg = resolveQuotaLimits(Deno.env);
    const llm = createAnthropicAdapter({ apiKey: anthropicKey, fetch });
    const lifecycleDeps: GenerationLifecycleDeps = {
      checkQuota: async (uid) => {
        const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.generation, quotaCfg.global, { userId: uid, nowMs: Date.now() });
        return q.ok ? { ok: true } : { ok: false, reason: q.reason };
      },
      recordUsage: (row) => recordLamplightUsage(supabase, row),
      classifyError: (err) => (err instanceof Error ? err.message : 'unknown').slice(0, 64),
    };

    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'etymology_insight' },
      () => buildEtymologyInsightOutcome(
        {
          loadExistingInsight: async (s, v) => {
            const { data } = await supabase.from('bible_etymology_verse_insight').select('body').eq('strongs', s).eq('verse_id', v).maybeSingle();
            return (data as { body?: string } | null)?.body ?? null;
          },
          loadEntry: async (s) => {
            const { data } = await supabase.from('bible_etymology')
              .select('lemma, root, root_gloss, development, related').eq('strongs', s).eq('reviewed', true).maybeSingle();
            if (!data) return null;
            const d = data as { lemma: string; root: string; root_gloss: string; development: string; related: Array<{ word: string; gloss: string }> | null };
            return { lemma: d.lemma, root: d.root, rootGloss: d.root_gloss, development: d.development, related: d.related ?? [] };
          },
          loadVerseText: async (v) => {
            const byId = await fetchPassageText(supabase as never, [v], 'BSB');
            const row = byId.get(v);
            return row ? { reference: formatVerseRef(row), text: row.text } : null;
          },
          generate: async (ctx) => {
            const out = await llm.generate<{ body: string }>({
              model: 'opus', system: VERSE_INSIGHT_PROMPT.system,
              messages: VERSE_INSIGHT_PROMPT.buildMessages(ctx), tool: VERSE_INSIGHT_PROMPT.tool,
            });
            return { body: out.parsed.body, modelUsed: out.modelUsed, promptTokens: out.promptTokens, completionTokens: out.completionTokens };
          },
          insertInsight: async (row) => {
            const { error } = await supabase.from('bible_etymology_verse_insight')
              .upsert(row, { onConflict: 'strongs,verse_id', ignoreDuplicates: true });
            if (error) throw new Error(error.message);
          },
          reloadInsight: async (s, v) => {
            const { data } = await supabase.from('bible_etymology_verse_insight').select('body').eq('strongs', s).eq('verse_id', v).maybeSingle();
            return (data as { body?: string } | null)?.body ?? null;
          },
        },
        { strongs, verseId, userId },
      ),
    );
    return jsonResp(response, status);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
```

- [ ] **Step 15: Typecheck + full suite**

Run: `npx tsc -b`
Expected: exits 0.
Run: `npx vitest run supabase/functions/etymology-insight supabase/functions/_shared/entitlement.test.ts supabase/functions/_shared/quota.test.ts`
Expected: PASS (entitlement, quota, prompt, insight-body).

- [ ] **Step 16: Commit**

```bash
git add supabase/functions/etymology-insight supabase/functions/_shared/entitlement.ts supabase/functions/_shared/entitlement.test.ts supabase/functions/_shared/quota.ts
git commit -m "feat(etymology): etymology-insight edge fn (entitlement, quota, grounded generation)"
```

> **Deploy note (operational, not a code step):** the function ships via `supabase functions deploy etymology-insight`. It reuses the existing `ANTHROPIC_API_KEY` + CORS/allowed-origins secrets — no new secret. Do this when the branch is ready to test end-to-end, not during unit work.

---

## Task 7: `EtymologyPanel` — the deck component

**Files:**
- Create: `src/notepad/study/lexicon/EtymologyPanel.tsx`
- Test: `src/notepad/study/lexicon/EtymologyPanel.test.tsx`

**Interfaces:**
- Consumes: `useVerseLexicon`; `isFunctionWord`, `buildEtymologyDeck`, `EtymologyDeckCard` (`./buildEtymologyDeck`); `normalizeStrongs`; `useReviewedEtymologyEntries`; `useEtymologyVerseInsight`; `useLamplightEntitlement` (`@/notepad/hooks/useLamplightEntitlement`); `LamplightAdapter` (`../../storage/lamplight-adapter`).
- Produces: `EtymologyPanel({ verseId, reference, userId, adapter }: { verseId: string | null; reference: string | null; userId: string | null; adapter: LamplightAdapter | null })`. **Renders `null` unless the deck has ≥1 lexical card** (panel-activation gate, spec §7).

**Behavior (spec §5, §7):** collapsible `<section>` styled like `OriginalLanguagePanel` (`--silica`, `--deep-umber`, `--lamplight-accent`, `--cream`, `--pale-stone`, `ChevronDown`/`ChevronRight`). Skeleton while entries load. One card at a time + a deck strip (starred lexical, dashed particles) in RTL order. `currentIndex` inits to `firstStarredIndex`, resets when `verseId` changes. Nav is RTL-aware (next = left chevron; ← / → arrow keys); "word X of N". Lexical card anatomy: word header · Root (teal check "from Strong's + BDB") · **How it grew** in `--font-voice` with a sparkles "Lamplight" tag · Related (verified) · Ask. Function card: grammar note only, **no Ask**. The Ask flow uses `useEtymologyVerseInsight`; when no row and `hasAccess('inline')` is false, render the blocked affordance **exactly as `BibleStudyPane` does** (`SignInGate` when `userId == null`, else `PaywallCard` — mirror that component's usage from `src/notepad/components/lamplight/`).

- [ ] **Step 1: Write the failing test** (component states; fake adapter drives entitlement/generation; supabase mocked for reads)

```tsx
// @vitest-environment jsdom
// src/notepad/study/lexicon/EtymologyPanel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

// Deck data comes from the two hooks; mock them so the test targets panel behavior.
const useVerseLexicon = vi.fn();
const useReviewedEtymologyEntries = vi.fn();
const useEtymologyVerseInsight = vi.fn();
const hasAccess = vi.fn();
vi.mock('./useVerseLexicon', () => ({ useVerseLexicon: (...a: unknown[]) => useVerseLexicon(...a) }));
vi.mock('./useReviewedEtymologyEntries', () => ({ useReviewedEtymologyEntries: (...a: unknown[]) => useReviewedEtymologyEntries(...a) }));
vi.mock('./useEtymologyVerseInsight', () => ({ useEtymologyVerseInsight: (...a: unknown[]) => useEtymologyVerseInsight(...a) }));
vi.mock('@/notepad/hooks/useLamplightEntitlement', () => ({ useLamplightEntitlement: () => ({ isLoading: false, tier: 'plus', promoActive: false, hasAccess }) }));

import { EtymologyPanel } from './EtymologyPanel';
import type { EtymologyEntry } from './buildEtymologyDeck';

const shepherdEntry: EtymologyEntry = { strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze', development: 'From tending a flock, the shepherd-king image grew.', related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }], studyValue: 9, source: "Strong's + BDB" };
const words = [
  { position: 4, original: 'רֹעִי', transliteration: 'roi', strongs: 'H7462', morph: 'HVqrmsc/Sp1bs', gloss: 'my shepherd' },
  { position: 5, original: 'לֹא', transliteration: 'lo', strongs: 'H3808', morph: 'HTn', gloss: 'not' },
];

beforeEach(() => {
  hasAccess.mockReturnValue(true);
  useVerseLexicon.mockReturnValue({ words, language: 'hebrew', loading: false, error: null });
  useReviewedEtymologyEntries.mockReturnValue({ entries: new Map([['H7462', shepherdEntry]]), loading: false, error: null });
  useEtymologyVerseInsight.mockReturnValue({ insight: null, loading: false, error: null, generating: false, generate: vi.fn() });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const props = { verseId: 'psa.23.1', reference: 'Psalm 23:1', userId: 'u1', adapter: null };

describe('EtymologyPanel', () => {
  it('renders null when no lexical card exists (out-of-scope verse)', () => {
    useVerseLexicon.mockReturnValue({ words: [words[1]], language: 'hebrew', loading: false, error: null });
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: false, error: null });
    const { container } = render(<EtymologyPanel {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a skeleton while entries load', () => {
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: true, error: null });
    render(<EtymologyPanel {...props} />);
    expect(screen.getByTestId('etymology-skeleton')).toBeInTheDocument();
  });

  it('renders the lexical card: root, the narrated development, and an Ask button', () => {
    render(<EtymologyPanel {...props} />);
    expect(screen.getByText(/to tend, graze/)).toBeInTheDocument();
    expect(screen.getByText(/tending a flock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask lamplight about this verse/i })).toBeInTheDocument();
  });

  it('renders an existing insight inline instead of the Ask button', () => {
    useEtymologyVerseInsight.mockReturnValue({ insight: { body: 'A shared, pre-generated insight.' }, loading: false, error: null, generating: false, generate: vi.fn() });
    render(<EtymologyPanel {...props} />);
    expect(screen.getByText('A shared, pre-generated insight.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask lamplight/i })).not.toBeInTheDocument();
  });

  it('tapping Ask when entitled calls generate()', () => {
    const generate = vi.fn();
    useEtymologyVerseInsight.mockReturnValue({ insight: null, loading: false, error: null, generating: false, generate });
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /ask lamplight about this verse/i }));
    expect(generate).toHaveBeenCalled();
  });

  it('RTL nav: left chevron advances to the next (leftward) card', async () => {
    render(<EtymologyPanel {...props} />);
    expect(screen.getByText(/word 1 of 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next word/i }));
    await waitFor(() => expect(screen.getByText(/word 2 of 2/i)).toBeInTheDocument());
    expect(screen.getByText(/grammar/i)).toBeInTheDocument(); // the particle card, no Ask
    expect(screen.queryByRole('button', { name: /ask lamplight/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/notepad/study/lexicon/EtymologyPanel.test.tsx` → FAIL (import unresolved).

- [ ] **Step 3: Implement `EtymologyPanel.tsx`**

```tsx
// src/notepad/study/lexicon/EtymologyPanel.tsx
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react';
import { useVerseLexicon } from './useVerseLexicon';
import { normalizeStrongs } from './normalizeStrongs';
import { isFunctionWord, buildEtymologyDeck, type EtymologyDeckCard } from './buildEtymologyDeck';
import { useReviewedEtymologyEntries } from './useReviewedEtymologyEntries';
import { useEtymologyVerseInsight } from './useEtymologyVerseInsight';
import { useLamplightEntitlement } from '@/notepad/hooks/useLamplightEntitlement';
import type { LamplightAdapter } from '../../storage/lamplight-adapter';

const label: React.CSSProperties = { fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)' };
const verified: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--verified-teal, #2C7A6B)' };

export interface EtymologyPanelProps {
  verseId: string | null;
  reference: string | null;
  userId: string | null;
  adapter: LamplightAdapter | null;
}

export function EtymologyPanel({ verseId, reference, userId, adapter }: EtymologyPanelProps) {
  const [open, setOpen] = useState(true);
  const { words } = useVerseLexicon(verseId);

  const lexicalKeys = useMemo(
    () => [...new Set(
      words.filter((w) => !isFunctionWord(w.morph) && w.strongs)
        .map((w) => normalizeStrongs(w.strongs as string)).filter(Boolean),
    )],
    [words],
  );
  const { entries, loading } = useReviewedEtymologyEntries(lexicalKeys);
  const { cards, firstStarredIndex } = useMemo(() => buildEtymologyDeck(words, entries), [words, entries]);

  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => { setCurrentIndex(firstStarredIndex); }, [verseId, firstStarredIndex]);

  const hasLexical = cards.some((c) => c.kind === 'lexical');
  if (verseId == null) return null;
  if (!loading && !hasLexical) return null; // panel-activation gate (spec §7)

  const goNext = () => setCurrentIndex((i) => Math.min(i + 1, cards.length - 1)); // RTL: leftward
  const goPrev = () => setCurrentIndex((i) => Math.max(i - 1, 0));
  const current = cards[currentIndex];

  return (
    <section
      style={{ marginBottom: 24, borderBottom: '1px solid var(--pale-stone)', paddingBottom: 16 }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') goNext(); if (e.key === 'ArrowRight') goPrev(); }}
      tabIndex={0}
    >
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />}
        <span style={label}>ETYMOLOGY</span>
        {reference && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{reference}</span>}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {loading && <div data-testid="etymology-skeleton" style={{ height: 120, background: 'var(--cream, #F4F1EA)', borderRadius: 8 }} />}

          {!loading && current && (
            <>
              {current.kind === 'lexical'
                ? <LexicalCard card={current} verseId={verseId} userId={userId} adapter={adapter} />
                : <FunctionCard card={current} />}

              <DeckStrip cards={cards} currentIndex={currentIndex} onSelect={setCurrentIndex} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button type="button" aria-label="next word" onClick={goNext} disabled={currentIndex >= cards.length - 1}
                  style={navBtn}><ChevronLeft className="w-4 h-4" /></button>
                <span style={{ ...label, letterSpacing: 0 }}>word {currentIndex + 1} of {cards.length}</span>
                <button type="button" aria-label="previous word" onClick={goPrev} disabled={currentIndex <= 0}
                  style={navBtn}><ChevronRight className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const navBtn: React.CSSProperties = { minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream, #F4F1EA)', border: 'none', borderRadius: 8, cursor: 'pointer', color: 'var(--deep-umber)' };

function LexicalCard({ card, verseId, userId, adapter }: { card: Extract<EtymologyDeckCard, { kind: 'lexical' }>; verseId: string; userId: string | null; adapter: LamplightAdapter | null }) {
  const { entry, word } = card;
  const { hasAccess } = useLamplightEntitlement({ adapter: adapter as LamplightAdapter, userId: adapter ? userId : null });
  const { insight, generating, error, generate } = useEtymologyVerseInsight(card.strongs, verseId, adapter);
  const canGenerate = hasAccess('inline');

  return (
    <div style={{ borderRadius: 8, background: 'var(--cream, #F4F1EA)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span dir="rtl" style={{ fontSize: 22, color: 'var(--deep-umber)' }}>{word.original}</span>
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--silica)' }}>{word.transliteration}</span>
        <span style={{ fontSize: 12, color: 'var(--deep-umber)' }}>{word.gloss}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{card.strongs}</span>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={verified}><Check className="w-3 h-3" /> from Strong&apos;s + BDB</div>
        <div style={{ fontSize: 13, color: 'var(--deep-umber)' }}><strong>{entry.root}</strong> — {entry.rootGloss}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}><Sparkles className="w-3 h-3" /> Lamplight</div>
        <p style={{ fontFamily: 'var(--font-voice, Georgia, serif)', fontSize: 14, lineHeight: 1.6, color: 'var(--deep-umber)', margin: '2px 0 0' }}>{entry.development}</p>
      </div>

      {entry.related.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={verified}><Check className="w-3 h-3" /> related</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {entry.related.map((r) => (
              <li key={r.strongs} style={{ fontSize: 12, color: 'var(--deep-umber)' }}><span dir="rtl">{r.word}</span> · {r.gloss}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {insight
          ? <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--deep-umber)', margin: 0 }}>{insight.body}</p>
          : canGenerate
            ? (
              <button type="button" onClick={generate} disabled={generating} style={{ ...navBtn, width: '100%', minHeight: 44, fontSize: 13, fontWeight: 600 }}>
                {generating ? 'Lamplight is reflecting…' : 'Ask Lamplight about this verse'}
              </button>
            )
            // Blocked affordance — mirror BibleStudyPane: SignInGate when logged out, else PaywallCard.
            : <BlockedAsk userId={userId} />}
        {error && <p style={{ fontSize: 11, color: 'var(--silica)', margin: '6px 0 0' }}>Couldn&apos;t reach Lamplight — tap Ask to retry.</p>}
      </div>
    </div>
  );
}

// TODO(wiring): replace this inline stand-in with the shared SignInGate / PaywallCard
// components from src/notepad/components/lamplight/ — copy BibleStudyPane's exact usage.
function BlockedAsk({ userId }: { userId: string | null }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--silica)', margin: 0 }}>
      {userId == null ? 'Sign in to ask Lamplight about this verse.' : 'Upgrade to Plus to ask Lamplight about this verse.'}
    </p>
  );
}

function FunctionCard({ card }: { card: Extract<EtymologyDeckCard, { kind: 'function' }> }) {
  const { word } = card;
  return (
    <div style={{ borderRadius: 8, background: 'var(--cream, #F4F1EA)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span dir="rtl" style={{ fontSize: 22, color: 'var(--deep-umber)' }}>{word.original}</span>
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--silica)' }}>{word.transliteration}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--silica)', margin: '8px 0 0' }}><strong>Grammar:</strong> {word.gloss} — a function word ({word.morph}); it shapes the sentence rather than carrying its own etymology.</p>
    </div>
  );
}

function DeckStrip({ cards, currentIndex, onSelect }: { cards: EtymologyDeckCard[]; currentIndex: number; onSelect: (i: number) => void }) {
  return (
    <ul dir="rtl" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', gap: 6, overflowX: 'auto' }}>
      {cards.map((c, i) => {
        const isStarredLexical = c.kind === 'lexical' && c.starred;
        return (
          <li key={c.position}>
            <button type="button" onClick={() => onSelect(i)} aria-current={i === currentIndex}
              style={{
                minWidth: 44, minHeight: 32, borderRadius: 6, cursor: 'pointer', color: 'var(--deep-umber)',
                background: i === currentIndex ? 'var(--pale-stone)' : 'var(--cream, #F4F1EA)',
                border: c.kind === 'function' ? '1px dashed var(--silica)' : '1px solid transparent',
                fontWeight: isStarredLexical ? 700 : 400,
              }}>
              <span dir="rtl">{c.word.original}</span>{isStarredLexical ? ' ★' : ''}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS (6 tests).

- [ ] **Step 5: Wire the real blocked affordance**

Open `src/notepad/bible/BibleStudyPane.tsx` and copy its `SignInGate`/`PaywallCard` usage; replace the `BlockedAsk` stand-in with the same components + props. Re-run the panel test (the "blocked" path isn't asserted, so it stays green) and `npx tsc -b`.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/study/lexicon/EtymologyPanel.tsx src/notepad/study/lexicon/EtymologyPanel.test.tsx
git commit -m "feat(etymology): EtymologyPanel deck component"
```

---

## Task 8: Integration — mount the panel + thread `userId`/`adapter`

**Files:**
- Modify: `src/notepad/study/panes/ApparatusRail.tsx` (add props; mount `<EtymologyPanel>` under `<OriginalLanguagePanel>`)
- Test: `src/notepad/study/panes/ApparatusRail.test.tsx` (add a mount assertion; mock `EtymologyPanel`)
- Modify: `src/notepad/study/StudyWorkspace.tsx` (L129 render site)
- Modify: `src/notepad/study/mobile/MobileStudyWorkspace.tsx` (L89 render site)

**Interfaces:**
- Consumes: `EtymologyPanel` (Task 7); `LamplightAdapter`.
- Produces: `ApparatusRailProps` gains `userId?: string | null` and `adapter?: LamplightAdapter | null` (both optional, default `null` — existing callers/tests keep compiling).

- [ ] **Step 1: Write the failing test** (mock `EtymologyPanel`, assert it mounts with the OSIS `verseId` + threaded props)

```tsx
// Add to src/notepad/study/panes/ApparatusRail.test.tsx
vi.mock('../lexicon/EtymologyPanel', () => ({ EtymologyPanel: (props: Record<string, unknown>) => <div data-testid="etymology" data-verse={String(props.verseId)} data-user={String(props.userId)} /> }));

// …inside a describe:
it('mounts EtymologyPanel with the OSIS verseId and threaded userId', () => {
  render(<ApparatusRail book="psa" chapter={23} selectedVerse={1} userId="u1" adapter={null} />);
  const panel = screen.getByTestId('etymology');
  expect(panel).toHaveAttribute('data-verse', 'psa.23.1');
  expect(panel).toHaveAttribute('data-user', 'u1');
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx` → FAIL (`EtymologyPanel` not rendered / props absent).

- [ ] **Step 3: Implement the rail changes**

In `ApparatusRail.tsx`: add the import, extend props, render the panel after `<OriginalLanguagePanel>`:

```tsx
import { EtymologyPanel } from '../lexicon/EtymologyPanel';
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';

export interface ApparatusRailProps {
  book: string;
  chapter: number;
  selectedVerse?: number | null;
  userId?: string | null;
  adapter?: LamplightAdapter | null;
}

export function ApparatusRail({ book, chapter, selectedVerse = null, userId = null, adapter = null }: ApparatusRailProps) {
  // …existing body up to the OriginalLanguagePanel…
```

Then, directly under the existing `<OriginalLanguagePanel verseId={verseId} reference={reference} />` (L28):

```tsx
      <EtymologyPanel verseId={verseId} reference={reference} userId={userId} adapter={adapter} />
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

- [ ] **Step 5: Supply the props at both workspace render sites**

In `StudyWorkspace.tsx` (L129) and `mobile/MobileStudyWorkspace.tsx` (L89), pass `userId` + `adapter` to `<ApparatusRail>`. `userId` is already in scope at these sites (per recon); source the adapter the same way `BibleStudyPane` does. If a value isn't already in scope, derive `userId` via `useAuthSession()` and import the shared `lamplightAdapter` (mirror `BibleStudyPane.tsx`):

```tsx
<ApparatusRail book={passage.book} chapter={passage.chapter} selectedVerse={selectedVerse} userId={userId} adapter={lamplightAdapter} />
```

- [ ] **Step 6: Typecheck + workspace tests**

Run: `npx tsc -b`
Expected: exits 0.
Run: `npx vitest run src/notepad/study/StudyWorkspace.test.tsx src/notepad/study/mobile/MobileStudyWorkspace.test.tsx src/notepad/study/panes/ApparatusRail.test.tsx`
Expected: PASS (these mock `ApparatusRail`/child panels, so they stay green).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/study/panes/ApparatusRail.tsx src/notepad/study/panes/ApparatusRail.test.tsx src/notepad/study/StudyWorkspace.tsx src/notepad/study/mobile/MobileStudyWorkspace.tsx
git commit -m "feat(etymology): mount EtymologyPanel + thread userId/adapter through ApparatusRail"
```

---

## Task 9: Mobile / Context-tab adaptations

Spec §6: same anatomy, restacked full-width; deck strip = horizontally scrollable RTL strip (already `overflow-x: auto` + `dir="rtl"` from Task 7); 44px touch targets (already applied to nav + strip buttons); full-width Ask (already `width:100%`). This task adds the one remaining mobile branch — a swipe affordance hint and confirms the touch sizing on a mobile viewport.

**Files:**
- Modify: `src/notepad/study/lexicon/EtymologyPanel.tsx`
- Test: `src/notepad/study/lexicon/EtymologyPanel.test.tsx` (add a mobile case)

- [ ] **Step 1: Locate the existing mobile hook**

Run: `grep -rn "useIsMobile" src/notepad | head -3`
Expected: the hook's path (e.g. `@/notepad/hooks/useIsMobile`). Use whatever the grep reports as the import.

- [ ] **Step 2: Write the failing test**

```tsx
// Add to EtymologyPanel.test.tsx
vi.mock('@/notepad/hooks/useIsMobile', () => ({ useIsMobile: () => true })); // adjust path to Step 1

it('shows a swipe hint on mobile', () => {
  render(<EtymologyPanel {...props} />);
  expect(screen.getByText(/swipe/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails** — → FAIL (no swipe hint).

- [ ] **Step 4: Implement** — import the hook and render the hint under the deck strip when mobile:

```tsx
import { useIsMobile } from '@/notepad/hooks/useIsMobile'; // path from Step 1
// …in EtymologyPanel body:
const isMobile = useIsMobile();
// …after <DeckStrip …/>:
{isMobile && <p style={{ fontSize: 10, color: 'var(--silica)', margin: '6px 0 0' }}>Swipe the strip to move through the verse.</p>}
```

- [ ] **Step 5: Run to verify it passes** — → PASS. Then `npx tsc -b` → exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/study/lexicon/EtymologyPanel.tsx src/notepad/study/lexicon/EtymologyPanel.test.tsx
git commit -m "feat(etymology): mobile swipe affordance + touch sizing"
```

---

## Task 10: Offline seed script + anti-hallucination check

**Not CI/Vercel.** A one-time (repeatable) maintenance runner that enumerates every unique Psalms Hebrew Strong's number, builds a verified grounding record from public-domain lexicon data (OpenScriptures Strong's `derivation` + BDB), narrates `development` under the never-invent prompt, and inserts `bible_etymology` rows with `reviewed = false`. A human proofing pass then flips `reviewed = true` (the structural launch gate). **The panel is absent everywhere until this runs and rows are proofed.** This task ships the *testable pure pieces* (grounding-record builder + the §9 anti-hallucination validator) with full TDD; the runner wiring + external-data acquisition + proofing are operational.

**Files:**
- Create: `scripts/etymology/etymology-grounding.ts` (pure: build grounding record + `validateGroundedNarration`)
- Test: `scripts/etymology/etymology-grounding.test.ts`
- Create: `scripts/etymology/seed-etymology.ts` (runner; wires enumeration + lexicon inputs + Anthropic + insert)

**Interfaces:**
- Produces: `buildGroundingRecord(strongsRaw, lexicon): GroundingRecord`; `validateGroundedNarration(development, record): { ok: boolean; unsupported: string[] }` — the §9 check asserting the narration references only facts present in the grounding record.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/etymology/etymology-grounding.test.ts
import { describe, it, expect } from 'vitest';
import { buildGroundingRecord, validateGroundedNarration, type LexiconEntry } from './etymology-grounding';

const lexicon: Record<string, LexiconEntry> = {
  H7462: { lemma: 'רָעָה', derivation: 'a primitive root', root: 'רעה', rootGloss: 'to tend, graze', bdbGloss: 'to pasture, tend, graze', related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }] },
};

describe('buildGroundingRecord', () => {
  it('assembles verified facts from the lexicon into a grounding record', () => {
    const rec = buildGroundingRecord('H7462', lexicon);
    expect(rec).toMatchObject({ strongs: 'H7462', root: 'רעה', rootGloss: 'to tend, graze', source: "Strong's + BDB" });
    expect(rec.related).toEqual([{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }]);
  });
});

describe('validateGroundedNarration (anti-hallucination, spec §9)', () => {
  const rec = buildGroundingRecord('H7462', lexicon);
  it('passes when the narration only references grounded terms', () => {
    const res = validateGroundedNarration('From the root meaning to tend and graze, the shepherd image grew.', rec);
    expect(res.ok).toBe(true);
    expect(res.unsupported).toEqual([]);
  });
  it('flags an invented cognate not present in the grounding record', () => {
    const res = validateGroundedNarration('It derives from an Akkadian word for kingship.', rec);
    expect(res.ok).toBe(false);
    expect(res.unsupported).toContain('Akkadian');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run scripts/etymology/etymology-grounding.test.ts` → FAIL (import unresolved).

- [ ] **Step 3: Implement the pure module**

```ts
// scripts/etymology/etymology-grounding.ts
export interface LexiconEntry {
  lemma: string;
  derivation: string;
  root: string;
  rootGloss: string;
  bdbGloss: string;
  related: Array<{ strongs: string; word: string; gloss: string }>;
}

export interface GroundingRecord {
  strongs: string;
  lemma: string;
  root: string;
  rootGloss: string;
  bdbGloss: string;
  related: Array<{ strongs: string; word: string; gloss: string }>;
  source: string;
}

export function buildGroundingRecord(strongs: string, lexicon: Record<string, LexiconEntry>): GroundingRecord {
  const e = lexicon[strongs];
  if (!e) throw new Error(`no lexicon entry for ${strongs}`);
  return {
    strongs, lemma: e.lemma, root: e.root, rootGloss: e.rootGloss, bdbGloss: e.bdbGloss,
    related: e.related, source: "Strong's + BDB",
  };
}

// The §9 grounding check: every capitalized proper noun / language name in the
// narration must appear somewhere in the grounding record. Catches invented
// cognates ("Akkadian", "Ugaritic", place/deity names) the lexicon never asserted.
const LANGUAGE_OR_PROPER = /\b([A-Z][a-z]{3,})\b/g;
const ALLOWED_SENTENCE_STARTERS = new Set(['From', 'The', 'It', 'This', 'A', 'An', 'In', 'Its', 'When', 'Here', 'Both', 'As']);

export function validateGroundedNarration(development: string, record: GroundingRecord): { ok: boolean; unsupported: string[] } {
  const haystack = [record.lemma, record.root, record.rootGloss, record.bdbGloss, ...record.related.flatMap((r) => [r.word, r.gloss])].join(' ').toLowerCase();
  const unsupported: string[] = [];
  for (const m of development.matchAll(LANGUAGE_OR_PROPER)) {
    const term = m[1];
    if (ALLOWED_SENTENCE_STARTERS.has(term)) continue;
    if (!haystack.includes(term.toLowerCase())) unsupported.push(term);
  }
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS (3 tests).

- [ ] **Step 5: Write the runner** `scripts/etymology/seed-etymology.ts` (operational; not unit-tested — it performs I/O)

```ts
// scripts/etymology/seed-etymology.ts
// Offline seed for bible_etymology (v1: Psalms + Hebrew). Run manually:
//   npx tsx scripts/etymology/seed-etymology.ts
// Steps: (1) enumerate unique Psalms Hebrew Strong's from bible_interlinear
// (verse_id like 'psa.%'); (2) build a verified grounding record from the
// public-domain lexicon inputs under scripts/data/; (3) narrate `development`
// via Opus under the never-invent prompt; (4) run validateGroundedNarration —
// SKIP + log any row whose narration references ungrounded terms; (5) insert
// rows with reviewed=false for the human proofing pass.
//
// Grounding data (place under scripts/data/, both public domain):
//   - OpenScriptures Strong's Hebrew dictionary (strongs → derivation, lemma)
//   - BDB via HebrewLexicon (strongs → gloss, root)
//
// Rows land reviewed=false; a human proofing pass flips reviewed=true (the
// structural launch gate). The panel is absent until proofed rows exist.
//
// Wiring checklist for the implementer:
//   - createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — service role bypasses RLS.
//   - createAnthropicAdapter({ apiKey: ANTHROPIC_API_KEY, fetch }) + VERSE-style
//     never-invent prompt for the `development` field (a study-time analogue of
//     supabase/functions/etymology-insight/prompts/verse-insight.ts).
//   - buildGroundingRecord + validateGroundedNarration from ./etymology-grounding.
//   - study_value: seed heuristically (e.g. by lemma frequency / theological weight);
//     it is proof-adjustable and drives per-verse star ranking.
export {}; // implementer fills in the I/O per the checklist above.
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b`
Expected: exits 0.

```bash
git add scripts/etymology/etymology-grounding.ts scripts/etymology/etymology-grounding.test.ts scripts/etymology/seed-etymology.ts
git commit -m "feat(etymology): offline grounding builder + anti-hallucination validator + seed runner"
```

---

## Final completion gate (run after all tasks)

- [ ] `npx tsc -b` → exits 0 (the repo gotcha gate — a prod-build type error hides behind passing lint + tests).
- [ ] `npx vitest run` → all green.
- [ ] `npx eslint .` → clean (or only pre-existing warnings).
- [ ] Deploy `etymology-insight` (`supabase functions deploy etymology-insight`), run the seed script, proof + flip `reviewed=true` for a Psalm, and verify the panel appears for that verse in the Study tab.

---

## Self-Review (completed against the spec)

**1. Spec coverage** — every section maps to a task:
- §4.2 tables → Task 1. §7 deck construction / §5 particle rule / §7 star ranking + opens-on-first-starred → Task 2. §4.1 batched reviewed reader → Task 3. §7 read-or-generate insight → Task 4. Adapter seam → Task 5. §4.1 edge fn + §8 invariants (entitlement, ON CONFLICT DO NOTHING, failure = no row + no quota) → Task 6. §5 card anatomy + grounded-legible marks + §7 nav/gating → Task 7. §4.1 mount → Task 8. §6 mobile → Task 9. §4.3 offline pipeline + §9 anti-hallucination check → Task 10. §11 attribution is inherited from `OriginalLanguagePanel` (present in the rail above the panel). §10 deferred items are intentionally out of scope.
- **§9 "Component states" coverage:** loading skeleton, empty/absent panel, populated card, insight-present vs Ask, RTL nav are asserted in Task 7; generation error/retry surface is rendered (soft retry line) though not separately asserted — acceptable (the hook's error path is unit-tested in Task 4).

**2. Placeholder scan** — one deliberate, flagged stand-in: `BlockedAsk` in Task 7 (Step 5 replaces it with the real `SignInGate`/`PaywallCard`, mirroring `BibleStudyPane`, because those components' exact props weren't captured in recon). The Task 10 runner is intentionally an operational stub (I/O + external public-domain data), with its pure logic fully TDD'd. No other TODOs, "add error handling", or undefined references.

**3. Type consistency** — `EtymologyEntry`/`RelatedWord` defined in Task 2, imported unchanged by Tasks 3/7. `EtymologyInsightResult` (Task 5) structurally satisfies `InsightGenerator` (Task 4). `GenerationOutcome`/`UsageCore` shapes match the real `_shared` contracts read from source. `verse_id` is text OSIS throughout. Adapter method name `generateEtymologyInsight` is identical in the interface, prod impl, fake, hook usage, and edge-fn payload (`{ strongs, verse_id }`).

