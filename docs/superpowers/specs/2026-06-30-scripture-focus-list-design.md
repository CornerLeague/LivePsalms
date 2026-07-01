# Scripture Focus List — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm), ready for implementation plan
**Working title:** Scripture Focus List (surfaced in UI as **Focus**)
**Visual mockups:** `.superpowers/brainstorm/96117-1782835467/content/` (`placement.html`, `focus-mode.html`)

## Summary

A curated, ordered set of Bible verses a user can pull up and read as a clean,
distraction-free stack — built for following along in a church service while the
preacher walks through specific passages. The user types/pastes references,
searches, or taps verses while reading; the app shows **just those verses**, in
**the order the user chose**, in their current translation. Lists can be built
on the spot (a throwaway **Quick list**) or **saved and named** for reuse.

This lives inside the existing right-side **Bible pane** (the `BibleReader`),
behind a **`☰ Focus` toggle** in the header. Toggling on swaps the current
chapter for the active focus list. A compact **list switcher** lets the user move
between saved lists and the Quick list without leaving the pane.

## Goals

- Build an ordered list of verses fast, mid-service, on mobile.
- Read only those verses, full text, in reading order, in the active translation.
- Save/name lists and reuse them; also support a zero-friction unsaved Quick list.
- Reuse existing infrastructure (verse search, passage fetch, translation prefs,
  the highlights persistence pattern) rather than inventing parallel systems.

## Non-goals (YAGNI — explicitly out of v1)

- Per-verse personal notes attached to a focus item.
- Sharing, export, or print of a list.
- Mixing translations within a single list (a list renders in the *current*
  translation; switching translation re-renders the whole list).
- Collaborative/shared lists.
- Importing `scriptureRef` nodes from journal notes (deferred; was offered and
  parked by the user).

## Primary use case / stories

1. **In a service:** The preacher says "turn to Ephesians 2:8." The user opens
   Focus, taps `＋ Add`, types `Eph 2:8`, and it appears. They keep adding as the
   sermon goes, reading the growing stack in order.
2. **Prepared ahead:** Before church the user pastes `John 3:16, Ps 23:1-3, Eph
   2:8-9` into a new list named "Sunday AM," then just opens it during service.
3. **Reuse:** The user keeps "Comfort verses" and a "Romans series" list and
   switches between them with the switcher.

## UX design

### Entry point — `☰ Focus` toggle (Placement A + switcher)

- A new icon button in the `BibleReader` header button cluster
  (`src/notepad/bible/BibleReader.tsx`, the `<div className="flex items-center
  gap-1">` at ~line 179, beside the verse-layout toggle and translation select).
  Styled identically: `p-1.5 rounded hover:bg-black/5`, `var(--deep-umber)` icon,
  a lucide icon (proposed `ListOrdered`; final choice at implementation).
- **Off (default):** normal chapter browsing — unchanged.
- **On:** the reader body renders the **active focus list** instead of the
  chapter. The header shows a highlighted/active toggle state.

### Control row (visible only in Focus mode)

A thin bar under the header (the focus-list "toolbar"):

- **List switcher** — a compact dropdown (desktop) / bottom sheet (mobile)
  labeled with the active list name. Contents:
  - saved lists (checkmark on active),
  - a separator,
  - `⚡ Quick list (unsaved)`,
  - `＋ New list…`
  - For the Quick list, a `Save` action that prompts for a name and persists it.
- **`＋ Add`** — opens the Add panel (below).
- **`✎ Edit`** — toggles edit affordances (drag handles + remove). Off by default
  so reading stays clean.
- A muted verse count (e.g. "3 verses").

### Reading view

- Full verse text, stacked in the user's order, each row prefixed with its
  reference label (e.g. `EPHESIANS 2:8`), rendered in the **current translation**
  (BSB/KJV/WEB) from the existing translation preference.
- Ranges (`Ps 23:1–3`) render as one block with a range label.
- Edit mode reveals a drag handle (reorder) and `✕` (remove) per row.

### Adding verses (three methods, all v1)

