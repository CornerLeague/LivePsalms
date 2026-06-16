# The Notepad — Complete Feature Documentation

> A thorough, end-to-end specification of LivePsalms' **Notepad** feature: every subsystem, data model, UI surface, and behavior, traced from the source at `src/notepad/` (plus its Supabase edge functions and landing copy).
>
> Source of truth: the codebase as of 2026-06-08. Where marketing copy promises something not yet built, this document says so explicitly.

---

## Table of Contents

1. [What the Notepad Is](#1-what-the-notepad-is)
2. [Routing, Composition & Screen Anatomy](#2-routing-composition--screen-anatomy)
3. [Core Data Model](#3-core-data-model)
4. [Collection, Storage, Sync & Migration](#4-collection-storage-sync--migration)
5. [The Editor (TipTap), Extensions & Toolbar](#5-the-editor-tiptap-extensions--toolbar)
6. [Decorations (Stickers & Embellishments)](#6-decorations-stickers--embellishments)
7. [Sidebar, Folders & Tags](#7-sidebar-folders--tags)
8. [Search & Note Info](#8-search--note-info)
9. [The Bible Reader & Study Pane](#9-the-bible-reader--study-pane)
10. [Lamplight — The AI Companion](#10-lamplight--the-ai-companion)
11. [The Living Graph (3D Reference Graph)](#11-the-living-graph-3d-reference-graph)
12. [Backlinks & Connection Cards](#12-backlinks--connection-cards)
13. [Paper Styles ("Seven Papers")](#13-paper-styles-seven-papers)
14. [Gamification — Tiers & Level-Ups](#14-gamification--tiers--level-ups)
15. [Scan / OCR & Document Import](#15-scan--ocr--document-import)
16. [Online/Offline & First-Load](#16-onlineoffline--first-load)
17. [Cross-Cutting Notes & Known Gaps](#17-cross-cutting-notes--known-gaps)

---

## 1. What the Notepad Is

The Notepad is a Scripture-centered, offline-capable journaling environment. Its core promise (landing copy): *"The notepad that remembers what God has been saying — across your devotions, your sermons, the threads you've been walking with for months."*

It is built around three ideas:
- **Three voices, one place.** Every note is typed as a **Devotion**, **Sermon**, or **Theme**, but they all live together and thread to each other by what they share (a verse, a word, a link).
- **Scripture is first-class.** Typed verse references become interactive (hover for text), feed a 3D reference graph, and ground an AI companion.
- **The app reads you back.** "Lamplight" (the AI layer) reads your own notes and gives back a daily devotion, with strong privacy guarantees.

Two persistence modes: **anonymous/local** (works fully offline, no account) and **signed-in/cloud** (Supabase-synced), with a one-time migration between them.

---

## 2. Routing, Composition & Screen Anatomy

### 2.1 Routes (`src/App.tsx`)

| Route | Element | Role |
|---|---|---|
| `/notepad` | `NotepadLanding` | Marketing landing page (the scroll experience transcribed separately). Not the editor. |
| `/notepad/notes` | `LegacyNotepadRoute` | Legacy entry + funnel target. Anonymous users get the **local-mode editor** here; signed-in users are redirected to their vanity URL. |
| `/notepad/u/:username` | `VanityNotepadRoute` | Canonical signed-in editor URL, keyed on the user's username. **Private/owner-only** today. |

**Gate-driven rendering** (`useUsernameGate()` → `loading | signed-out | needs-username | ready`):
- `/notepad/notes`: `signed-out` → `<Notepad/>` (local mode); `needs-username` → username picker; `ready` → redirect to `/notepad/u/:username`.
- `/notepad/u/:username`: `signed-out` → redirect to `/notepad/notes`; `ready` → ownership check (`normalizeUsername(param) === gate.username`), else redirect to your own. **You can never load another user's editor.**

The editor routes unmount the global header/dock and footer (`isNotepadEditor`), taking over the full viewport.

### 2.2 NotepadProvider — the wiring (`context/NotepadProvider.tsx`)

Mounts four nested contexts, constructing the domain object graph once around the active adapter:
- **`ReferenceGraphContext`** → `new ReferenceGraph(fetchVerseText, localStorage)`
- **`NoteCollectionContext`** → `new NoteCollection(adapter)`
- **`FolderHierarchyContext`** → `new FolderHierarchy(adapter)`
- **`NotepadActionsContext`** → `new NotepadActions(adapter, notes, folders, referenceGraph)` (cross-module coordinator)

A load-bearing `useEffect` calls `actions.init()` on first load, or `actions.rebindAdapter(adapterProp)` when the adapter changes (sign in/out switches local↔Supabase). Defaults to the `localAdapter` singleton, so it works anonymously out of the box.

### 2.3 Desktop screen anatomy (`DesktopNotepadWorkspace`)

Full-viewport flex column:

**(a) Top toolbar** (48px, frosted): back-to-home, logo, `Search notes… ⌘K` button, **NEW NOTE** dropdown (Devotion/Sermon/Theme), **Upload** button, **graph toggle**, and the **auth area** (signed-in: `TierBadge` + avatar dropdown [Profile / Sign Out]; anonymous: **SIGN IN**).

**(b) Offline banner** (conditional): amber strip *"You're offline — viewing cached notes"* — only when offline **and** signed-in.

**(c) Three-column body:**
1. **Left sidebar (COLLECTION)** — width animates 220px ↔ 48px (`sidebarOpen`). Note/folder tree.
2. **Center editor pane (`<main>`)** — tab bar: **Content / Backlinks / Info / 🕯 Lamplight**. Content tab hosts the TipTap editor; below it (signed-in + Supabase only) a **Connection Cards strip**.
3. **Right Study Window** (`<aside>`, hidden below `md`) — width `0 → 35% → 100%` (graph toggle + expand). Internally tabbed: **BIBLE** (reader + Lamplight chat) and **GRAPH** (the living graph).

**(d) Decoration tray** — editor-local, toggled by the **Decorate** button.

**(e) Global dialogs** — `SearchDialog` (⌘K palette) and `MigrationDialog`.

| Region | State | Behavior |
|---|---|---|
| Sidebar | `sidebarOpen` | width 220↔48 |
| Editor tabs | `activeTab` | swaps center body |
| Study window open | `graphOpen` | aside 0↔35% |
| Study window expand | `graphExpanded` | aside → 100%, editor collapses |
| Study window tab | `tab: bible\|graph` | reader vs graph |
| Decoration tray | `trayOpen` | sticker overlay |

All panel state is local component state — there is no global layout store.

### 2.4 Mobile (`MobileNotepadWorkspace`)

A different shell: full-screen column with a **bottom `MobileTabBar`** — **notes / editor / lamplight / more**. The "more" sheet hosts the Bible study view. Auth via `MobileAuthModal`/`MobileAccountSheet`. Adds a scan-to-note flow. Same offline banner, search, and migration dialog.

### 2.5 End-to-end journey

Discover (`/notepad`) → CTA *"Open your notepad →"* → gate resolves (`/notepad/notes`) → (anonymous: editor opens in local mode; signed-in: username picker or redirect to vanity URL) → first-load migration prompt if applicable → **NEW NOTE** or open from sidebar → write in the Content tab → use Search (⌘K), Study Window (Bible/Graph), Backlinks/Info, Lamplight, Connection Cards, Upload/Scan → tier rewards → sign out returns to `/notepad` + local storage.

---

## 3. Core Data Model

All domain types: `src/notepad/types.ts`. App model is camelCase; Supabase rows are snake_case, mapped at the adapter boundary.

### 3.1 `NoteType`
```ts
type NoteType = 'devotion' | 'sermon' | 'theme';
```
Presentation (`note-type-config.ts`):

| Type | Icon | Color | Label |
|------|------|-------|-------|
| `devotion` | `PenLine` | `#6B8B7A` (sage) | Devotion |
| `sermon` | `Mic` | `#7A9BAE` (slate blue) | Sermon |
| `theme` | `Sparkles` | `#D4A0A0` (dusty rose) | Theme |

DB default `'devotion'`; CHECK constraint enforces the three values. Fixed display order: `devotion, sermon, theme`.

### 3.2 `Note`
```ts
interface Note {
  id: string;
  title: string;            // default 'Untitled'
  content: string;          // TipTap JSON, stringified ('' when empty)
  folderId: string;         // a folder id, or the sentinel 'root'
  type: NoteType;
  tags: string[];           // default []
  decorations?: NoteDecoration[];
  wordCount: number;        // derived from content
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601 (bumped on every update)
}
```
Key detail: the app model uses `'root'` as the sentinel for top-level notes; the DB stores `null`. Adapters translate (`folderId === 'root' ? null : folderId` on write; `folder_id ?? 'root'` on read).

### 3.3 `NoteDecoration` (free-canvas stickers)
```ts
interface NoteDecoration {
  id: string;          // local uuid
  assetId: string;     // manifest id
  xPct: number;        // 0..1, left position normalized to content width
  yPx: number;         // vertical px from top of content
  widthPct: number;    // 0..1, width normalized to content width
  rotation: number;    // degrees
  z: number;           // stacking order
  behindText?: boolean;// true → render behind text (default: in front)
  flipH?: boolean;
  flipV?: boolean;
}
```
Stored as a `jsonb` array (default `'[]'`).

### 3.4 `Folder` & `FolderIcon`
```ts
type FolderIcon = 'heart'|'star'|'cross'|'flame'|'dove'|'crown'
                | 'book'|'music'|'sun'|'shield'|'lamp'|'wheat';
interface Folder {
  id: string;
  name: string;
  parentId: string | null;  // null = top level
  order: number;            // sibling sort order (append on create)
  icon?: FolderIcon;        // 12 themed glyphs
  color?: string;           // hex
}
```
A strict tree (not a graph). Note the asymmetry: folders use `null` for top-level; notes use the `'root'` string.

**There are no default/seeded folders or notes.** A brand-new user (anonymous or fresh account) starts with `notes: []` and `folders: []`. Empty state is handled at the view layer only.

---

## 4. Collection, Storage, Sync & Migration

### 4.1 NoteCollection (`collection/note-collection.ts`)

Canonical in-memory owner of all notes + active selection. State: `{ notes, activeNoteId, activeNote }` (`activeNote` is derived, recomputed after every mutation). Reactivity is a hand-rolled `Observable` (`observable.ts`): `setState` bails on referential equality, else notifies all listeners synchronously. React binds via `useSyncExternalStore`.

**Operations:** `init`, `openNote(id)` (selection only), `createNote(folderId, type)` (creates `Untitled`/empty and sets active), `updateNote(id, updates)` (targeted patch from adapter's return), `deleteNote(id)` (resets selection if active was deleted), `renameNote`, `moveNote`, `duplicateNote`, `applyReparenting` (in-memory only), `refetchAll`, `rebindAdapter`.

**Ordering:** the collection doesn't sort. Supabase returns `created_at DESC`; local/fake return insertion order; the sidebar groups for display.

**Word counts:** `countWordsFromTipTapJSON` (`utils/tiptap-text.ts`) — parses JSON, extracts plain text (block nodes joined by `\n\n`, inline by space), splits on `/\s+/`. **Real adapters recompute `wordCount` on every content write.** Gamification counts only notes with `word_count >= 20`.

### 4.2 FolderHierarchy (`collection/folder-hierarchy.ts`)

In-memory folder tree (`Observable`). `createFolder(name, parentId, icon?, color?)` computes `order` as the count of existing siblings (append). Knows nothing about notes. **Orphan rule:** a note whose `folderId` is `'root'` or points at a missing folder renders as a root note — deleting a folder never drops its notes.

### 4.3 NotepadActions (`collection/notepad-actions.ts`)

The stateless coordinator that owns cross-module sequencing:
- **`init()`** — parallel `NoteCollection.init()` + `FolderHierarchy.init()`, then `ReferenceGraph.repairNoteLinks` (orphan-by-title rewiring, persisted), then `ReferenceGraph.init`.
- **`updateNote`** — delegates; **only if `content` changed** does it `ReferenceGraph.syncNote`.
- **`deleteNote`** — delete + `ReferenceGraph.deleteReferencesFor`.
- **`deleteFolder`** — re-parents affected notes to root (adapter + in-memory mirror).
- **`importNotes`** — id-preserving bulk import + `refetchAll` + `ReferenceGraph.syncAll`.
- **`rebindAdapter`** — cascades to all modules + re-init.

Single-note create/duplicate/rename/move/open go directly to `NoteCollection`; only multi-module ops route through `NotepadActions`.

### 4.4 Storage adapters (`storage/`)

The `StorageAdapter` interface is the persistence seam. `importNote`/`importFolder` preserve ids/timestamps so cross-link `noteLink` marks survive a move.

- **`LocalStorageAdapter`** (anonymous/offline) — `localStorage` keys `notepad_notes`, `notepad_folders`. New ids via `uuidv4`; recomputes word counts; `deleteFolder` re-parents notes to `'root'`; `duplicateNote` → `"<title> (copy)"`; `clearAll()` for migration. Exported as the singleton `localAdapter`.
- **`SupabaseStorageAdapter`** (synced) — Postgres tables `notes`/`folders`, scoped by RLS to the authed user. snake_case↔camelCase mapping; `'root'`↔`null` translation here. `deleteFolder` runs `UPDATE notes SET folder_id = null` then deletes.
- **`FakeStorageAdapter`** (tests) — in-memory, sequential ids; does **not** recompute word counts.

**Switching:** the active adapter is derived from `AuthSession` — no user → `localAdapter`; signed in → `SupabaseStorageAdapter` memoized on `user.id`; sign out → back to local. `NotepadProvider` rebinds the whole feature when the adapter changes.

### 4.5 Migration (anonymous local → account)

Three layers: pure copy (`migration.ts`), workflow (`migration-workflow.ts`), UI (`MigrationDialog.tsx`).

- **`migrateAdapter(source, target)`** — reads all folders+notes, imports **folders first** then notes (id/timestamp-preserving so cross-links survive). Pure copy — does not mutate the source. Conflict model is additive upsert-by-id; a brand-new account has nothing to conflict with.
- **`MigrationWorkflow`** — 7-state machine `idle → loading → folders → notes → cleanup → done` (with a 1400ms celebratory pause) / `error`. `clearSource()` (drops local copy) runs **only on success**, before `done`. On failure: *"Something went wrong importing your notes. Your local copy was left untouched."*
- **`MigrationDialog`** copy: intro *"Import Local Notes?"* / *"You have {N} {note|notes} saved locally…"* with **No Thanks** / **Import Notes**; progress phases (*"Reading your local notes…"*, *"Importing note {c} of {t}…"*, *"Almost done — tidying up…"*, *"All set. Your notes are now in your account."*); error panel with **Close** / **Try again**. Cannot be dismissed mid-migration.

### 4.6 Sync semantics

- **Anonymous = fully offline.** All CRUD is synchronous `localStorage`.
- **Signed-in writes are direct, awaited Supabase round-trips.** There is **no offline write queue, no optimistic-reconcile, no CRDT**. On failure the mutator throws. The in-memory state is patched from the adapter's return value (persisted truth, not a guess).
- **Cross-device "sync"** = all reads/writes hit the same RLS-scoped tables; the server is the single source of truth. There is **no continuous two-way local↔cloud sync** — the boundary is the one-time migration. After migration the local store is empty; signing out reverts to the (empty) local adapter — cloud notes are not mirrored back down.
- **Server guarantees:** RLS on both tables (`auth.uid() = user_id`); FKs `ON DELETE SET NULL` (orphan-to-root) and `ON DELETE CASCADE` from profiles; `updated_at` trigger; note-count trigger counting `word_count >= 20`.

---

## 5. The Editor (TipTap), Extensions & Toolbar

### 5.1 Editor stack (`components/Editor.tsx`, `editor/use-note-editor.ts`)

TipTap via `useEditor`. Extensions: `StarterKit`, `Placeholder` (*"Start writing..."*), `Underline`, `BibleVerse`, `NoteLink`, `TagMark`, `StyleHighlight`.

- **Content** is TipTap JSON, stringified. Loaded with `setContent(parsed, { emitUpdate: false })` (no save loop); active-note swap watches **`activeNote?.id` only** so the editor never reloads over in-flight edits.
- **Marks/nodes exercised:** bold, italic, strike, inline code, underline, custom `styleHighlight`; headings 1–3, paragraph, bullet/ordered lists, blockquote, codeBlock (in schema, no button); undo/redo.
- **Shortcuts:** StarterKit defaults (Mod-B/I…), **Mod-Shift-h** (toggle highlight), **`[[`** (note-link popup).

### 5.2 Formatting toolbar (in `Editor.tsx`)

40px bar, `toolbarPlacement: 'top' | 'bottom'` (bottom = mobile, sticky above keyboard). Buttons in order: **Undo, Redo** | **Heading dropdown** (H1/H2/H3 + Paragraph), **Bullet List, Ordered List, Blockquote** | **Bold, Italic, Strikethrough, Inline Code, Underline** | **Decorate** (Sparkles, toggles the tray). No dedicated highlight button — highlights apply via the auto-popover on selection.

### 5.3 Page toolbar (`NotepadToolbar.tsx`)

Back, logo, `Search notes… ⌘K`, **NEW NOTE** dropdown (Devotion/Sermon/Theme → `createNote('root', type)`), **Upload**, **graph toggle**, auth area (TierBadge + avatar [Profile / Sign Out] or **SIGN IN**). Mounts `UploadModal` and `LevelUpModal`.

### 5.4 Custom extensions (`extensions/`)

| Extension | What it does |
|---|---|
| **`BibleVerse`** (`bibleVerse`) | Scripture references become interactive. A ProseMirror **decoration plugin** live-highlights matches (`VERSE_REGEX`) as you type (italic + amber underline, `data-reference`); a **paste rule** bakes real marks on paste. Hover → verse tooltip. |
| **`NoteLink`** (`noteLink`) | Wiki-style links between notes (`data-note-id`, `data-note-title`, blue underline). Click → `collection.openNote(noteId)`. These become **explicit edges** (weight 1.0) in the reference graph. |
| **`StyleHighlight`** (`styleHighlight`) | Image-textured highlight swatches (not flat colors). `swatchId` attribute → background image via `getStyleAsset`, with `box-decoration-break: clone` for multi-line. Commands set/unset/toggle; remembers `lastSwatchId`. |
| **`TagMark`** (`tagMark`) | Hashtags. Live decoration plugin highlights `#word` as a soft stone pill; paste rule bakes marks. Regex source `#\\w+` is the single source of truth (`utils/tags.ts`). |

Important: BibleVerse and TagMark highlight **typed** text via inline decorations (recomputed on `docChanged`), not stored marks — only **pasted** refs/tags become real marks. The graph re-derives verses from plain text.

### 5.5 Verse tooltip (`editor/use-verse-tooltip.ts`)

Hover a `[data-bible-verse]` → tooltip with verse text + translation. Cache-first (`ReferenceGraph.getScriptureNode`, no write on miss), network fallback `fetchVerseText` (race-fenced with `AbortController`). Resolves from the Supabase `bible_passages` table (BSB). On mobile, a tap shows/clears it.

### 5.6 Note-link popup (`editor/use-note-link-popup.ts`)

Typing **`[[`** opens a 260px autocomplete: search input (case-insensitive title match, excludes the active note, capped at 10). Enter inserts the first match; click inserts via `insertNoteLinkAt`. Empty: *"No notes found"*.

### 5.7 Autosave & word count

- **Content + tags** autosave on every change, **500ms debounced** → `updateNote(id, { content, tags })`. `onAfterSave` notifies the Lamplight embedding layer.
- **Title** saves immediately (not debounced).
- **Decorations** autosave independently (also 500ms debounced).
- The editor save path writes only `content` + `tags`; **`wordCount` is computed on demand** (in `InfoPanel`), not kept current by editing.
- **Tags:** `extractTags(editor.getText())` parses `#word` → stored bare (no `#`); `formatTag` re-adds `#` for display. Verse-reference tags and hashtags currently share `note.tags`.

---

## 6. Decorations (Stickers & Embellishments)

A free-canvas layer for placing decorative image assets on a note (`decorations/`).

- **Tray** (`DecorationTray.tsx`) — opened by **Decorate**. Search + category pills (**All, Shapes, Arrows, Bubbles, Squiggles, Lines** — highlights excluded), thumbnail strip. Click places at default `{ xPct: 0.4, yPx: 80, widthPct: 0.25, rotation: 0 }`.
- **Geometry** (`decoration-geometry.ts`) — horizontal position/width are fractions of content width (responsive); vertical is absolute px. Move, resize (clamped `0.03–1.0` width), rotate (angle-based handle), and two-finger pinch (resize+rotate). `TEXT_Z = 100000`; behind-text decorations render below text, in-front above; `isolation: isolate` makes one stacking context.
- **Width freezing** (`DecorationLayer.tsx`) — reference width is snapshotted once on note open and frozen, so window resizing never moves decorations. Layer is keyed by `activeNote.id`.
- **Behind-text selection** — Alt-click or double-click over a behind-text decoration to select it.
- **Item interactions** (`DecorationItem.tsx`) — drag, resize handle, rotate handle, and an action bar: rotate ±15°, flip H/V, **bring to front**, **send to back**, **duplicate**, **delete**. Keyboard: arrows move (Shift = 10px), Delete removes, Escape deselects. "Send to back"/"bring to front" also toggle `behindText` (cross the text boundary).
- **Persistence** (`useDecorations.ts`) — 500ms debounced `updateNote(id, { decorations })`, flushed synchronously on note switch and unmount.
- **Asset manifest** (`styles/manifest.ts`, auto-generated) — `{ id, category, thumbUrl, displayUrl, aspectRatio }`, WebP assets under `/styles/<category>/`. ~413 assets total (see §13.2).

---

## 7. Sidebar, Folders & Tags

### 7.1 Sidebar (`components/Sidebar.tsx`)

Top to bottom: **COLLECTION** header; active tag-filter pill; **Filter notes...** input; **root notes grouped by type** (collapsible Devotion/Sermon/Theme groups with counts); **root folders** (recursive `FolderItem`); **+ New Folder**; **TAGS (n)** section (collapsible; click a tag to pivot, click active to clear).

Tree data is prepared by the pure `buildFolderTreeView(notes, folders, filterText, tagFilter)` → `{ rootFolders, rootNotesByType, notesByFolder, childFoldersByParent, allTags }`. Orphan notes render at root; empty type buckets are dropped; `allTags` is computed from all notes (so the active pivot never vanishes).

Expand/collapse state (`tree-view-state.tsx`) is a sparse override record persisted to `localStorage` (`notepad_tree_view_overrides`), fully defensive against malformed data.

### 7.2 Folder & note rows

- **`FolderItem`** — chevron, options/context menu (**Rename, New Note Inside, New Subfolder, Delete**), icon + inline-editable name, recursive children. Delete confirm: *"…Notes inside will be moved to root."*
- **`NoteItem`** — active row highlighted; menu (**Rename, Move to Folder, Duplicate, Delete**). Delete confirm: *"…This action cannot be undone."*
- **`InlineEdit`** — Enter commits (if changed), Escape cancels, blur commits.
- **`useDeferredMenuAction`** — fixes two Radix races: defers dialog-opening actions to `onCloseAutoFocus`, and a 500ms "ghost click" guard.
- **Move-to-folder**, **New-note** (type select), **New-folder** dialogs.

**New-folder dialog** has a live preview, name, location, **12 icons** (`heart, star, cross, flame, dove, crown, book, music, sun, shield, lamp, wheat`; default `book`) and **6 colors** (`#C49A78` Terracotta [default], `#6B8B7A` Sage, `#D4A0A0` Dusty Rose, `#8B7355` Umber, `#B8A590` Sand, `#7A9BAE` Steel Blue).

> **No drag-to-reorder.** Reordering is not a feature; folder `order` is assigned only at creation (append). Moving notes is dialog-driven.

---

## 8. Search & Note Info

### 8.1 Search (`SearchDialog.tsx`, `search-index.ts`)

A **cmdk** command palette, toggled by **⌘K / Ctrl+K** (the toolbar search button dispatches a synthetic ⌘K). Placeholder *"Search notes, verses, tags..."*. Three groups:
- **Notes** — all notes (cmdk substring match on `note-{id}-{title}`).
- **Verses** — deduped verse refs parsed from note content (first-occurrence-wins).
- **Tags** — deduped tags.

Each result navigates via `openNote(...)`. It is not a full-text body search beyond cmdk's substring matching on indexed values.

### 8.2 Note Info (`InfoPanel.tsx`)

Per-note stats table: **Type, Folder, Words** (whitespace count), **Bible References** (verse-regex count), **Outgoing Links** (`"noteLink"` occurrences), **Incoming Links** (title-substring heuristic), **Created / Last Updated**.

---

## 9. The Bible Reader & Study Pane

Lives under `src/notepad/bible/`, powering the **BIBLE** tab of the right-hand Study Window.

### 9.1 The reader (`BibleReader.tsx`)

- Defaults to John 1 (`initialBook='jhn'`, `initialChapter=1`).
- Body: verses in a justified serif `<p>`; each verse a `<span id="bible-verse-N">` with a superscript number; tap to highlight (`rgba(196,154,120,0.22)`).
- Header: `{Book} {chapter}` with a `▾` caret + prev/next chapter chevrons (disabled at bounds).
- States: *"Loading passage…"*, error in red, *"No text found for this chapter."*

### 9.2 Book picker & search (`book-search.ts`)

- Search input *"Search a book or verse…"*. Enter on a parsed ref (e.g. "John 3:16") jumps and scrolls to the verse; otherwise drills into the first book match.
- Matches split into **Old Testament** / **New Testament**. Chapter-grid mode shows an 8-column grid.
- `resolveBook` prefers exact-name match (so "John 3" never resolves to "1 John"), then lenient prefix.

### 9.3 Bible data (`bible-books.ts`)

- **Translation: Berean Standard Bible (BSB).** 66 books in canonical order, lowercase OSIS-style abbrevs (`gen`, `psa`, `jhn`, `rev`). (Quirk: Psalms is stored as singular `Psalm`/`psa`.)
- Verses come from the Supabase **`bible_passages`** table (`useBiblePassages` → `.like('id', '{book}.{chapter}.%')`, ordered by `verse_start`). **No client cache** — every chapter change refetches. Table is public-readable (RLS `using(true)`).

### 9.4 Split-pane study view (`BibleStudyPane.tsx`)

A vertical split: reader on top, **Lamplight Chat** below (toggled by a "Lamplight Chat" pill). The resize handle (`useDragResize`) constrains the chat pane to **20%–80%** of height, persisted to `localStorage` (`lamplight-chat-split-fraction`); double-click resets to 50/50. Dragging up grows the chat.

Chat pane gating: no user → `SignInGate`; loading → *"Loading…"*; no chat entitlement → `PaywallCard`; else `LamplightChat`. Navigating chapters in the reader re-targets Lamplight to the open passage (deduped to avoid render loops).

### 9.5 Lamplight Chat (study companion)

Backed by the `lamplight-chat` edge function (see §10.7). Three views: **live** conversation, **history** list, read-only **archived thread**. Empty thread → *"Reflect on this passage"* CTA (*"Lamplight draws on your own notes."*) firing a one-shot grounded **insight**. Input *"Ask about this passage…"*; in-flight *"Lamplight is reflecting…"*; error *"Couldn't reach Lamplight (…). Try again."* Citation chips resolve note ids to titles and humanize verse refs ("jhn 10:11" → "John 10:11").

Thread/message hooks (`useChatThread`, `useChatThreadList`, `useThreadMessages`) are Supabase-backed (`lamplight_chat_threads`, `lamplight_chat_messages`), keyed by passage + user, with cancellation guards.

### 9.6 How note references connect to the reader

There is **no click-a-note-reference → open-in-reader** wiring. Notes and scripture meet in two places: the **editor verse tooltip** (hover, via `fetchVerseText`) and the **graph** (typed refs become `ScriptureNode`s). The reverse direction works: navigating the reader re-targets the chat, which then pulls in semantically-related notes as citations. Reader (`useBiblePassages`) and note refs (`fetchVerseText`) read the same BSB store via independent code paths.

---

## 10. Lamplight — The AI Companion

> **Implementation status:** Of the three marketed artifacts, **only Today's Lamp (`daily_devotion`) is built.** "What God seems to be saying" (weekly) and "Seasonal Reflections" exist only as marketing copy + reserved DB enum slots + reserved entitlement flags. No pipeline exists for them yet.

### 10.1 Identity & voice (`_shared/voice.ts`)

> *"You are Lamplight, a scripture-grounded reflective companion inside a Christian journaling app. You read what the user has written and what Scripture says, and you bring the two into conversation."*

**How it speaks:** anchors to Scripture and cites every reference; offers interpretation as possibility ("this passage may speak to…"); chooses the divine name fitting the writing ("Lord," "Father," "Abba," "Jesus"); frames within creedal orthodoxy without assuming a denomination; warm, brief, concrete.

**What it never does:** never speaks prophetically or claims God is speaking through it; never interprets contested passages beyond plain reading (points to a pastor); never condemns the writer; never gives pastoral/mental-health/financial/medical counsel; **never produces streak/"don't miss a day"/effort-shaming language** ("Growth in this app is measured by Scripture, not consistency").

**Marketing (landing):** H2 *"A companion who's been reading along."* / *"Lamplight is not a chatbot. It is the long quiet finally given a voice…"* / trust line *"Off until you invite it. Private by default. Never trains on your notes. Always cited. One click to quiet."*

**In-app copy (`lamplight-copy.ts`, name-personalized):** intro / loading (*"Today's Lamp is on its way…"*) / empty (*"write a few more notes this week…"*) / failure (*"we couldn't generate Today's Lamp — try again?"*).

### 10.2 The three artifacts

DB enum reserves `daily_devotion | weekly_insight | reflection_recap | tier_celebration`.

- **(a) Today's Lamp — `daily_devotion` (BUILT).** A daily card. Shape: `opening`, `scripture {ref, text}`, `reflection`, `prompt`, `note_citations [{note_id, reason}]`. **Idempotent on `(user_id, 'daily_devotion', local_date)`** — one per user per local day. Model: Sonnet (2048 tokens), prompt `daily-devotion-2026-05-28-v2`.
- **(b) "What God seems to be saying" — `weekly_insight` (NOT BUILT).** Weekly synthesis. Entitlement flag `weekly` reserved (lite+plus); a `weekly_email` setting exists. No pipeline.
- **(c) Seasonal Reflections — `reflection_recap` (NOT BUILT).** Entitlement flag `reflections` reserved (plus). No pipeline.

### 10.3 Generation lifecycle (`supabase/functions/`)

Entry: `lamplight-generate`, dispatching on `kind`. Two seams:
- **`GenerationLifecycle` (`runGeneration`)** — the billable envelope: quota gate (429 on fail), single-site usage recording (skipped on cache hits), error classification + rethrow. Returns data, not side effects.
- **`GenerateWithRetry`** — generate → validate → retry once (default `maxAttempts: 2`), threading prior violations into a stricter retry. Bakes in the system voice fragment.

**Daily-devotion flow:** idempotency pre-check (return cached) → context build (≤3 recent notes sliced to 800 chars, profile name, theme query → Voyage embed → `searchBible` for 3 passages, optional rerank) → generate+validate (Sonnet) → persist; race on unique constraint re-reads but **records real usage** (it spent tokens). Validators enforce citation grounding, banned prophetic/contested/streak phrases, and name rules.

**Client flow (`useTodaysLamp.ts`):** states `idle | loading(step 0/1/2) | ready | error(no_notes | validators_failed | network)`. Loading steps cycle every 2500ms: *"Reading your recent notes…"* → *"Searching Scripture…"* → personalized.

**Embeddings (`useLamplightEmbeddingTrigger` + `embed-note`):** after a save, compute a SHA-256 content hash and `enqueueEmbedding(noteId, hash)`. The enqueue RPC **no-ops** when opted out, when the hash is unchanged, or when a job already exists. Jobs run via Voyage; a `pg_cron` sweep retries failures (exponential backoff, 3 attempts). The content hash is the regeneration-avoidance mechanism.

**Audit (`lamplight_usage`):** fire-and-forget per attempt `{ user_id, model, artifact_kind, tokens_in/out, status, error_code? }`; `model` nullable (null → $0 in the cost map).

### 10.4 Privacy & consent

Gating (`LamplightTabPanel.tsx`):
1. No user → **`SignInGate`** (*"Today's Lamp is waiting for you." / "Sign in to begin."* / *"Why sign in?"* → privacy page).
2. Loading → *"Loading…"*.
3. First visit (`settings === null`) → **`ConsentCard`**: *"Welcome the lamp."* / *"A quiet companion… It reads only your notes, cites every verse, and never trains on your data."* → **Turn on Lamplight** / **Maybe later**.
4. Opted out → **`OptedOutCard`**: *"Lamplight is off."* / *"Your notes remain private. Nothing is being analyzed."* / *"Change your mind? Turn on Lamplight →"* (calls `deleteAllUserData`).
5. No `today` entitlement → **`PaywallCard`**: *"Lamplight is no longer included free."* / *"Contact us for access"*.
6. Else → **`TodaysLampCard`**.

**Enforced, not just promised:** opt-in default-off; content-hash-gated embeddings that no-op when opted out; validator-enforced citations (reject any note/verse not in the allowed set); full **right-to-delete** (`deleteAllUserData` wipes settings, entitlements, embeddings, artifacts, jobs, suggestions, connections); injection-safe name handling (`sanitizeFirstName` whitelist — letters/marks/apostrophe/hyphen, first token, ≤40 chars, null on any failure).

### 10.5 Entitlement / paywall

Tiers `plus | lite | none`; sources `promo | subscription | grant`. `hasAccess(feature)` where features are `today | weekly | reflections | inline | chat`:
- **Promo active → everything free.**
- `chat` → plus only.
- `plus` → all; `lite` → `today` + `weekly`; `none` → nothing (fail-closed).

Server mirrors the chat gate (`hasChatAccess`) → 402 when failed. Current posture: **free during promo, else a contact-us gate** (no self-serve checkout).

### 10.6 Settings (`LamplightSettings`)

`enabled` (master opt-in, default false), `quietMode` (default false), `inlineSuggestions` (default true), `weeklyEmail` (default false), `consentDecidedAt`. The only surfaced controls are the consent decision and opt-out reset; the rest are persisted without toggles. **Removed (migration 020):** manual `voice_preference` and `tradition_hint` — voice/tradition are now auto-inferred by the model.

### 10.7 Connection Cards (distinct from chat)

The `connection_card_why` artifact. Surfaces notes that "echo" the active note via embedding neighbors (RPC `match_my_note_neighbors`, similarity threshold 0.78 from `app_config`). Cards show shared signals (`#tags` + shared verse refs). Clicking a card lazily generates a "why these connect" explanation (Haiku), cached by a composite content hash of both notes. Loading → *"Lighting…"*; the explanation is prefixed with the user's first name. Layouts: `strip` (desktop) / `stack` (mobile). The server re-verifies the neighbor relationship (returns `no_embedding`/`not_neighbor`) so the UI never shows a card the server will refuse to explain.

### 10.8 UI states (Today's Lamp)

| State | Component | Copy |
|---|---|---|
| Sign-in gate | `SignInGate` | "Today's Lamp is waiting for you." / "Sign in to begin." |
| Consent | `ConsentCard` | "Welcome the lamp." |
| Opted out | `OptedOutCard` | "Lamplight is off." |
| Paywall | `PaywallCard` | "Lamplight is no longer included free." |
| Intro/idle | `TodaysLampIntro` | "Show Me Today's Lamp" |
| Loading | `TodaysLampLoading` | cycling steps (2500ms) |
| Error: no_notes | `TodaysLampError` | "Lamplight needs your notes to begin." (no retry) |
| Error: validators/network | `TodaysLampError` | "Lamplight had trouble lighting today." / "Couldn't reach Lamplight just now." (retry) |
| Ready | `TodaysLampCard` | 🕯 "Today · {date}", opening, scripture, reflection, prompt, "Drawing from your notes about:" |

---

## 11. The Living Graph (3D Reference Graph)

The deterministic relationship layer (`graph/`). **Not Three.js** — it's a **d3-force-3d** simulation projected orthographically onto a 2D `<canvas>`.

### 11.1 Data model (`graph/types.ts`)

`Reference` (canonical, owned by `ReferenceGraph`): `{ id, source, target, type, weight, createdAt }`. Three edge types:

| Type | Weight | Created by |
|---|---|---|
| `explicit` | 1.0 | An authored `noteLink` mark (note → note) |
| `scripture-reference` | 0.9 | A verse reference detected in note text (note → scripture node) |
| `cross-reference` | 0.5 | Bundled TSK (Treasury of Scripture Knowledge) dataset (scripture → scripture) |

**Shared verse is not a direct note→note edge** — two notes citing the same verse become 2-hop neighbors through the shared `ScriptureNode`. (Direct shared-verse detection lives in the connection layer, §12.)

`ScriptureNode`: `{ id: 'scripture:{abbrev}-{chapter}-{verseStart}', book, chapter, verseStart, verseEnd, translation, text, createdAt }`. Note ids key only on `verseStart`, so `Ps 23:1` and `Ps 23:1-6` collapse to one node.

### 11.2 Parsing (`reference-parser.ts`)

`parseReferencesFromContent(noteId, content)` walks `noteLink` marks (→ explicit edges) and runs `VERSE_REGEX` over the plain text (→ scripture-reference edges + scripture refs). `VERSE_REGEX` is built from 66 `BOOK_PATTERNS` (name/abbrev variants), matching `<book> ch:vs(-range)?`. `toCanonicalScriptureId` and `BOOK_TO_OSIS` map to canonical ids / `bible_passages` row ids. `fetchVerseText` joins BSB rows for the verse range.

### 11.3 ReferenceGraph class (`reference-graph.ts`)

An `Observable` of `{ references, scriptureNodes }`. **Persistence is a derivation cache** (`localStorage` keys `notepad_graph_references`, `notepad_scripture_nodes`), rebuildable from note content + the TSK dataset + the Bible API.

- `syncNote` / `syncAll` / `init` — re-derive edges for notes (drop+replace by source id, deterministic edge ids).
- `expandTskForNewNodes` — lazy-loads `tsk-data.json`, adds cross-reference edges between scripture nodes both present in the graph.
- `repairNoteLinks` — pure orphan-by-title healer (rewrites stale `noteId`s when the title still matches a note).
- `getNeighborhood(nodeId, depth)` — BFS over incoming+outgoing edges (drives "local" mode).

### 11.4 View projection (`project-graph.ts`)

Pure `projectGraph(notes, references, scriptureNodes)`: every note becomes a node (weight = sum of incident edge weights); a scripture node is emitted **only if it participates in ≥1 edge**. Type colors: scripture `#C49A78`, sermon `#7A9BAE`, devotion `#6B8B7A`, theme `#D4A0A0`.

### 11.5 Rendering (`graph-view.ts`, `force-sphere.ts`, `sphere-math.ts`)

- d3 simulation (3D) with **link**, **charge**, and a custom **`forceSphere`** (pushes nodes toward a sphere surface of radius `~√(count)·55`). New nodes seed on a Fibonacci/golden-spiral sphere.
- **Settle-then-show:** ticks up to 500 times then auto-fits in one shot (no spreading animation visible); afterwards only the camera rotates (positions frozen).
- **Projection:** orthographic with depth-based scaling/fading (back nodes shrink + fade) and back-to-front painter sorting.
- **Auto-rotation** at 0.18 rad/s when idle — **respects `prefers-reduced-motion`** (renders static).
- **Interactions:** hover highlights a node + its neighbors; drag-to-orbit (pitch clamped ~75°); wheel zoom; **click a scripture node → popover with the verse text** (the "click a verse to see notes that share it" interaction — surrounding edges visually connect it to the notes that reference it); click a note node → opens the note.
- **Modes:** `global` (all) vs `local` (BFS neighborhood of the active node). Live settings: depth, link distance/force, repel, node size, edge thickness.

> Note: `force-shared-tags.ts` is implemented and exported but **not wired** into the live simulation (active forces are link/charge/sphere only).

---

## 12. Backlinks & Connection Cards

### 12.1 Backlinks (`BacklinksPanel.tsx`, `backlinks.ts`)

A read-only projection of the graph's **`explicit`** edges: notes that contain an authored `noteLink` mark targeting the active note. Title-substring "soft mentions" are explicitly rejected. `buildBacklinks` groups cards by source note type (**DEVOTION NOTES / SERMON NOTES / THEMES**), each with a bracketed snippet around the linking mark. Empty: *"No other notes link to this one yet."*

### 12.2 Connection layer (`connection-cards/`, `hooks/`)

The semantic half — **embedding-driven**, entirely separate from the reference graph.

- **Qualification** (`connection-qualification.ts`, pure): reasons `no_active_note | note_too_short | vault_too_small`. Defaults: `minWords = 10`, `minVaultSize = 2`.
- **Discovery** (`connection-discovery.ts`): reactive `Observable` with generation fencing. Modes `presence` (count only, for the mobile glow-dot) and `full` (assemble cards). State machine: `inactive | waiting_for_embedding | no_connections | present | ready | error`. Flow: qualify → `hasNoteEmbedding` → `getConnectionNeighbors(noteId, K=5, minSimilarity=0.78)` → `loadNeighborNotes` → build ≤3 cards.
- **Shared signals** (`connection-signals.ts`): deterministic — case-insensitive shared tags + shared verse refs (each capped at 3). (Uses its own broader verse regex, a cross-runtime mirror of the edge-function copy.)
- **"Why these connect"** (`connection-why.ts`): per-card `collapsed → loading → shown | error`. Server-side LLM (Haiku via `lamplight-generate kind=connection_card_why`), cached by composite content hash. `prefixWhyWithName` prepends the first name at render.

### 12.3 Connection Cards UI (`ConnectionCardsPanel.tsx`)

Renders only on `ready` (desktop `strip` self-hides otherwise). Each card: signals line (`#grace · Romans 8:28`) + title. Chip click expands the "why" (*"Lighting…"* → text / *"Couldn't read this connection."* + Try again). **Open ↗** opens the note. Mobile empty states (`ConnectionCardsEmpty.tsx`):
- waiting → *"The lamp is reading…"*
- none → *"Nothing echoes yet"*
- error → *"Couldn't reach the lamp"* / *"…your notes are safe."*
- inactive → *"No connections lit yet"* + a checklist + a **"What lights a connection"** criteria dialog (deliberately numberless so it never drifts from dev-loosened thresholds).

---

## 13. Paper Styles ("Seven Papers")

### 13.1 The marketing feature

Landing copy (`section06`): *"Choose the paper that asks the right thing of you."* The seven papers (`{name, blurb}`):
1. **Linen** — "the morning before the day arrives"
2. **Vellum** — "for long-form devotional writing"
3. **Margin** — "for sermon capture, fast"
4. **Dotted Crème** — "for thinking in lists"
5. **Ruled Walnut** — "for the heavier writing"
6. **Communion** — "for the lament psalms"
7. **Folio** — "for the slow morning, the long quiet"

Rendered as an auto-advancing (5s) video carousel that respects `prefers-reduced-motion`.

> **Important gap:** the `Note` model has **no paper/background field**. "Applying a paper to a note" is a landing-page promise; the live editor does **not** persist a paper choice per note.

### 13.2 The style asset manifest (separate concern)

The auto-generated `styles/manifest.ts` catalogs **~413 decorative annotation stickers** (not papers), used by highlights and decorations:

| Category | Count |
|---|---|
| `highlight` | 125 |
| `squiggle` | 85 |
| `line` | 65 |
| `arrow` | 60 |
| `bubble` | 48 |
| `shape` | 30 |

Each has a `.thumb.webp` (picker) and full `.webp` (display) + precomputed aspect ratio. Highlight assets apply as stretched background images via the `styleHighlight` mark (§5.4).

---

## 14. Gamification — Tiers & Level-Ups

`gamification/tiers.ts` — eight tiers, each rooted in a verse:

| # | Name | Threshold | Reference |
|---|------|-----------|-----------|
| 1 | New Flame | 0 | Zechariah 4:10 |
| 2 | Spark | 10 | Psalm 27:1 |
| 3 | Ember | 50 | 2 Timothy 1:6 |
| 4 | Flame | 150 | Hebrews 1:7 |
| 5 | Lamp | 300 | Psalm 119:105 |
| 6 | Pillar of Fire | 500 | Exodus 13:21 |
| 7 | Refiner | 1000 | Malachi 3:3 |
| 8 | Glory | 5000 | Luke 2:9 |

- Driven by **`highestNoteCount`** (a high-water mark) — deleting notes never demotes you. Only notes with `word_count >= 20` count toward it (DB trigger).
- `getTierForCount` / `getNextTier` select the current/next tier.
- **`useUserTier`** tracks the previous tier and fires a level-up when crossed (seeds on mount without firing).
- **`TierBadge`** — 🔥 + tier name, popover **JOURNEY RANK** showing the scripture + reference + `{count} notes written`.
- **`LevelUpModal`** — fire-glow animation, *"YOU HAVE REACHED"* + tier name + scripture + **Continue**.

This is unrelated to Lamplight entitlement tiers.

---

## 15. Scan / OCR & Document Import

### 15.1 Scan / OCR (`scan/`)

A pipeline turning a photo of a handwritten page into a saved note. Entry: **"Scan handwritten note"** in `UploadModal` (signed-in only).

- **Controller** (`scan-capture.ts`, `Observable`): phases `idle | camera | cleaning | transcribing | error`. Validates MIME + ≤10 MB before any work. Generation-fenced (drops results after cancel/unmount).
- **Capture** (`useScanCapture.ts`) — `getUserMedia({ facingMode: 'environment' })`, draws to canvas → JPEG blob.
- **Preprocess** (`image-preprocess.ts`) — decode → downscale (long edge ≤1500) → grayscale + contrast stretch → **lazy deskew** (jscanify/OpenCV.js, loaded from CDN, failures swallowed) → JPEG.
- **Transcription** (`transcription-client.ts`) — uploads to the private Supabase **`note-scans`** bucket, invokes the **`transcribe-note`** edge function (the OCR/AI model runs server-side). Returns `{ transcription, confidence, uncertainWords, verseFlags, transcription_id, imageKey }`.
- **Capture UI** (`ScanCapturePanel.tsx`) — Take/Choose photo, camera preview, *"Cleaning up image…"* → *"Reading your handwriting…"*, error with Try again. Error copy is stage-tagged (e.g. *"We could not read that note. Please try a clearer photo."*).
- **Review UI** (`TranscriptionReview.tsx`) — original image beside an **editable TipTap editor** seeded from the transcription. Title defaults to *"Scanned note · {date}"*. **Uncertain words** are highlighted via a non-persisting decoration; a **low-confidence banner** (`< 0.6`) warns *"This handwriting was hard to read…"*; **verse flags** show `{ref} ✓` or *"couldn't find this, check the photo"*. **Save** builds a note (auto-detect verses on) + cross-links by verse + `importNotes` + `markTranscriptionSaved`; **Discard** deletes the scan.

### 15.2 Document import (`import/document-importer.ts`)

- **`parseFile`** — `.md/.txt` (text), `.pdf` (lazy `pdfjs-dist`), `.docx` (lazy `mammoth`).
- **`buildNoteFromText`** — splits paragraphs, wraps in TipTap nodes, client-generates id/timestamps/wordCount, optionally seeds verse-ref tags (cap 10).
- **`linkNotesByVerses`** — appends a **"Related Notes"** section with real `noteLink` marks between notes sharing a verse (become graph edges/backlinks after sync).
- **`UploadModal`** — `react-dropzone` accepting `.md/.txt/.pdf/.docx`. Options: **Auto-detect verse references (add as tags)** (default on), **Auto-create links between notes sharing verse refs** (default off). Destination folder select; selected-files list; **Upload & Process** → `filesToNotes` → `importNotes`.

---

## 16. Online/Offline & First-Load

### 16.1 Online status (`hooks/useOnlineStatus.ts`)

Seeds from `navigator.onLine`, subscribes to `online`/`offline` events. Drives the amber banner *"You're offline — viewing cached notes"* — shown **only when offline AND signed-in** (anonymous users are local-only, so "offline" is meaningless for them). Writing offline still works.

### 16.2 First-load (`first-load/`)

`decideFirstLoadActions` (pure) decides, for a signed-in user:
- Never welcomed → `redirect-welcome` (`/welcome`).
- Else not greeted today → `greet` (a per-session/day toast *"Welcome back{, FirstName}!"*).
- Local notes present (`localNoteCount > 0`) → `offer-migration` (the `MigrationDialog`).

`useNotepadFirstLoad` reads `localAdapter.getNotes()` for the count (past the storage seam) and dispatches. **No seeded/sample content** is ever injected.

---

## 17. Cross-Cutting Notes & Known Gaps

These are findings worth flagging for product/eng:

1. **Marketing vs. built:**
   - **Lamplight:** only **Today's Lamp** is implemented. "What God seems to be saying" (weekly) and "Seasonal Reflections" are copy + reserved enum/entitlement slots — **no pipeline**.
   - **Seven Papers:** a landing-page carousel; the editor does **not** persist a per-note paper style. The `Note` model has no paper field.

2. **The "3D" graph is a 2D canvas** with a hand-rolled orthographic projection + a custom `forceSphere` d3 force (no Three.js/WebGL). Depth is faked via scaling/fading + painter sorting. `force-shared-tags.ts` is dead code in the live render path.

3. **Two independent verse-regex/book-list implementations** exist (`reference-parser.ts` requires chapter:verse; `connection-signals.ts` makes chapter:verse optional) and can disagree on what counts as a reference.

4. **Scripture node ids key only on `verseStart`**, so a single verse and a range starting there collapse to the same node.

5. **`wordCount` is not maintained by editing** — the editor saves only `content` + `tags`; word count is computed on demand in `InfoPanel`. (Adapters do recompute it on write, so the persisted value stays correct.)

6. **No drag-to-reorder** anywhere in the sidebar; folder order is append-only at creation; note moves are dialog-driven.

7. **No continuous local↔cloud sync** — the boundary is a one-time migration. A signed-in user who goes offline has their Supabase calls fail (no local fallback copy of cloud notes); only writes already in local mode persist offline.

8. **Privacy is structurally enforced**, not just promised: opt-in default-off, content-hash-gated embeddings, validator-enforced citations, full right-to-delete, injection-safe name handling.

9. **Voice/tradition preferences were removed** (migration 020) — Lamplight now auto-infers them from note content. The settings model still carries `quietMode`/`inlineSuggestions`/`weeklyEmail` without surfaced toggles.

10. **Vanity URLs are private/owner-only today** — `/notepad/u/:username` enforces ownership and redirects mismatches. The readable username is an identity/canonicalization device and the seam for a future public share surface, not a public read mode yet.

---

### Appendix — Subsystem → primary source map

| Subsystem | Location |
|---|---|
| Data model | `src/notepad/types.ts`, `note-type-config.ts` |
| Collection/storage/migration | `src/notepad/collection/`, `storage/`, `context/`, `first-load/` |
| Editor & extensions | `src/notepad/components/Editor.tsx`, `editor/`, `extensions/`, `utils/tiptap-text.ts`, `utils/tags.ts` |
| Decorations | `src/notepad/decorations/`, `styles/manifest.ts` |
| Sidebar/folders | `src/notepad/components/Sidebar.tsx`, `sidebar/` |
| Search/info | `src/notepad/components/SearchDialog.tsx`, `search-index.ts`, `InfoPanel.tsx` |
| Bible reader/study | `src/notepad/bible/`, `supabase/functions/lamplight-chat/` |
| Lamplight | `src/notepad/lamplight/`, `components/lamplight/`, `hooks/`, `storage/lamplight-*`, `supabase/functions/lamplight-generate/`, `embed-note/` |
| Graph/connections | `src/notepad/graph/`, `connection-cards/`, `components/BacklinksPanel.tsx` |
| Tiers | `src/notepad/gamification/tiers.ts`, `components/TierBadge.tsx`, `LevelUpModal.tsx` |
| Scan/import | `src/notepad/scan/`, `import/`, `components/UploadModal.tsx`, `TranscriptionReview.tsx` |
| Routing/composition | `src/App.tsx`, `src/auth/username/NotepadRoutes.tsx`, `context/NotepadProvider.tsx`, `components/sections/Notepad.tsx`, `StudyWindow.tsx` |
| Domain glossary | `docs/CONTEXT.md` |
