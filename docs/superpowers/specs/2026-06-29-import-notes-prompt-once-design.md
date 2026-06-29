# Import-Notes Prompt: Show Once, Confirm-to-Discard

**Date:** 2026-06-29
**Branch:** fix/study-stream-followups (or a fresh `fix/import-notes-prompt-once`)
**Status:** Approved design — ready for implementation plan

## Problem

When a signed-in user has notes saved locally (written while offline or before
signing in), the app offers to import them via `MigrationDialog` ("Import Local
Notes?"). Today the prompt reappears on **every page load/reload** until the
notes are imported, because the only thing that stops it is a *successful
import* (which clears local storage). Declining — the current **"No Thanks"**
button — merely hides the dialog (`setShowMigration(false)`) and leaves the
local notes in place, so `decideFirstLoadActions` re-offers migration on the
next load.

Users who don't want to import shouldn't be nagged every session.

## Desired behavior

1. On sign-in with local notes present, show the import prompt.
2. The prompt names the note(s): show the **title(s)**, not just a count.
   - Single note → "Import this note?" + its title.
   - Multiple → list the first 3 titles + a `…and N more` line.
   - Empty title → render as "Untitled note".
3. Clicking **No** opens an "are you sure?" confirmation warning that the local
   notes will be permanently deleted.
4. Confirming the deletion **permanently deletes** the local notes. Because no
   local notes remain, the prompt never reappears for them.
5. A **new** note written later while offline / signed-out re-triggers the
   prompt (naturally, since it's a fresh local note and the count is > 0 again).
6. Importing behaves as today (migrate → clear local → success toast).

## Decisions (resolved during brainstorming)

- **"No" semantics:** confirmed decline **permanently deletes** the local notes
  (matches the user's "those notes will be gone" wording). This also means no
  separate "declined" fingerprint/flag is needed — an empty local store can't
  re-trigger the prompt.
- **Title display:** first 3 titles + `…and N more`.
- **Casual dismiss** (outside-click / X, no explicit choice): keep notes, allow
  the prompt to reappear next load. Only **Import** or a confirmed **Delete** is
  a terminal decision. (Unchanged from today's dismiss behavior.)

## Architecture

The fix is concentrated in the dialog plus one small workflow addition. The
first-load decision function is **unchanged**: it correctly offers migration
whenever `localNoteCount > 0`; purging on decline drives the count to 0.

### 1. `MigrationDialog.tsx` — fetch titles, not just count

On open, read `localAdapter.getNotes()` and keep:
- `titles: string[]` (mapped from `note.title`, falling back to "Untitled note")
- `total: number`

Render the initial prompt with the first 3 titles and, when `total > 3`, a
`…and {total - 3} more` line. Title/heading adapts for single vs. multiple.

### 2. `MigrationDialog.tsx` — local "confirm decline" sub-step

Add a component-local view state layered on top of the existing
`MigrationWorkflowState`:

```
view: 'prompt' | 'confirm-decline'
```

- **No** (in `prompt`) → `view = 'confirm-decline'`.
- Confirm step copy: "Delete these notes? Your local notes will be permanently
  deleted and can't be recovered." Buttons: **Keep** / **Delete**.
- **Keep** → `view = 'prompt'`.
- **Delete** → call workflow `decline()`.
- **Import Notes** (in `prompt`) → existing `start()`.

The `view` state is reset to `'prompt'` whenever the dialog (re)opens.

### 3. `MigrationWorkflow.decline()` — new action

Symmetric with the existing post-import `clearSource()` cleanup. Lives in the
already-unit-tested workflow so the destructive op stays out of the React
component:

```ts
decline = async (): Promise<void> => {
  const { status } = this.getSnapshot();
  if (status !== 'idle' && status !== 'error') return; // no-op mid-import
  this.deps.clearSource();              // localAdapter.clearAll()
  this.deps.toastSuccess('Local notes removed.'); // gentle confirmation
  this.deps.onClose();
};
```

Exposed through `useMigrationWorkflow` alongside `start` / `dismissError`.

### 4. No change to `decideFirstLoadActions` / `useNotepadFirstLoad`

`offer-migration` continues to key off `localNoteCount > 0`. Purge-on-decline
makes the count 0; a new offline note makes it > 0 again. Casual dismiss keeps
the existing `dismissMigration` (hide-only) behavior.

## Components & responsibilities

- **`MigrationDialog`** — view only: reads titles/count for display, owns the
  `prompt`/`confirm-decline` UI state, delegates the three terminal actions
  (`start`, `decline`, dismiss) to the workflow/hook.
- **`MigrationWorkflow`** — owns all source/target storage mutation: migrate +
  `clearSource` on success (existing) and `clearSource` on `decline` (new).
- **`useMigrationWorkflow`** — wires `decline` through to the component.
- **`notepad-first-load`** — unchanged decision logic.

## Error handling

- `decline()` reuses `clearSource` (`localAdapter.clearAll()`), which is
  synchronous and already used post-import. If it throws, surface via the
  existing toast-error path; the dialog can stay open so the user can retry or
  dismiss. (Mirror the import error affordance only if `clearAll` realistically
  fails; otherwise a simple toast is sufficient.)
- `decline()` is a no-op when a migration is in progress (status guard), so a
  user can't delete mid-import.

## Testing

- **`migration-workflow.test.ts`**
  - `decline()` calls `clearSource`, fires the confirmation toast, and calls
    `onClose`.
  - `decline()` is a no-op while a migration is in progress.
- **`MigrationDialog` (new test file)**
  - Titles render; with >3 notes, shows first 3 + `…and N more`.
  - Single-note copy vs. multi-note copy.
  - **No** → confirm-decline step appears.
  - **Keep** → returns to prompt.
  - **Delete** → invokes `decline`.
  - Outside-click still closes without deleting (calls `onClose`, not
    `decline`).
  - `view` resets to `prompt` on reopen.
- **`notepad-first-load.test.ts`** — unchanged; still verifies offer-migration
  keys off local-note count (documents that purge → 0 notes → no offer).

## Out of scope

- The separate file-upload `WelcomeImportStep` (onboarding drag-and-drop) — not
  the every-reload prompt.
- Any "declined" fingerprint/flag (unnecessary given purge-on-decline).
- Changing when migration is first offered.
