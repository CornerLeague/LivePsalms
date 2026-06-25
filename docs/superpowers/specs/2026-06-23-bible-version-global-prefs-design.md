# Design: Per-user persistent + globally-shared Bible version & verse layout

**Date:** 2026-06-23
**Branch:** `feat/bible-version-global-prefs`
**Status:** Approved (design) — pending spec review

## Problem

Two related gaps in how Bible reading preferences behave:

1. **Verse-layout doesn't reliably persist per user.** The inline/lines/spaced
   verse-layout toggle is stored via a hook that *can* sync to the user's
   profile, but several call sites invoke it without a `userId`, so the choice
   is lost on the next login and can drift between panes.

2. **Bible version is not global.** When a user selects KJV (or WEB/BSB), the
   choice is held in independent per-component state. There is no single source
   of truth, so the Bible reader, the notepad editor's Scripture references, and
   the Lamplight AI responses can each show a different version. The user wants
   one selection to govern the **entire app** — verse references, AI Scripture
   citations, everything — and to live in the user's profile settings.

## Current state (what already exists)

The plumbing is largely built; the gap is that it is not unified.

- **DB columns already exist on `public.profiles`:**
  - `bible_translation` (`text`, default `'BSB'`, CHECK `in ('BSB','KJV','WEB')`) — migrations `037` + `038`.
  - `bible_verse_layout` (`text`, default `'inline'`, CHECK `in ('inline','lines','spaced')`) — migration `040`.
  - `theme` (`text`, default `'system'`) — migration `039` (reference pattern, not in scope here).
  - **→ No new migration is required.**

- **Persistence hooks already exist** and are structurally identical:
  - `src/notepad/bible/useBibleTranslation.ts`
  - `src/notepad/bible/useBibleVerseLayout.ts`
  - Each: `useState` seeded from `localStorage` (`loadEnum`); hydrate from the
    profile column when `userId` is present; setter writes `localStorage`
    (`saveEnum`) **and** `supabase.from('profiles').update({ <col>: value })`.
  - **localStorage is the instant per-device default; the profile column is the
    cross-device / cross-login source of truth.**

- **Theme is the finished model to copy.** It was promoted to a global Context:
  `src/notepad/theme/ThemeProvider.tsx` (calls `useThemePreference({ userId })`
  once, sources `userId` from `useAuthSession()`) + `theme-context.ts`
  (`ThemeContext` + `useTheme()`), mounted in `App.tsx` inside `AuthProvider`.