The `＋ Add` panel is a small inline panel with two tabs, plus a passive third path:

1. **Type / paste** — a text field that parses one reference or a comma-/newline-
   separated batch with ranges (`John 3:16, Ps 23:1-3, Eph 2:8-9`). Parsed refs
   append to the active list; unparseable fragments are reported inline and
   skipped (the rest still add).
2. **Search** — reuses `verse-search-client.ts` (`ftsSearch` + `semanticSearch`);
   tapping a result adds it.
3. **Tap while reading** — when Focus is *off* (browsing) and a list is active, an
   "add to list" affordance appears per verse, dropping the current verse into the
   active list.

### Mobile

- Same `☰ Focus` toggle on the mobile **Bible** tab
  (`MobileNotepadWorkspace` / mobile bible view).
- The list switcher renders as a bottom sheet; the Add panel and reading view
  reuse the same components.

## Architecture

### New module: `src/notepad/bible/focus/`

| File | Purpose |
|------|---------|
| `focus-list-types.ts` | `ScriptureRef { book, chapter, verseStart, verseEnd, label }`, `FocusListItem extends ScriptureRef { id, position }`, `FocusList { id, title, position, items: FocusListItem[] }`. A `QUICK_LIST_ID` sentinel for the unsaved list. |
| `reference-parser.ts` | `parseReferences(input: string): { refs: ScriptureRef[]; unparsed: string[] }`. Tolerant: case-insensitive book names + common abbreviations, numbered books (`1 Cor`, `2 Tim`), `Ps/Psalm/Psalms`, single verse or `a-b` range, comma/newline batches. Builds its name→OSIS lookup from the existing book-metadata used by the book selector. |
| `supabase-focus-list-adapter.ts` | CRUD, mirroring `highlights/supabase-bible-highlight-adapter.ts`: `listLists()`, `createList(title, refs)`, `renameList(id, title)`, `deleteList(id)`, `addItems(listId, refs)`, `removeItem(itemId)`, `reorderItems(listId, orderedIds)`, `reorderLists(orderedIds)`. |
| `useScriptureFocusLists.ts` | Hook owning: loaded saved lists, `activeListId` (incl. `QUICK_LIST_ID`), `focusModeOn`, and the in-memory Quick list. Exposes mutators + a `saveQuickList(name)` that persists. Persists `focusModeOn`/`activeListId` to sessionStorage (same pattern as `KEY_EDITOR_TAB`). |
| `useFocusListVerseText.ts` | Given a list's items + current translation, fetches text from `bible_passages` (batched by book/chapter, `WHERE translation=? AND book=? AND chapter=? AND verse_start<=rangeEnd AND verse_end>=rangeStart ORDER BY verse_start`) and assembles display verses; flags items with no text in the current translation. |
| `FocusListView.tsx` | The reading/edit body — verse stack, edit-mode reorder + remove, empty state. |
| `FocusListSwitcher.tsx` | Dropdown (desktop) / bottom sheet (mobile) switcher. |
| `AddVersePanel.tsx` | Type/paste + Search tabs. |

### Modified files

- **`BibleReader.tsx`** — add the `☰ Focus` toggle to the header cluster; when
  focus mode is on, render `<FocusListView>` (with the control row) instead of the
  chapter; in browse mode with an active list, render the per-verse "add to list"
  affordance.
- **`BibleStudyPane.tsx`** — instantiate `useScriptureFocusLists`; branch the
  reader body between chapter and focus view; pass current translation down.
- **Mobile Bible view** (`MobileNotepadWorkspace.tsx` / its bible pane) — wire the
  same toggle + switcher-as-bottom-sheet.

### Data model — migration `042_scripture_focus_lists.sql`

