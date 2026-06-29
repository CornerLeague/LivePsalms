# Import-Notes Prompt: Show Once Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local-notes import prompt resolve in one sitting — name the notes, and let a confirmed "No" permanently delete them so it never nags on reload.

**Architecture:** The first-load decision logic is unchanged (it offers migration whenever local notes exist). We add a `decline()` action to `MigrationWorkflow` that purges local notes via the existing `clearSource` seam, expose it through `useMigrationWorkflow`, and update `MigrationDialog` to (a) list note titles and (b) gate "No" behind an in-dialog "are you sure?" confirm step that calls `decline()`. Purging drives the local-note count to 0, so the prompt stops; a new offline note re-triggers it naturally.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react (jsdom), Radix Dialog wrapper (`@/components/ui/dialog`), sonner toasts.

## Global Constraints

- Confirmed decline **permanently deletes** local notes via `localAdapter.clearAll()` (reused through the workflow's `clearSource` dep). No separate "declined" flag.
- Title list shows the first **3** titles, then `…and N more`. Empty/whitespace titles render as `Untitled note`.
- Casual dismiss (outside-click / Escape / X) stays non-destructive: calls `onClose`, never `decline`. Re-prompts next load. **No change** to `decideFirstLoadActions` / `useNotepadFirstLoad`.
- `decline()` must be a no-op while a migration is in progress (status guard), so a user can't delete mid-import.
- Typecheck with `tsc -b` (the real build command), not bare `tsc --noEmit`.
- Test runner: `npx vitest run <path>`.

---

### Task 1: `MigrationWorkflow.decline()` + hook wiring

**Files:**
- Modify: `src/notepad/storage/migration-workflow.ts`
- Modify: `src/notepad/storage/useMigrationWorkflow.tsx`
- Test: `src/notepad/storage/migration-workflow.test.ts`

**Interfaces:**
- Consumes: existing `MigrationWorkflowDeps` (`clearSource: () => void`, `toastSuccess: (m: string) => void`, `onClose: () => void`).
- Produces:
  - `MigrationWorkflow.decline(): void` — purges source, toasts, closes; no-op unless status is `idle` or `error`.
  - Exported const `MIGRATION_DECLINE_MESSAGE = 'Local notes removed.'`.
  - `useMigrationWorkflow(...)` return gains `decline: () => void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/notepad/storage/migration-workflow.test.ts` (the `makeDeps()` helper already records `clearSourceCalls`, `toastSuccess`, and `onClose`):

```ts
describe('MigrationWorkflow — decline()', () => {
  it('purges the source, toasts, and closes when called from idle', () => {
    const { deps, rec } = makeDeps();
    const w = new MigrationWorkflow(deps);
    w.decline();
    expect(rec.clearSourceCalls).toBe(1);
    expect(rec.toastSuccess).toEqual(['Local notes removed.']);
    expect(rec.onClose).toBe(1);
    expect(w.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('is a no-op while a migration is in progress', () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    void w.start(); // status === 'loading'
    w.decline();
    expect(rec.clearSourceCalls).toBe(0);
    expect(rec.onClose).toBe(0);
    migrate.resolve({ folders: 0, notes: 0 }); // let start() settle
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notepad/storage/migration-workflow.test.ts -t "decline"`
Expected: FAIL — `w.decline is not a function`.

- [ ] **Step 3: Implement `decline()` in the workflow**

In `src/notepad/storage/migration-workflow.ts`, add the exported constant next to `MIGRATION_FALLBACK_ERROR`:

```ts
export const MIGRATION_DECLINE_MESSAGE = 'Local notes removed.';
```

Add the method immediately after `dismissError` (before `dispose`):

```ts
  decline = (): void => {
    const { status } = this.getSnapshot();
    if (status !== 'idle' && status !== 'error') return; // never delete mid-import
    this.deps.clearSource();
    this.update(() => ({ status: 'idle' }));
    this.deps.toastSuccess(MIGRATION_DECLINE_MESSAGE);
    this.deps.onClose();
  };
```

- [ ] **Step 4: Expose `decline` through the hook**

In `src/notepad/storage/useMigrationWorkflow.tsx`:

Add to `UseMigrationWorkflowResult`:

```ts
interface UseMigrationWorkflowResult {
  state: MigrationWorkflowState;
  start: () => void;
  decline: () => void;
  dismissError: () => void;
}
```

Add to the returned object (alongside `start`):

```ts
  return {
    state,
    start: () => {
      void workflow.start();
    },
    decline: () => workflow.decline(),
    dismissError: workflow.dismissError,
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/notepad/storage/migration-workflow.test.ts`
Expected: PASS (all existing tests + the two new `decline()` tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no new errors (see Global Constraints re: pre-existing baseline).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/storage/migration-workflow.ts src/notepad/storage/useMigrationWorkflow.tsx src/notepad/storage/migration-workflow.test.ts
git commit -m "feat(notepad): MigrationWorkflow.decline() purges local notes on confirmed decline"
```

---

### Task 2: `MigrationDialog` — list note titles in the prompt

**Files:**
- Modify: `src/notepad/components/MigrationDialog.tsx`
- Test: `src/notepad/components/MigrationDialog.test.tsx` (create)

**Interfaces:**
- Consumes: `localAdapter.getNotes()` → `Note[]` where `Note.title: string`.
- Produces: prompt heading `Import this note?` (1) / `Import these {n} notes?` (n>1); a titles list (first `PREVIEW_LIMIT = 3`, then `…and {n-3} more`); empty titles shown as `Untitled note`.

- [ ] **Step 1: Write the failing tests (new file)**

Create `src/notepad/components/MigrationDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getNotes = vi.fn();
const start = vi.fn();
const decline = vi.fn();
const dismissError = vi.fn();
let workflowState: { status: string } = { status: 'idle' };

vi.mock('../storage/local-storage', () => ({
  localAdapter: { getNotes: () => getNotes() },
}));
vi.mock('../storage/useMigrationWorkflow', () => ({
  useMigrationWorkflow: () => ({ state: workflowState, start, decline, dismissError }),
}));

import { MigrationDialog } from './MigrationDialog';
import type { StorageAdapter } from '../storage/adapter';

const targetAdapter = {} as StorageAdapter;
const note = (title: string) => ({ title }) as { title: string };

beforeEach(() => {
  workflowState = { status: 'idle' };
  getNotes.mockReset();
  start.mockReset();
  decline.mockReset();
  dismissError.mockReset();
});
afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <MigrationDialog
      open
      onClose={onClose}
      targetAdapter={targetAdapter}
      onMigrationComplete={vi.fn()}
    />,
  );
  return onClose;
}

