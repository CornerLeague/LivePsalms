# Bible verse-layout toggle

**Date:** 2026-06-22
**Status:** Approved (design)
**Branch:** `feat/notepad-dark-mode` (current) — implementation may use a dedicated branch.

## Summary

Add a control to the Bible reader that lets the user cycle the verse text through
three layout modes for readability. The default is the current continuous-prose
layout, so existing behavior is unchanged until the user opts in. The preference
persists per-device (localStorage) and, for signed-in users, cross-device via a
new `profiles.bible_verse_layout` column — mirroring the existing translation and
theme preferences.

## Goals

- Three verse layouts, cycled by one compact control in the reader header.
- Default unchanged (`inline` = today's continuous prose).
- Preference persists per-device instantly and cross-device when signed in.
- No regression to verse highlighting, verse-tap selection, or verse scroll anchors.
- Works on every surface that renders the reader (no per-surface wiring).

## Non-goals

- Font-size / font-family / line-height controls (separate future feature).
- A settings panel or multi-control toolbar. One icon button only.
- Changing how verses are fetched or shaped.

## The three layout modes

| Mode | Value | Render | Intent |
|------|-------|--------|--------|
| Inline *(default)* | `inline` | Verses flow as continuous prose in one block, joined by spaces — **exactly today's output**. | Reading at length |
| Lines | `lines` | Each verse on its own line, tightly stacked (line break per verse, no extra inter-verse gap; line-height provides spacing). | Scanning verse-by-verse |
| Spaced | `spaced` | Each verse on its own line with a blank-line gap between verses. | Study / annotation |

## Architecture

The change follows the established **translation preference** pattern exactly. The
reader (`BibleReader`) stays presentational: it receives the current layout and a
change callback as props. Each host component owns the preference hook (so the
signed-in `userId` flows in where it's available), the same way `translation` /
`onTranslationChange` are threaded today.

### New module: `src/notepad/bible/bible-layout-types.ts`

Mirrors `theme-types.ts`.

```ts
export type VerseLayout = 'inline' | 'lines' | 'spaced';

export const VERSE_LAYOUTS: readonly VerseLayout[] = ['inline', 'lines', 'spaced'] as const;
export const DEFAULT_VERSE_LAYOUT: VerseLayout = 'inline';

export function isVerseLayout(value: unknown): value is VerseLayout {
  return value === 'inline' || value === 'lines' || value === 'spaced';
}

/** The next mode in the cycle: inline -> lines -> spaced -> inline. */
export function nextVerseLayout(current: VerseLayout): VerseLayout {
  const i = VERSE_LAYOUTS.indexOf(current);
  return VERSE_LAYOUTS[(i + 1) % VERSE_LAYOUTS.length];
}
```

### New hook: `src/notepad/bible/useBibleVerseLayout.ts`

A structural copy of `useBibleTranslation.ts`:

- `useState` initialized from `loadEnum(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS, DEFAULT_VERSE_LAYOUT)` — instant local default.
- On sign-in (`userId` set), hydrate from `profiles.bible_verse_layout` via `maybeSingle()`, guarded by `isVerseLayout`, and write the hydrated value back to localStorage.
- `setVerseLayout(layout)` writes `localStorage` (`saveEnum`) and, when signed in, `profiles.bible_verse_layout`.
- Signature mirrors translation: `useBibleVerseLayout({ userId = null } = {})`, so `StudyReader` can call it with no args.

```ts
export interface UseBibleVerseLayoutResult {
  verseLayout: VerseLayout;
  setVerseLayout: (layout: VerseLayout) => void;
}
```

### New storage key: `src/notepad/session/session-storage.ts`

Add `const KEY_BIBLE_VERSE_LAYOUT = 'psalms.bible.verseLayout';` and export it
alongside the other keys.

### Migration: `supabase/migrations/040_profiles_bible_verse_layout.sql`

Modeled on `039_profiles_theme.sql` (plain owner-writable column + check
constraint; not a privileged column, so the `021` protect-privileged-columns
trigger does not interfere).

```sql
-- 040_profiles_bible_verse_layout.sql
-- Per-user Bible verse layout (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
-- Modeled on theme (039): a plain owner-writable column guarded only by RLS.
alter table public.profiles
  add column bible_verse_layout text not null default 'inline';

alter table public.profiles
  add constraint profiles_bible_verse_layout_check
  check (bible_verse_layout in ('inline', 'lines', 'spaced'));
```

Applied via `supabase db push` (per the migration-apply workflow).

## UI: the cycle control

A single icon-only `<button>` added to the header control cluster in
`BibleReader.tsx` (the `<div className="flex items-center gap-1">` at line 169),
placed just before the translation `<select>` or immediately after the `Info`
icon — styled like the existing prev/next chevron buttons
(`p-1.5 rounded hover:bg-black/5 transition-colors`, icon `w-4 h-4`,
`color: var(--deep-umber)`).

- Clicking calls `onVerseLayoutChange(nextVerseLayout(verseLayout))` — cycles
  `inline → lines → spaced → inline`.
- The icon reflects the **current** mode. Recommended lucide icons (final choice
  may be adjusted during implementation for visual clarity):
  - `inline` → `WrapText` (flowing prose)
  - `lines` → `List` (verse per line)
  - `spaced` → `Rows3` (separated rows)
- `aria-label` and `title` describe the current mode and the action, e.g.
  `title="Verse layout: Spaced — click to change"`, `aria-label="Change verse layout (currently spaced)"`.

## Rendering change (`BibleReader.tsx`, lines 321–351)

`BibleReader` gains two props:

```ts
/** Current verse layout. */
verseLayout: VerseLayout;          // default 'inline' if a caller omits it
/** Called when the user cycles the layout control. */
onVerseLayoutChange: (layout: VerseLayout) => void;
```

The verse-body render branches on `verseLayout` while keeping each verse's
`<span>` content, `id`, `onClick`, highlight-style logic, and `<sup>` number
**identical** across all three modes — only the wrapper/display differs:

- **Container:** `inline` → `<p className="text-[13px] leading-[1.9]">` (today).
  `lines` / `spaced` → `<div className="text-[13px] leading-[1.9]">` (a `<p>`
  cannot legally contain block children).
- **Per verse:** compute the existing highlight/selected `baseStyle` object
  unchanged. When `verseLayout !== 'inline'`, merge layout additions into that
  style:
  - `lines`  → `{ display: 'block' }`
  - `spaced` → `{ display: 'block', marginBottom: '0.7em' }`
- **Join space:** keep the trailing `{' '}` inside the span only in `inline`
  mode; omit it in block modes.

Because the `id="bible-verse-N"` stays on the same `<span>` in every mode, the
search scroll-into-view (`getElementById(...).scrollIntoView`) and the highlight
picker anchoring (`getBoundingClientRect`) keep working untouched. A
`display:block` highlighted verse simply tints its full line, which reads
correctly in the block modes.

## Host wiring

Both hosts thread the new preference exactly as they already thread translation.

- **`src/notepad/bible/BibleStudyPane.tsx`** — already has `userId`. Add
  `const { verseLayout, setVerseLayout } = useBibleVerseLayout({ userId });` and
  pass `verseLayout={verseLayout} onVerseLayoutChange={setVerseLayout}` to
  `<BibleReader>`.
- **`src/notepad/study/panes/StudyReader.tsx`** — calls the hook with no args
  (`useBibleVerseLayout()`), matching its existing `useBibleTranslation()` call,
  and passes the two props through.

No other caller renders `BibleReader`, so these two edits cover every surface.

## Testing

- **Unit (`bible-layout-types`)**: `nextVerseLayout` cycles
  inline→lines→spaced→inline; `isVerseLayout` guards bad values.
- **Hook (`useBibleVerseLayout`)**: defaults from localStorage; hydrates from a
  mocked `profiles` row when `userId` is set; `setVerseLayout` dual-writes. Model
  on any existing `useBibleTranslation` test if present; otherwise a focused new test.
- **Render (`BibleReader`)**: with each `verseLayout` value, assert the verse
  `<span id="bible-verse-N">` still exists, `onClick`/`onSelectVerse` still fire,
  and the container/display differs (inline `<p>` inline spans vs block modes).
- **Regression**: verify against the known pre-existing red baseline — the change
  must add **zero** new lint/tsc/test failures (do not gate on a green repo).
- **Build check**: `tsc -b` (not bare `tsc --noEmit`).

## Rollout

1. Add migration `040`; apply with `supabase db push`.
2. Ship the frontend (types module, hook, storage key, `BibleReader` props +
   render branch, two host edits, control button).
3. Manual smoke: cycle all three modes in both the Study/Bible pane and the
   Study-mode reader; confirm highlight + verse-tap + search-scroll still work;
   confirm the preference survives refresh (localStorage) and, signed in,
   persists to `profiles`.
```
