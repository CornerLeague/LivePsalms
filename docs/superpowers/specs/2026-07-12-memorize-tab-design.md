# Memorize Tab — Design Spec

**Date:** 2026-07-12
**Status:** Approved (brainstorming complete; ready for implementation plan)
**Feature:** A Scripture-memorization self-quiz tab in the Study side panel, applying
active-recall (retrieval practice) principles. Mind-mapping is a deliberate future follow-up.

---

## 1. Goal & scope

Add a **Memorize** tab to the notebook Study side panel that lets a user practice
memorizing Bible verses through active recall. v1 is **quiz-first**: the retrieval quiz is
the spine; a mind-map "encode" companion is explicitly deferred to a later spec.

### Decisions locked during brainstorming
- **Direction:** Both active-recall + mind-mapping *as one loop*, but **ship the quiz first**;
  mind-map canvas is a fast-follow in a separate spec.
- **Content source:** **Scripture passages** (the verses in the Reader). Architected so
  note-based cards can be added later without a rewrite. No note cards in v1.
- **Quiz modes (v1):** **Cloze (fill-in-the-blank)** + **Blank-page recall** + **Reference
  flashcard**. (First-letter-hint mode deferred — it is a trivial later addition to the cloze engine.)
- **Persistence:** **Level 2** — a saved, per-user Memorize list with per-verse mastery.
  One Supabase table, RLS-scoped to the owner. **Not** full spaced-repetition scheduling (that
  is Level 3, a clean follow-up that consumes the same mastery data).
- **Card granularity:** **card = one verse.** Multi-verse passages become multiple cards,
  practiced together as a set grouped by book+chapter. No named/custom lists in v1 — the
  collection is a flat per-user set.
- **Guest / logged-out:** progress persists to **localStorage** (device-local, no cross-device
  sync), mirroring the Scripture Focus Lists guest idiom. Verse reads work for guests regardless
  (`bible_passages` is public-read).

---

## 2. Blueprint to mirror

The existing **Scripture Focus Lists** feature is a near-complete structural blueprint. Copy its
shape; do not invent new patterns.

- Migration template: `supabase/migrations/042_scripture_focus_lists.sql`
- Adapter split: `src/notepad/bible/focus/` — `focus-list-types.ts` (interface),
  `supabase-focus-list-adapter.ts` (production, `(client, userId)` ctor, private `#client`/`#userId`),
  `in-memory-focus-list-adapter.ts` (test fake), `useScriptureFocusLists.ts` (hook that builds
  the adapter and falls back to localStorage for guests).

---

## 3. Placement & shell

- **Panel:** `src/notepad/study/panes/StudySidePanel.tsx`. Add `'memorize'` to the `StudyTab`
  union (currently `'notes' | 'chat'`), add a third tab button **Notes · Chat · Memorize**, and
  render a `<MemorizePanel book={book} chapter={chapter} userId={userId} />` pane.
- **State survival:** use the same **display-toggle** approach the existing tabs use (`display:
  'block'|'none'`) so an in-progress quiz survives tab switches.
- **Mobile:** the Study side panel is the mobile "Study" bottom-tab
  (`src/notepad/study/mobile/MobileStudyWorkspace.tsx` renders `<StudySidePanel>` for the
  `study` tab). Memorize therefore appears on mobile automatically as a sub-tab — **no new
  bottom-tab entry** in `StudyTabBar.tsx`. All quiz UI must use touch-friendly targets.

---

## 4. Two views inside the tab

### 4a. Home (`MemorizePanel`)
- Verses grouped by passage (book+chapter), each row: verse ref + short text preview + a
  **mastery bar** (0–100%).
- **"＋ Add current passage"** button — adds the verses of the passage currently open in the
  Reader (uses the `book`/`chapter` props already passed in).
- Per-passage **Practice ▸** entry point; per-row overflow (remove card, practice just this verse).
- Empty state when no cards yet (prompt to add the current passage).

### 4b. Quiz session (`QuizSession`)
- Mode selector chips: **Cloze / Blank-page / Flashcard**.
- Runs the passage's cards one at a time with progress dots.
- End-of-session summary writes mastery back to each card.

---

## 5. Getting verses in (snapshot model)

