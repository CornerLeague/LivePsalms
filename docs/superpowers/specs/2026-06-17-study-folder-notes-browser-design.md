# Study Folder + Study Notes Browser — Design

**Date:** 2026-06-17
**Branch:** feat/study-mode
**Status:** Approved (design), pending implementation plan

## Problem

In Study mode, the Notes tab of the right side panel is bare: with no note open it
shows a single "New note" button (`collection.createNote('root', 'general')`); with a
note open it shows the editor. There is no way to browse notes, and study notes land
in the virtual root alongside everything else.

We want the Study Notes tab to open into a dedicated **Study** folder: a per-user
folder auto-provisioned the first time the user enters Study mode, browsable as a tree,
with the ability to create notes and nested subfolders inside it.

## Decisions (from brainstorming)

1. **Study folder identity → system-marked folder.** A real folder tagged with a
   `kind` marker so it is rename-proof, delete-proof, and never collides with a
   user-created folder named "Study". (Chosen over name-matching and a settings pointer.)
2. **Browse UX → expand/collapse tree**, rooted at the Study folder, reusing the
   existing notepad tree components. (Chosen over drill-in/breadcrumb.)
3. **Main sidebar → show everywhere.** Study is a normal (system-marked) folder that
   also appears in the main notepad tree; Study mode is just a focused entry point.
   No filtering logic. (Chosen over hiding it from the main sidebar.)
4. **Editor open → in the panel, with back.** Tapping a note swaps the panel to the
   editor (as today) with a `‹ Study notes` header that returns to the tree via the
   existing `openNote(null)`. (Chosen over a pinned-tree split view.)
5. **Default Study folder icon → `book`.** Study root is not deletable or renamable.

## Existing architecture (grounding)

- Study route `/notepad/.../study` → `StudyWorkspace.tsx`; right pane is
  `StudySidePanel.tsx` with Notes | Chat tabs.
- `folders` table: `id, user_id, name, parent_id, order, icon, color` (migration 002).
  "root" is virtual (`folder_id = null`); no root record exists.
- Storage goes through `StorageAdapter` (interface) with `SupabaseStorageAdapter`
  (signed-in) and `LocalStorageAdapter` (anonymous/local) implementations.
- State: `NoteCollection` (notes, `activeNoteId`, `openNote(id|null)`, `createNote`) and
  `FolderHierarchy` (folders, `createFolder`, `renameFolder`, `deleteFolder`), both
  hoisted via `NotepadProvider` above the layout routes.
- Tree UI already exists: `buildFolderTreeView(notes, folders, filter, tag)` produces
  `notesByFolder` and `childFoldersByParent` maps; `FolderItem` renders a folder with
  pre-sliced `notes` + `childFolders`, recurses for children, and exposes per-folder
  "New Note Inside" / "New Subfolder" / Rename / Delete menus. `NewNoteDialog` (type
  picker) and `NewFolderDialog` exist.
- `openNote(null)` already clears the active note (no new "close" method needed).
- Latest migration is `034`; next is `035`.

## Design

### A. Data model — migration `035_folder_kind.sql`

- Add `kind text` to `public.folders`, nullable, default `null`. Value `'study'` marks
  the system Study folder.
- Add a partial unique index for DB-level idempotency / race safety:
  `CREATE UNIQUE INDEX folders_one_study_per_user ON public.folders (user_id) WHERE kind = 'study';`
- TypeScript: add `type FolderKind = 'study'` and `kind?: FolderKind` to the `Folder`
  interface (`src/notepad/types.ts`).
- `SupabaseStorageAdapter.mapFolder` reads `kind`; `createFolder` / `updateFolder` and
  the `StorageAdapter` interface accept optional `kind`. `LocalStorageAdapter` persists
  `kind` like any other field.

### B. Provisioning — `ensureStudyFolder()` (idempotent)