describe('MigrationDialog — title list', () => {
  it('lists the first three titles and summarises the rest', async () => {
    getNotes.mockResolvedValue(
      ['Morning prayer', 'Romans 8 reflections', 'Sermon notes', 'Psalm 23', 'Gratitude'].map(note),
    );
    renderDialog();
    expect(await screen.findByText('Import these 5 notes?')).toBeTruthy();
    expect(screen.getByText('Morning prayer')).toBeTruthy();
    expect(screen.getByText('Romans 8 reflections')).toBeTruthy();
    expect(screen.getByText('Sermon notes')).toBeTruthy();
    expect(screen.getByText('…and 2 more')).toBeTruthy();
    expect(screen.queryByText('Psalm 23')).toBeNull();
  });

  it('uses singular copy for a single note', async () => {
    getNotes.mockResolvedValue([note('Just one thought')]);
    renderDialog();
    expect(await screen.findByText('Import this note?')).toBeTruthy();
    expect(screen.getByText('Just one thought')).toBeTruthy();
  });

  it('renders whitespace-only titles as "Untitled note"', async () => {
    getNotes.mockResolvedValue([note('   '), note('Real title')]);
    renderDialog();
    expect(await screen.findByText('Import these 2 notes?')).toBeTruthy();
    expect(screen.getByText('Untitled note')).toBeTruthy();
  });

  it('calls start when Import Notes is clicked', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    fireEvent.click(await screen.findByText('Import Notes'));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notepad/components/MigrationDialog.test.tsx -t "title list"`
Expected: FAIL — `findByText('Import these 5 notes?')` times out (current copy is "Import Local Notes?").

- [ ] **Step 3: Implement the title list**

In `src/notepad/components/MigrationDialog.tsx`:

Add a module-level constant near the top (after imports):

```ts
const PREVIEW_LIMIT = 3;
```

Replace the count state + effect (currently `const [noteCount, setNoteCount] = useState(0)` and its `useEffect`) with titles:

```tsx
  const [titles, setTitles] = useState<string[]>([]);

  // Read local note titles when the dialog opens. Source-side ownership stays
  // inside LocalStorageAdapter — the dialog never touches storage keys.
  useEffect(() => {
    if (!open) return;
    localAdapter.getNotes().then((notes) =>
      setTitles(notes.map((n) => n.title.trim() || 'Untitled note')),
    );
  }, [open]);

  const total = titles.length;
```

Replace the final prompt branch (the `else` after the `error` branch — the block whose `DialogTitle` reads "Import Local Notes?") with a titled list. Keep the surrounding `) : (` / `)` structure:

```tsx
        ) : (
          <>
            <DialogTitle
              className="text-lg font-medium text-center"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              {total === 1 ? 'Import this note?' : `Import these ${total} notes?`}
            </DialogTitle>

            <ul className="mt-3 flex flex-col gap-1.5">
              {titles.slice(0, PREVIEW_LIMIT).map((t, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                >
                  <span aria-hidden style={{ color: 'var(--silica)' }}>•</span>
                  <span className="truncate">{t}</span>
                </li>
              ))}
              {total > PREVIEW_LIMIT && (
                <li
                  className="text-sm pl-4"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  …and {total - PREVIEW_LIMIT} more
                </li>
              )}
            </ul>

            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  border: '1px solid var(--pale-stone)',
                  color: 'var(--deep-umber)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                No
              </button>
              <button
                onClick={start}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity"
                style={{
                  background: 'var(--deep-umber)',
                  color: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Import Notes
              </button>
            </div>
          </>
        )}
```

> Note: the "No" button is wired to `onClose` for now — Task 3 rewires it to the confirm step. Leaving it on `onClose` keeps this task's deliverable independently shippable (titles render; behavior unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notepad/components/MigrationDialog.test.tsx`
Expected: PASS (4 title-list tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no new errors. (Confirm `noteCount` has no remaining references.)

- [ ] **Step 6: Commit**

```bash
git add src/notepad/components/MigrationDialog.tsx src/notepad/components/MigrationDialog.test.tsx
git commit -m "feat(notepad): import prompt lists note titles (first 3 + and N more)"
```

---

### Task 3: `MigrationDialog` — "are you sure?" confirm step → delete

**Files:**
- Modify: `src/notepad/components/MigrationDialog.tsx`
- Test: `src/notepad/components/MigrationDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `decline: () => void` from `useMigrationWorkflow` (Task 1); titles render (Task 2).
- Produces: in-dialog view state `'prompt' | 'confirm-decline'`; "No" → confirm step; "Keep" → prompt; "Delete" → `decline()`. Outside-click/Escape still → `onClose`.

- [ ] **Step 1: Write the failing tests (extend the file)**

Append to `src/notepad/components/MigrationDialog.test.tsx`:

```tsx
describe('MigrationDialog — confirm-decline', () => {
  it('shows the delete confirmation when No is clicked', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    fireEvent.click(await screen.findByText('No'));
    expect(screen.getByText('Delete these notes?')).toBeTruthy();
    expect(screen.getByText(/permanently deleted/i)).toBeTruthy();
  });

  it('returns to the prompt when Keep is clicked, without deleting', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    const onClose = renderDialog();
    fireEvent.click(await screen.findByText('No'));
    fireEvent.click(screen.getByText('Keep'));
    expect(screen.getByText('Import this note?')).toBeTruthy();
    expect(decline).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls decline when Delete is confirmed', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    renderDialog();
    fireEvent.click(await screen.findByText('No'));
    fireEvent.click(screen.getByText('Delete'));
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it('clicking No does not delete or close on its own', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    const onClose = renderDialog();
    fireEvent.click(await screen.findByText('No'));
    expect(decline).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets to the prompt view when reopened', async () => {
    getNotes.mockResolvedValue([note('A note')]);
    const { rerender } = render(
      <MigrationDialog open onClose={vi.fn()} targetAdapter={targetAdapter} onMigrationComplete={vi.fn()} />,
    );
    fireEvent.click(await screen.findByText('No'));
    expect(screen.getByText('Delete these notes?')).toBeTruthy();
    rerender(
      <MigrationDialog open={false} onClose={vi.fn()} targetAdapter={targetAdapter} onMigrationComplete={vi.fn()} />,
    );
    rerender(
      <MigrationDialog open onClose={vi.fn()} targetAdapter={targetAdapter} onMigrationComplete={vi.fn()} />,
    );
    expect(await screen.findByText('Import this note?')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notepad/components/MigrationDialog.test.tsx -t "confirm-decline"`
Expected: FAIL — clicking "No" calls `onClose` (Task 2 wiring) and "Delete these notes?" never appears.

- [ ] **Step 3: Add the view state and wire `decline`**

In `src/notepad/components/MigrationDialog.tsx`:

Pull `decline` from the hook (update the destructure):

```tsx
  const { state, start, decline, dismissError } = useMigrationWorkflow({
    target: targetAdapter,
    onMigrationComplete,
    onClose,
  });
```

Add view state below the `titles` state, resetting to `'prompt'` whenever the dialog opens:

```tsx
  const [view, setView] = useState<'prompt' | 'confirm-decline'>('prompt');
  useEffect(() => {
    if (open) setView('prompt');
  }, [open]);
```

In the final prompt branch from Task 2, switch on `view`. Change the "No" button's `onClick` from `onClose` to `() => setView('confirm-decline')`, and render the confirm step when `view === 'confirm-decline'`. Replace the Task 2 `) : (` block body with:

```tsx
        ) : view === 'confirm-decline' ? (
          <>
            <DialogTitle
              className="text-lg font-medium text-center"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              Delete these notes?
            </DialogTitle>
            <DialogDescription
              className="text-center text-sm mt-2"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              Your local notes will be permanently deleted and can't be recovered.
            </DialogDescription>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setView('prompt')}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  border: '1px solid var(--pale-stone)',
                  color: 'var(--deep-umber)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Keep
              </button>
              <button
                onClick={decline}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity"
                style={{
                  background: 'var(--deep-umber)',
                  color: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle
              className="text-lg font-medium text-center"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              {total === 1 ? 'Import this note?' : `Import these ${total} notes?`}
            </DialogTitle>

            <ul className="mt-3 flex flex-col gap-1.5">
              {titles.slice(0, PREVIEW_LIMIT).map((t, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                >
                  <span aria-hidden style={{ color: 'var(--silica)' }}>•</span>
                  <span className="truncate">{t}</span>
                </li>
              ))}
              {total > PREVIEW_LIMIT && (
                <li
                  className="text-sm pl-4"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  …and {total - PREVIEW_LIMIT} more
                </li>
              )}
            </ul>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setView('confirm-decline')}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  border: '1px solid var(--pale-stone)',
                  color: 'var(--deep-umber)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                No
              </button>
              <button
                onClick={start}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity"
                style={{
                  background: 'var(--deep-umber)',
                  color: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Import Notes
              </button>
            </div>
          </>
        )}
```

> The `Dialog`'s `onOpenChange` guard (`if (!v && !inProgress) onClose()`) is unchanged, so outside-click / Escape / X still close via `onClose` and never touch `decline`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notepad/components/MigrationDialog.test.tsx`
Expected: PASS (Task 2 title-list tests + Task 3 confirm-decline tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/components/MigrationDialog.tsx src/notepad/components/MigrationDialog.test.tsx
git commit -m "feat(notepad): No → confirm step that deletes local notes so the prompt stops"
```

---

### Task 4: Full-suite guard + manual smoke note

**Files:** none (verification only)

- [ ] **Step 1: Run the affected test files together**

Run: `npx vitest run src/notepad/storage/migration-workflow.test.ts src/notepad/components/MigrationDialog.test.tsx src/notepad/first-load`
Expected: PASS. (The unchanged `notepad-first-load` tests confirm migration is still offered solely on local-note count — i.e. purge → 0 notes → no offer.)

- [ ] **Step 2: Typecheck the build**

Run: `npx tsc -b`
Expected: no new errors vs. the pre-existing baseline (force-sphere.test.ts is a known pre-existing failure; do not regress beyond it).

- [ ] **Step 3: Manual smoke (document for the human, do not block on it)**

Sign out, write a couple of notes, sign in:
1. Prompt names the notes (titles + "…and N more" past 3).
2. "No" → "Delete these notes?" → "Keep" returns; "Delete" removes them and the prompt does not reappear on reload.
3. "Import Notes" imports as before.
4. Write a new offline note → prompt returns for it.
5. Outside-click dismiss → notes kept, prompt returns next load.

---

## Self-Review

**Spec coverage:**
- Show once / stop nagging → Task 1 (`decline` purge) + Task 3 (No→confirm→Delete). ✓
- Titles in message, single + multiple → Task 2. ✓
- "Are you sure? gone" confirm → Task 3 confirm-decline step. ✓
- Confirm → don't ask again → Task 1 purge drives count to 0 (verified Task 4 / first-load tests). ✓
- New offline note re-triggers → unchanged `decideFirstLoadActions` (Task 4 note). ✓
- Casual dismiss non-destructive → unchanged `onOpenChange`/`onClose` (Task 3 note + test "clicking No does not close"). ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. ✓

**Type consistency:** `decline` named identically in workflow, hook return type, hook body, dialog destructure, and tests. `MIGRATION_DECLINE_MESSAGE` exported and asserted verbatim. `PREVIEW_LIMIT = 3` used in render and matched by the "…and 2 more" test (5 − 3). `titles`/`total` consistent across Task 2 and Task 3. ✓