Both entry points **snapshot** `text + translation + reference` into the card so a quiz stays
stable even if the Reader's translation later changes. (This is the opposite of Focus Lists,
which deliberately store ref-only; for a quiz we want a frozen text.)

1. **"Add current passage"** in the Memorize home.
2. **"Add to Memorize"** action on the Reader's existing verse-tap popover. Mirror the highlight
   swatch affordance in `src/notepad/bible/BibleReader.tsx` `selectVerse(verse)` (opens a popover
   anchored to `#bible-verse-${verse}`). The verse text is available in-component via the
   `verses` array (`ReaderVerse[]` from `useBiblePassages`): `verses.find(v => v.verse === verse)?.text`.

### Verse text source
- Hook: `src/notepad/bible/useBiblePassages.ts` — `useBiblePassages(book, chapter, translation)`
  returns `{ verses: ReaderVerse[], loading, error }` where `ReaderVerse = { verse: number; text: string }`.
- Table `bible_passages` (migration `009_bible_passages.sql`), public-read RLS.
- Types: `PassageRef = { book: string; chapter: number }`, `VerseRef = PassageRef & { verse: number }`
  in `BibleReader.tsx`; `BibleTranslation` in `src/notepad/bible/translations.ts`; book metadata in
  `src/notepad/bible/bible-books.ts`. `book` is an OSIS abbrev string (e.g. `"jhn"`).

---

## 6. Quiz engine & grading (pure, unit-tested logic first)

All grading logic is pure and lives in standalone modules with tests written **before** UI (TDD).

- **`cloze.ts`** — tokenize snapshot text into words; a difficulty level (e.g. 20%→100%) selects
  which words to blank. Selection is **deterministic within a session** (seeded pick) so a card
  doesn't reshuffle mid-attempt. Grade per blank: normalize (lowercase, strip punctuation,
  collapse whitespace) then exact-match; return per-blank correct/incorrect; support a
  "close enough?" manual override. Punctuation and non-word tokens are never blanked.
- **`blank-page-diff.ts`** — full recall: compare the user's typed text against the snapshot via
  a word-level LCS diff → matched / missed / extra tokens for display; the user self-confirms.
  This is the "blank page method" from the brief.
- **Flashcard** — reference ↔ verse; pure self-rate (Again / Got it). No text grading.
- **`mastery.ts`** — per-card `mastery` 0–100 updated by a simple EMA:
  `mastery = round(0.6 * prev + 0.4 * attemptScore)`, where `attemptScore` is 0–100 derived from
  the mode's result (cloze = % blanks correct; blank-page = % words matched; flashcard =
  100 for "Got it" / 0 for "Again"). Also bump `attempts` and set `last_practiced_at`. These
  fields are exactly what a future Level-3 scheduler would consume.

---

## 7. Data model & persistence

### Table: `memorize_cards` (new migration `049_memorize_cards.sql`)
Mirror `042_scripture_focus_lists.sql` conventions exactly.

| column | type | notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `user_id` | `uuid not null references public.profiles(id) on delete cascade` | **references `public.profiles`, NOT `auth.users`** |
| `book` | `text not null` | OSIS abbrev |
| `chapter` | `integer not null` | |
| `verse` | `integer not null` | one verse per card |
| `translation` | `text not null` | snapshot's translation |
| `text` | `text not null` | **snapshot** of the verse text |
| `mastery` | `integer not null default 0` | 0–100 |
| `attempts` | `integer not null default 0` | |
| `last_practiced_at` | `timestamptz` | nullable until first practice |
| `position` | `integer not null default 0` | ordering |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | |

- Index: `memorize_cards_user_idx on public.memorize_cards (user_id, position)`.
- Enable RLS; **one policy per verb** named as sentences, all gated on `auth.uid() = user_id`:
  `"Users can view own memorize cards"` (select), insert (`with check`), update (`using` +
  `with check`), delete (`using`).
- Uniqueness: **add** a unique constraint on `(user_id, book, chapter, verse, translation)`.
  Adding an already-present verse is a **no-op upsert** (the "Add to Memorize" affordance and
  "Add current passage" both de-dupe against it) — it must never create a duplicate card or reset
  mastery on an existing card.