- Add `ensureStudyFolder(): Promise<Folder>` to `StorageAdapter` and both
  implementations:
  - Find an existing `kind === 'study'` folder for the user → return it.
  - Else create `{ name: 'Study', kind: 'study', icon: 'book', parentId: null, order: 0 }`.
  - Supabase: on unique-violation (two tabs racing) → re-fetch the existing study folder
    and return it.
  - Local: same find-or-create against localStorage.
- Add `FolderHierarchy.ensureStudyFolder()` wrapper that calls the adapter, merges the
  folder into state, and records its id.
- `FolderHierarchyState` gains `studyFolderId: string | null`, set after ensure.
- **Trigger:** `StudyWorkspace` calls `hierarchy.ensureStudyFolder()` once on mount
  (`useEffect`). Runs for both signed-in and local/anonymous scopes. NOT triggered by the
  plain notepad — only on entering Study mode.

### C. Study Notes tab — `StudySidePanel` / `StudyNotesTab`

Two mutually exclusive states in the ~360px panel:

- **No active note → tree rooted at Study.**
  - Build `view = buildFolderTreeView(notes, folders, '', null)`, locate the Study folder
    by `studyFolderId`.
  - Render a single rooted `FolderItem`:
    `folder={study}`, `isSystem`, `notes={view.notesByFolder.get(studyId) ?? []}`,
    `childFolders={view.childFoldersByParent.get(studyId) ?? []}`, plus
    `notesByFolder` / `childFoldersByParent` / `allFolders` and all callbacks, defaulted
    to expanded.
  - Callbacks wire to `collection` (open/create/rename/duplicate/delete/move note) and
    `hierarchy` (rename/delete/create subfolder).
  - Create actions reuse existing dialogs: New Note → `NewNoteDialog` (type picker) →
    `collection.createNote(targetFolderId, type)`; New Subfolder → existing
    prompt/`NewFolderDialog` path → `hierarchy.createFolder(name, targetFolderId, …)`.
    Target = Study at the root level, or a specific subfolder via that folder's own menu.
  - Empty Study folder → header + create menu + a short hint line.
  - If `studyFolderId` is null (ensure still in flight) → brief loading/empty state.

- **Active note → editor.** Render `NotepadEditor` (as today) with a `‹ Study notes`
  back header calling `collection.openNote(null)` to return to the tree.

### D. System-folder guardrails

- Add optional `isSystem?: boolean` to `FolderItem`. When true (Study root only): hide
  **Rename** and **Delete** in both the dropdown menu and the context menu, and suppress
  the inline-rename trigger. Subfolders inside Study remain fully editable.

### E. Edge cases

- **Study folder missing on entry** → `ensureStudyFolder` recreates it (self-healing).
- **Concurrent creation (two tabs)** → partial unique index + on-conflict re-fetch.
- **Notes moved out of Study** → allowed; it behaves like a normal folder otherwise.
- **Local → signed-in transition** → each scope has its own Study folder (ids never
  collide, matching `NoteCollection.init()`'s existing comment); ensure runs per-adapter
  on the next Study entry.

### F. Testing

- `ensureStudyFolder` idempotency — returns existing / creates when missing / handles
  unique-violation — for `SupabaseStorageAdapter` and `LocalStorageAdapter`.
- Rooted-tree selection renders Study's direct child notes + subfolders correctly.
- Component: tree shows when no active note; New Note / New Subfolder target Study;
  tapping a note opens the editor; back returns to the tree; Study root exposes no
  rename/delete.
- Verify **zero new** lint / `tsc -b` / test failures against the known pre-existing red
  baseline (not a green repo-wide gate).

## Out of scope (YAGNI)

- Drill-in / breadcrumb navigation (tree chosen instead).
- Hiding the Study folder from the main notepad sidebar.
- Custom Study-only create UI (existing dialogs reused).
- Drag-and-drop changes.

## Migration / deploy notes

- Apply migration via `supabase db push` (history in sync; only new migrations pending).
- No edge-function changes, so no manual function deploy is required for this work.