- **The four independent translation/layout call sites today:**
  - `src/notepad/bible/BibleStudyPane.tsx` — passes `{ userId }` ✓
  - `src/notepad/study/panes/StudyReader.tsx` — **no `userId`** ✗ (won't persist)
  - `src/notepad/components/Editor.tsx` — **no `userId`** ✗ (translation only; frozen at mount)
  - `src/notepad/components/lamplight/chat/LamplightChat.tsx` — passes `{ userId }` ✓

- **Lamplight AI version-awareness today:**
  - `lamplight-chat` — version-aware (validates body `translation`, fetches with `.eq('translation', …)`). ✓
  - `lamplight-generate` — version-aware **and** profile-aware: when body lacks a
    valid translation it reads `profiles.bible_translation` (`index.ts:104-119`). ✓ (canonical reference)
  - `lamplight-study` — **NOT version-aware**: `study-context.ts` fetches
    `bible_passages` with `.like('id', …)` / `.eq('id', …)` and no translation
    filter. ✗ (must fix)
  - `verse-search` — BSB-only semantic *reference finder*. The edge function does
    **not** need changes; the frontend re-resolves verse text version-awarely
    (see §5). ✓ (edge fn) / frontend bug to fix.

## Goals

- One global source of truth for Bible version and verse layout, shared by every
  surface (reader, editor/Scripture refs, Lamplight chat & study).
- Both preferences persist per user across logout/login and across devices.
- Controls available **both** in the Bible reader toolbar (quick switch) and in
  the Profile settings page (canonical home) — always in sync.
- Lamplight AI Scripture output honors the selected version on **every** path.
- Embedded verse references in notes **re-flow to the active version live**.

## Non-goals (YAGNI)

- Surfacing these prefs in the central `AccountProfile` / `mapProfile()` store —
  the feature hooks read the columns directly; not needed.
- Theme controls in Profile settings — theme already has its own toggle + context.
- Rewriting the *stored bytes* of saved note content on version change (see §5
  for why display-time re-resolution is used instead).
- Batching/optimizing the per-node re-resolution fetch (acceptable as-is; noted
  as a future optimization).

## Design

### 1. Shared global state — `BiblePrefsProvider`

Mirror `ThemeProvider` exactly.

- **New:** `src/notepad/bible/prefs/bible-prefs-context.ts`
  ```ts
  export interface BiblePrefsContextValue {
    translation: BibleTranslation;
    setTranslation: (t: BibleTranslation) => void;
    verseLayout: VerseLayout;
    setVerseLayout: (l: VerseLayout) => void;
  }
  export const BiblePrefsContext = createContext<BiblePrefsContextValue | null>(null);
  export function useBiblePrefs(): BiblePrefsContextValue { /* throws if no provider */ }
  ```
- **New:** `src/notepad/bible/prefs/BiblePrefsProvider.tsx`
  - Reads `userId` from `useAuthSession()`.
  - Calls `useBibleTranslation({ userId })` and `useBibleVerseLayout({ userId })`
    **once**, memoizes the value, provides it.
- **Mount** in `App.tsx` adjacent to `ThemeProvider`, inside `AuthProvider`
  (so `useAuthSession()` is available). Both notepad surfaces and Lamplight live
  under it.

**Consumer migration** — replace the 4 direct hook calls with `useBiblePrefs()`:

| File | Change |
|---|---|
| `BibleStudyPane.tsx` | use `useBiblePrefs()` instead of the two hooks |
| `study/panes/StudyReader.tsx` | use `useBiblePrefs()` → **fixes missing-`userId` persistence** |
| `components/Editor.tsx` | read `translation` from `useBiblePrefs()` → **fixes missing-`userId` persistence**; still threads it into the editor at mount (see §5) |
| `lamplight/chat/LamplightChat.tsx` | use `useBiblePrefs()` |

The hooks `useBibleTranslation` / `useBibleVerseLayout` are no longer called
outside the provider. They keep their current signature (still take `{ userId }`)
and remain unit-testable in isolation; only the provider calls them at runtime.

> **Single-instance invariant:** to avoid two live copies of the state diverging,
> the hooks must be invoked **only** by `BiblePrefsProvider`. The migration must
> remove every other call site (the 4 above). A lint-grep check during
> implementation confirms no stray `useBibleTranslation(`/`useBibleVerseLayout(`
> calls remain outside `prefs/` and the hooks' own tests.

### 2. Persistence

No code change beyond §1 — the existing hooks already write `localStorage` +
the profile column whenever `userId` is present. Routing every consumer through
the provider (which always has `userId` when signed in) is precisely what makes
"stays like that when they log back in" hold on every surface, including the two
that silently dropped it before. **No migration.**

### 3. Profile Settings UI

Add a **"Bible & Reading"** section to `src/auth/ProfilePage.tsx`:

- Version selector (the `TRANSLATIONS` list) bound to
  `useBiblePrefs().translation` / `setTranslation`.
- Verse-layout control (inline / lines / spaced) bound to `verseLayout` /
  `setVerseLayout`.
- Follows existing `ProfilePage` section styling (sibling of
  `LamplightSettingsSection` etc.).

The **`BibleReader` toolbar controls stay** (`BibleReader.tsx:178-199`). They are
re-pointed at the shared context (today they receive `translation` /
`onTranslationChange` / `verseLayout` / `onVerseLayoutChange` as props from
`BibleStudyPane`, which now sources them from `useBiblePrefs()`). Toolbar and
settings therefore read/write the same state and never disagree.

### 4. Lamplight AI in the selected version

- **`lamplight-chat` / `lamplight-generate`:** already version-aware. `LamplightChat`
  already forwards `translation` (now from the shared context). Background/server
  generation already reads `profiles.bible_translation`. **No change.**

- **`lamplight-study` — fix:**
  1. In `supabase/functions/lamplight-study/index.ts`, resolve the translation by
     copying the exact pattern from `lamplight-generate/index.ts:100-119`:
     prefer a valid `translation` in the request body; otherwise read
     `profiles.bible_translation` for the authed user; defensive fallback `'BSB'`.
  2. Thread `translation` into `buildStudyContext(...)`
     (`supabase/functions/lamplight-study/study-context.ts`).
  3. Add `.eq('translation', translation)` to the `bible_passages` reads in
     `study-context.ts`: the open-chapter fetch (`~line 44-48`) and the cross-ref
     target resolution (`~line 84-85`). This also removes the latent risk of the
     `.eq('id', …).maybeSingle()` cross-ref lookup matching multiple translation
     rows. (Implementation note: verify whether `bible_passages.id` is unique per
     translation; the `.eq('translation', …)` filter makes the read correct
     either way.)
  4. The `mode === 'insight'` retrieval-query chapter fetch
     (`index.ts:113-116`) is used only to build a semantic search string —
     embeddings are BSB-only by design — so it may stay BSB; filtering it is
     optional and does not affect displayed output.
  5. **Frontend:** the client caller of `lamplight-study` passes the active
     `translation` from `useBiblePrefs()` in the request body (parity with
     `LamplightChat`), so the body path is used when available and the profile
     read is the background/fallback.
  6. **Deploy:** `supabase functions deploy lamplight-study --use-api` (manual,
     post-merge — edge functions are not in CI).

- **`verse-search` — no edge-fn change.** It is a BSB reference finder; the
  frontend already re-resolves displayed text version-awarely (see §5). The
  returned `text` is a transient dropdown preview only.

### 5. Live re-flow of embedded verse references

**Decision:** embedded refs re-flow to the active version live. Implemented as
**display-time re-resolution**, not stored-content rewrite.

Today (`src/notepad/extensions/`): the `ScriptureRef` node freezes `text` +
`translation` onto the node at insert; `ScriptureRefView.tsx` only lazy-fetches
when `attrs.text` is empty and is keyed on `attrs.osis` (not translation); the
editor's verse-search deps bake the mount-time translation
(`use-note-editor.ts:69`) and the editor is deliberately not re-created on
preference change (preserves cursor/undo).

Changes:

1. **NodeView reads active version reactively.** `ScriptureRefView` /
   `ScriptureRefCard` is a React component rendered by `ReactNodeViewRenderer`
   within the app's React tree, so it can call `useBiblePrefs()` directly. It
   resolves its **display text for the active translation** at render and
   re-fetches (via the existing version-aware `fetchVerseText`, which filters
   `.eq('translation', …)`) whenever the active translation changes. Re-key the
   effect on `[attrs.osis, activeTranslation, online]` and resolve display text
   when `activeTranslation !== attrs.translation` (or `attrs.text` empty).
   - **Stored attrs stay** as the as-captured snapshot — used as the offline /
     unresolved fallback and for portability. We do **not** write back to node
     attrs on version change (that would spam undo history and dirty-save every
     note). The rendered text reflows; the stored pointer is unchanged.
   - A small per-`(osis, translation)` in-memory cache avoids redundant fetches
     when many cards share a version (optional but recommended).

2. **Insert-time stamping uses the active version.** Bridge the active
   translation into the editor via `editor.storage.scriptureRef.translation`,
   updated by an effect in `Editor.tsx` (which is under the provider) whenever
   `useBiblePrefs().translation` changes. ProseMirror insert commands read from
   storage so new inserts stamp the current version.

3. **Fix the hardcoded `'BSB'` bug.** `src/notepad/extensions/verse-picker-commands.ts:~25`
   hardcodes `translation: 'BSB'` on `/verse` book-picker inserts. Route it
   through the freeze helper `scriptureRefAttrsFromCandidate` (as the
   predictive/lookup paths do) / the storage-bridged active translation so every
   insert path is consistent.

4. **Editor mount translation** (`use-note-editor.ts`) is sourced from
   `useBiblePrefs()` (via `Editor.tsx`). Search/FTS deps still capture a value at
   mount, but display re-resolution (item 1) and the storage bridge (item 2)
   ensure the visible cards and new inserts follow the live active version.

> **Spec-review flag:** if the saved *bytes* of note content must also change
> (not just the rendered text), that is a larger change (mass attr rewrite +
> dirty-save semantics) — call it out and the design will be revised. Default
> here is display-time re-resolution.

### 6. Components & data flow (summary)

```
AuthProvider
└─ ThemeProvider
   └─ BiblePrefsProvider           ← useBibleTranslation({userId}) + useBibleVerseLayout({userId})  (single instance)
      ├─ ProfilePage               → "Bible & Reading" section (read/write via useBiblePrefs)
      ├─ BibleStudyPane → BibleReader (toolbar selector/layout, via props from useBiblePrefs)
      ├─ StudyReader               → useBiblePrefs (now persists)
      ├─ Editor → useNoteEditor    → ScriptureRef nodes
      │     • editor.storage.scriptureRef.translation bridge (insert-time)
      │     • ScriptureRefView reads useBiblePrefs → display-time re-resolution
      └─ LamplightChat / study     → request body carries active translation
                                     (server fallback: profiles.bible_translation)
```

`localStorage` (instant) ⇄ provider state ⇄ `profiles.bible_translation` /
`profiles.bible_verse_layout` (durable, cross-device).

## Error handling

- Profile read/write failures are non-fatal (existing hook behavior): the app
  falls back to localStorage / defaults; a failed `profiles.update` does not
  block the UI.
- `lamplight-study` translation resolution mirrors `lamplight-generate`: a
  profile-read failure falls through to `'BSB'`; **generation must never throw
  over a preference lookup.**
- Offline / unresolved verse text in a node falls back to the stored `attrs.text`
  snapshot.
- `useBiblePrefs()` throws if used outside `BiblePrefsProvider` (same guard as
  `useTheme()`), surfacing wiring mistakes at dev time.

## Testing

- **Unit:** `BiblePrefsProvider` provides values and propagates setters; the
  provider is the single instance (grep-guard / structural test).
- **Unit:** `useBibleTranslation` / `useBibleVerseLayout` persistence behavior
  unchanged (existing tests stay green).
- **Unit:** verse-picker insert stamps the **active** translation (not `'BSB'`).
- **Unit:** `study-context` `bible_passages` reads include `.eq('translation', …)`;
  `lamplight-study` resolves translation from body, else profile, else `'BSB'`.
- **Component/behavioral (where feasible):** changing the active version re-flows
  a rendered `ScriptureRef` card's text; toolbar and settings selectors stay in
  sync through the shared context.
- **Baseline discipline:** the repo ships a known red baseline (~114 lint, 4 tsc,
  2 failing test files unrelated to this work). Verify **zero new** errors via
  `tsc -b` (the real build check) + lint + targeted tests; do **not** gate on a
  green repo-wide baseline.

## Rollout

1. Implement frontend (provider, consumer migration, Profile section, ScriptureRef
   re-resolution + insert fix).
2. Implement `lamplight-study` translation-awareness + client body change.
3. Merge to `main`.
4. **Manual:** `supabase functions deploy lamplight-study --use-api`.
5. Manual smoke: sign in, set version + layout in Profile and in the reader
   toolbar (confirm they mirror); reload / re-login (confirm persistence);
   open a note with embedded refs and switch version (confirm live re-flow);
   run Lamplight chat **and** study (confirm citations are in the selected
   version).

## Files touched (anticipated)

**New**
- `src/notepad/bible/prefs/bible-prefs-context.ts`
- `src/notepad/bible/prefs/BiblePrefsProvider.tsx`
- tests under `src/notepad/bible/prefs/`

**Modified**
- `src/App.tsx` (mount provider)
- `src/auth/ProfilePage.tsx` ("Bible & Reading" section)
- `src/notepad/bible/BibleStudyPane.tsx`
- `src/notepad/study/panes/StudyReader.tsx`
- `src/notepad/components/Editor.tsx`
- `src/notepad/components/lamplight/chat/LamplightChat.tsx`
- `src/notepad/editor/use-note-editor.ts`
- `src/notepad/extensions/ScriptureRefView.tsx`
- `src/notepad/extensions/verse-picker-commands.ts`
- `src/notepad/bible/lamplight-chat-client.ts` (study caller passes translation, if not already)
- `supabase/functions/lamplight-study/index.ts`
- `supabase/functions/lamplight-study/study-context.ts`

**No migration. One manual edge-function deploy (`lamplight-study`).**
