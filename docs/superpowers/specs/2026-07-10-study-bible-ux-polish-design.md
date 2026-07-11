# Study + Bible UX polish — design

**Date:** 2026-07-10
**Branch:** `feat/study-bible-ux-polish` (off `origin/main` @ `d31442d`, post-PR #82)
**PR strategy:** one PR for all four changes (grouped UX polish, mirrors #81/#82).

Four UX changes Nat requested immediately after PR #82 shipped. Changes 1–2 are mechanical,
3 is a one-line default flip, 4 is a behavioral fix + a small de-duplication.

---

## Change 1 — "Restore this stone" → labeled circle-icon button (presentational)

**Where:** `src/notepad/components/waymarks/WaymarksReflections.tsx`, the `.wm-hidden__list`
(currently ~164–179), plus `waymarks.css`.

**Now:** each hidden row is `<li class="wm-hidden__item wm-caption">{month} <button class="wm-linkbtn wm-label">Restore this stone.</button></li>`.

**After:** reuse the shipped `.wm-circle` pattern verbatim (same as `WaymarksPeriodDetail.tsx`
Save/Hide buttons):
- `<RotateCcw size={18} strokeWidth={1.5} />` inside `<span class="wm-circle__disc" aria-hidden>`,
- uppercase `<span class="wm-circle__label" aria-hidden>Restore</span>`,
- `aria-label="Restore this stone."` on the button — **exact text preserved** so the
  name-based restore test stays green.
- Month label moves to its own `<span class="wm-caption">` on the left.

**CSS:** add `.wm-hidden__item { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }`
so the month sits left and the circle button right. Reuses existing `.wm-circle*` rules — no new button CSS.

**Icon:** `RotateCcw` (reads as "restore/undo"). Import from `lucide-react`.

**Tests:** presentational — `WaymarksReflections.restore.test.tsx` stays green via the
preserved accessible name. No new test unless behavior changes (it doesn't).

---

## Change 2 — Reorder mobile Study sub-tabs so Reader is centered (mechanical, mobile-only)

**Where:** `src/notepad/study/mobile/StudyTabBar.tsx`, `TABS` array (10–14).

**Now:** `[reader, study, context]`. **After:** `[study, reader, context]`.

Bar renders only on mobile (`StudyWorkspace.tsx:203` gates `MobileStudyWorkspace` behind
`useIsMobile`). Desktop unaffected.

**Tests:** update `StudyTabBar.test.tsx` order expectations.

---

## Change 3 — Study top-tab lands on the Reader sub-tab, note preserved (mobile-only)

**Where:** `src/notepad/study/mobile/MobileStudyWorkspace.tsx:31–42`.

**Now:** `useState(() => loadEnum(KEY_MOBILE_STUDY_TAB, ['reader','study','context'], 'reader'))`
restores the last-used sub-tab from localStorage; a `useEffect` writes it back on every change.

**After:** `useState<MobileStudyTab>('reader')` — always land on Reader on entry. Remove the
now-dead save-effect and the unused `loadEnum` / `saveEnum` / `KEY_MOBILE_STUDY_TAB` imports.

**Note preservation:** the three panes stay mounted (they toggle via `display`), so the carried
journal note (StudySidePanel / active-note editor) is untouched — only the initially-shown
sub-tab changes. Decision: "Reader; note preserved."

**Tests:** update `MobileStudyWorkspace.test.tsx` — initial tab is `reader` even when `study`
is persisted in localStorage; Study pane still mounted (note preserved).

---

## Change 4 — Persist Study Reader's last book/chapter (behavioral; desktop + mobile)

**Root cause:** position persistence already exists as the device-global
`localStorage['psalms.bible.passage']` (`session-storage.ts`), and `BibleStudyPane.tsx` already
uses it. But the newer Study experience hardcodes John 1 and never saves:
- `MobileStudyWorkspace.tsx:34` — `useState({ book: 'jhn', chapter: 1 })`, `handlePassageChange`
  updates local state only.
- `DesktopStudyWorkspace` (`StudyWorkspace.tsx:46`) — same hardcode.

Sign-out does **not** clear localStorage (`auth-session.ts:173` only calls Supabase
`auth.signOut()`), so a persisted passage already survives sign-out/return.

**Decision:** reuse the existing device-global key (consistent with translation/layout prefs,
which are also device-global). No per-user namespacing, no server column.

**Refactor (de-dup):** extract the "stored passage if valid else John 1" rule — currently inline
in `BibleStudyPane.tsx:36–46` and about to be copied into two more hosts — into one pure helper:

```ts
// src/notepad/bible/initial-passage.ts
import { bookByAbbrev } from './bible-books';
import { loadBiblePassage, type StoredPassage } from '@/notepad/session/session-storage';

export const DEFAULT_PASSAGE: StoredPassage = { book: 'jhn', chapter: 1 };

/** The passage a reader should open on: the stored one if it's a real book with an
 *  in-range chapter, else John 1. One home for the validate-or-fallback rule. */
export function loadInitialPassage(): StoredPassage {
  const stored = loadBiblePassage();
  if (stored) {
    const meta = bookByAbbrev(stored.book);
    if (meta && stored.chapter >= 1 && stored.chapter <= meta.chapterCount) {
      return { book: stored.book, chapter: stored.chapter };
    }
  }
  return { ...DEFAULT_PASSAGE };
}
```

**Wiring:**
- `BibleStudyPane.tsx` — replace inline init with `useState<PassageRef>(loadInitialPassage)`.
  (Keeps its existing `saveBiblePassage` write-through.)
- `MobileStudyWorkspace.tsx` — `useState(loadInitialPassage)`; add `saveBiblePassage(ref)` inside
  `handlePassageChange` (guarded, mirrors BibleStudyPane).
- `DesktopStudyWorkspace` (`StudyWorkspace.tsx`) — same two edits.

`BibleReader` reads `initialBook`/`initialChapter` only at mount, so rehydrate-on-mount is what
fixes the John 1 landing; runtime navigation flows up through `onPassageChange` → save. This
matches the already-working `BibleStudyPane` architecture exactly.

**Tests (TDD):** new `initial-passage.test.tsx`:
- valid stored passage → returns it,
- nothing stored → John 1,
- stored book not a real abbrev → John 1,
- stored chapter out of range → John 1.

---

## Gates
`npx tsc -b` (exit 0) · scoped `npx vitest run <changed dirs>` · eslint on touched files.
Pre-existing & ignored: `garden-scene.test.tsx` failure; `formatLocalDate`
`react-refresh/only-export-components` lint warning.

## Non-goals / YAGNI
- No per-user or server persistence for Bible position (device-global localStorage only).
- No "remember last sub-tab" behavior for mobile Study (deliberately dropped for the Reader default).
- No redesign of the Hidden Stones layout beyond swapping the button style.