Two owner-scoped tables (RLS owner-only, mirroring
`027_bible_highlights.sql`'s `user_id` FK + policies):

```sql
create table public.scripture_focus_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.scripture_focus_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.scripture_focus_lists(id) on delete cascade,
  book        text not null,        -- OSIS abbrev, e.g. 'eph'
  chapter     integer not null,
  verse_start integer not null,
  verse_end   integer not null,     -- = verse_start for a single verse
  label       text not null,        -- denormalized display ref, e.g. 'Ephesians 2:8'
  position    integer not null,
  created_at  timestamptz not null default now()
);

create index scripture_focus_lists_user on public.scripture_focus_lists (user_id, position);
create index scripture_focus_list_items_list on public.scripture_focus_list_items (list_id, position);
```

- RLS: `scripture_focus_lists` — owner via `user_id = auth.uid()`.
  `scripture_focus_list_items` — owner via
  `exists (select 1 from scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid())`
  on all of select/insert/update/delete.
- **Translation-agnostic storage:** items store the *reference* (book/chapter/verse
  range) + a denormalized `label`, never text. Text is fetched live per the active
  translation, so one list reads correctly in BSB, KJV, or WEB. The `label` lets the
  list header render even if a verse is missing in some translation.
- Match the exact `user_id` FK target and policy style of `027_bible_highlights.sql`
  (auth.users vs. profiles) rather than this snippet if they differ.
- Apply via `supabase db push` (history is in sync; only new migrations are pending).

### Anonymous users

The app supports signed-out usage. Signed-out: only the **Quick list** works,
held in sessionStorage so a refresh doesn't lose it; `Save`/named lists prompt
sign-in. Signed-in: full saved-list library.

## Data flow

1. `BibleStudyPane` mounts `useScriptureFocusLists` → loads saved lists (signed-in)
   via the adapter; restores `focusModeOn`/`activeListId` from sessionStorage.
2. Toggle on → `FocusListView` reads the active list's items and calls
   `useFocusListVerseText(items, translation)` to assemble display verses.
3. Add (any method) → append `ScriptureRef`s to the active list; if it's a saved
   list, persist via `addItems`; if Quick, mutate in-memory (+ sessionStorage).
4. Reorder/remove → optimistic local update, then adapter call; rollback + toast on
   failure (mirror the highlight adapter's behavior).
5. Translation change (existing pref flow) → `useFocusListVerseText` re-fetches; no
   list mutation.

## Error handling & edge cases

- **Unparseable references:** report which fragments failed, add the rest; never
  block the whole paste.
- **Verse missing in current translation:** show the reference label with a muted
  "not available in {translation}" note; switching translation re-fetches.
- **Active list deleted:** fall back to the Quick list (or first remaining saved
  list).
- **Empty list:** friendly empty state prompting to add a verse.
- **Save failure / offline:** optimistic update with rollback + toast.
- **Duplicates:** allowed (order matters; intentional repeats are harmless) — no
  dedupe in v1.

## Testing

- **`reference-parser`** — the highest-value unit tests: single refs, ranges,
  numbered books, `Ps/Psalm/Psalms`, abbreviations, case-insensitivity, comma +
  newline batches, and garbage-in → reported `unparsed`.
- **Adapter** — CRUD + ordering + RLS scoping, following existing adapter test
  patterns.
- **`useScriptureFocusLists`** — Quick-list lifecycle, `saveQuickList`,
  active-list fallback on delete, sessionStorage persistence.
- **`useFocusListVerseText`** — assembles ranges spanning multiple `bible_passages`
  rows; flags missing-in-translation items.
- **Components** — `FocusListView` (reorder, remove, empty state),
  `FocusListSwitcher`, `AddVersePanel` (parse + search add).
- Honor the repo's known-red baseline: add **zero new** lint/tsc/test errors; do
  not gate on a green repo-wide baseline. Typecheck with `tsc -b`.

## Open implementation choices (decide during plan/build)

- Exact lucide icon for the toggle (`ListOrdered` vs `BookMarked` vs `ListChecks`).
- Drag-reorder library vs. simple up/down controls on mobile — reuse whatever the
  notes/folders tree already uses if it's lightweight; otherwise up/down on mobile.
- Whether the per-verse "add to list" affordance is always shown in browse mode or
  only when a list is active (lean: only when a list is active).