**One table only** in v1 — no parent "list" table (the collection is flat/per-user) and no
per-attempt `memorize_reviews` history table (that is a Level-3 addition).

### Adapter split (mirror `focus/`)
- `memorize-types.ts` — domain types (`MemorizeCard`, attempt/result types) + `MemorizeAdapter`
  interface (CRUD: list, add (upsert), updateAfterAttempt, remove).
- `supabase-memorize-adapter.ts` — `class SupabaseMemorizeAdapter implements MemorizeAdapter`,
  ctor `(client: SupabaseClient, userId: string)`, private `#client`/`#userId`, maps snake_case
  rows ↔ camelCase domain types.
- `in-memory-memorize-adapter.ts` (+ `.test.ts`) — `class InMemoryMemorizeAdapter implements
  MemorizeAdapter` for tests; its test proves the CRUD/ordering contract.
- `useMemorizeCards.ts` (+ `.test.ts`) — hook that selects the adapter:
  ```ts
  const adapter = useMemo(() => {
    if (opts.adapterOverride !== undefined) return opts.adapterOverride; // test injection
    if (supabase && userId) return new SupabaseMemorizeAdapter(supabase, userId);
    return null; // guest
  }, [opts.adapterOverride, userId]);
  ```
  `const canSave = adapter != null`. `supabase` from `src/lib/supabase.ts` (nullable; null-guard).

### Guest / logged-out
`userId === null` ⇒ adapter null ⇒ cards live in React state mirrored to **localStorage** via new
helpers in `src/notepad/session/session-storage.ts` (follow the existing
`load*/save*` helper pattern, e.g. `loadQuickListItems`/`saveQuickListItems`). Auth detection:
`const { user } = useAuthSession(); const userId = user?.id ?? null;`
(`src/auth/context/useAuthSession.ts`).

---

## 8. Testing conventions

- vitest; config `vitest.config.ts` (default env `node`, `globals: false` — import
  `describe/it/expect`; setup `./src/test-setup.ts`; alias `@ → ./src`).
- Co-located `*.test.ts` / `*.test.tsx`.
- Component tests opt into jsdom with a file-top `// @vitest-environment jsdom` pragma, then use
  `@testing-library/react` (`render, screen, fireEvent, waitFor, cleanup`) with `afterEach(cleanup)`.
- Reference component tests: `src/notepad/study/panes/StudySidePanel.test.tsx`,
  `StudyReader.test.tsx`, `StudyWorkspace.test.tsx`. Adapter-contract reference:
  `src/notepad/bible/focus/in-memory-focus-list-adapter.test.ts`.
- **Gate before "done":** `tsc -b` (0 errors) **and** vitest (green) **and** eslint on touched
  files. (Repo lesson: completion must run `tsc -b`, not just eslint+vitest. A pre-existing
  `garden-scene` test failure is unrelated and not introduced by this work.)

---

## 9. File plan (new dir `src/notepad/study/memorize/`)

**Pure logic (TDD first):** `memorize-types.ts` · `cloze.ts` (+test) · `blank-page-diff.ts`
(+test) · `mastery.ts` (+test)
**Persistence:** `supabase-memorize-adapter.ts` · `in-memory-memorize-adapter.ts` (+test) ·
`useMemorizeCards.ts` (+test)
**UI:** `MemorizePanel.tsx` (+test) · `QuizSession.tsx` (+test) · `ClozeQuiz.tsx` ·
`BlankPageQuiz.tsx` · `FlashcardQuiz.tsx` (+tests)
**Edits:** `src/notepad/study/panes/StudySidePanel.tsx` (add tab) ·
`src/notepad/bible/BibleReader.tsx` (add "Add to Memorize" affordance) ·
`src/notepad/session/session-storage.ts` (guest persistence helpers)
**DB:** `supabase/migrations/049_memorize_cards.sql`

---

## 10. Out of v1 (deferred, forward-compatible)

First-letter-hint mode · note-based cards · mind-map "encode" canvas · full SM-2 / Leitner
scheduling and a "due today" queue · per-attempt `memorize_reviews` history table · cross-device
guest sync. Each layers on top of the flat card model + mastery fields without a rewrite.
