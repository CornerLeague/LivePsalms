# Study Folder + Study Notes Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-provision a per-user system "Study" folder on entering Study mode, and turn the Study Notes tab into an expand/collapse tree rooted at that folder with create-note / create-subfolder actions.

**Architecture:** A `kind='study'` marker on the existing `folders` table identifies the system folder (rename/delete-proof, collision-proof). An idempotent `ensureStudyFolder()` on the storage adapter find-or-creates it; `FolderHierarchy` exposes it and tracks `studyFolderId`. `StudyWorkspace` triggers provisioning on mount via a small hook. The Study Notes tab reuses the existing `buildFolderTreeView` + `FolderItem` tree, rendered rooted at the Study folder, with a new `isSystem` flag on `FolderItem` that hides rename/delete for the root only.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, Supabase (Postgres + RLS), localStorage adapter, existing notepad observable-store pattern (`useSyncExternalStore`).

## Global Constraints

- TypeScript build check is `tsc -b` (NOT bare `tsc --noEmit` — root tsconfig has `files: []`). Verify with `tsc -b`.
- Repo ships with a known **red baseline**: ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), 2 failing test files (`Editor.toolbar-placement`, `garden-scene`), all unrelated. Gate on **zero NEW** errors, not a green repo.
- Migrations apply via `supabase db push` (history is in sync; only new migrations are pending). No edge-function changes here, so no manual function deploy.
- Storage access goes through the `StorageAdapter` interface; any method added to the interface MUST be implemented in all three adapters: `SupabaseStorageAdapter`, `LocalStorageAdapter`, `FakeStorageAdapter`.
- Local/anonymous and signed-in scopes have separate id spaces and separate Study folders; never assume one id resolves in the other scope.
- Default Study folder: `name: 'Study'`, `kind: 'study'`, `icon: 'book'`, `parentId: null`, `order: 0`. Study root is not renamable or deletable from the UI.

---

### Task 1: Add `kind` to the Folder model + migration + Supabase mapping

**Files:**
- Modify: `src/notepad/types.ts:29-40` (add `FolderKind` + `Folder.kind`)
- Create: `supabase/migrations/035_folder_kind.sql`
- Modify: `src/notepad/storage/supabase-adapter.ts:145-161` (createFolder writes `kind`), `:228-235` (mapFolder reads `kind`)
- Test: `src/notepad/storage/supabase-adapter.folder-kind.test.ts`

**Interfaces:**
- Produces: `type FolderKind = 'study'`; `Folder.kind?: FolderKind`. `SupabaseStorageAdapter.mapFolder(row)` returns `kind`.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/storage/supabase-adapter.folder-kind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SupabaseStorageAdapter } from './supabase-adapter';

// mapFolder is a pure mapper that never touches the client, so a dummy client
// is fine for exercising the read path.
function makeAdapter() {
  return new SupabaseStorageAdapter({} as never, 'user-1');
}

describe('SupabaseStorageAdapter.mapFolder kind', () => {
  it('reads kind from the row', () => {
    const adapter = makeAdapter();
    const folder = adapter.mapFolder({
      id: 'f1',
      name: 'Study',
      parent_id: null,
      order: 0,
      icon: 'book',
      color: null,
      kind: 'study',
    });
    expect(folder.kind).toBe('study');
  });

  it('leaves kind undefined when the column is null', () => {
    const adapter = makeAdapter();
    const folder = adapter.mapFolder({
      id: 'f2',
      name: 'Sermons',
      parent_id: null,
      order: 1,
      icon: null,
      color: null,
      kind: null,
    });
    expect(folder.kind).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/storage/supabase-adapter.folder-kind.test.ts`
Expected: FAIL — `folder.kind` is `undefined` in the first case (mapFolder doesn't read `kind` yet).

- [ ] **Step 3: Add the type**

In `src/notepad/types.ts`, replace the `Folder` interface block (lines 29-40) so it reads:

```ts
export type FolderIcon =
  | 'heart' | 'star' | 'cross' | 'flame' | 'dove' | 'crown'
  | 'book' | 'music' | 'sun' | 'shield' | 'lamp' | 'wheat';

export type FolderKind = 'study';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  icon?: FolderIcon;
  color?: string;
  kind?: FolderKind;
}
```

- [ ] **Step 4: Map and persist `kind` in the Supabase adapter**

In `src/notepad/storage/supabase-adapter.ts`, in `createFolder` (the `.insert({ ... })` object, lines 148-155) add a `kind` field after `color`:

```ts
      .insert({
        user_id: this.#userId,
        name: folder.name,
        parent_id: folder.parentId,
        order: folder.order,
        icon: folder.icon ?? null,
        color: folder.color ?? null,
        kind: folder.kind ?? null,
      })
```

In `mapFolder` (lines 228-235) add the `kind` field to the returned object:

```ts
  mapFolder = (row: Record<string, unknown>): Folder => ({
    id: row.id as string,
    name: row.name as string,
    parentId: (row.parent_id as string) ?? null,
    order: row.order as number,
    icon: row.icon as Folder['icon'],
    color: row.color as string | undefined,
    kind: (row.kind as Folder['kind']) ?? undefined,
  });
```

- [ ] **Step 5: Create the migration**

Create `supabase/migrations/035_folder_kind.sql`:

```sql
-- Mark the per-user system "Study" folder so Study mode can find/provision it.
-- kind is null for ordinary folders; 'study' for the single system Study folder.
alter table public.folders add column if not exists kind text;

-- At most one Study folder per user: gives idempotent provisioning + race safety
-- (a second concurrent insert hits this index and we re-fetch the existing row).
create unique index if not exists folders_one_study_per_user
  on public.folders (user_id)
  where kind = 'study';
```

- [ ] **Step 6: Run the test to verify it passes + typecheck**

Run: `npx vitest run src/notepad/storage/supabase-adapter.folder-kind.test.ts`
Expected: PASS (both cases).

Run: `npx tsc -b`
Expected: No NEW errors (the 4 pre-existing `force-sphere.test.ts` errors may remain — confirm nothing new mentions `Folder`, `kind`, or files you touched).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/types.ts src/notepad/storage/supabase-adapter.ts supabase/migrations/035_folder_kind.sql src/notepad/storage/supabase-adapter.folder-kind.test.ts
git commit -m "feat(study): add folder kind marker + migration 035"
```

---

### Task 2: `ensureStudyFolder()` on the adapter interface + all three implementations

**Files:**
- Modify: `src/notepad/storage/adapter.ts:15-19` (interface)
- Modify: `src/notepad/collection/fake-storage-adapter.ts` (Fake impl)
- Modify: `src/notepad/storage/local-storage.ts` (Local impl)
- Modify: `src/notepad/storage/supabase-adapter.ts` (Supabase impl)
- Test: `src/notepad/storage/ensure-study-folder.test.ts`

**Interfaces:**
- Consumes: `Folder`, `FolderKind` (Task 1).
- Produces: `StorageAdapter.ensureStudyFolder(): Promise<Folder>` — returns the existing `kind==='study'` folder for the user, or creates one with the default Study shape. Idempotent: repeated calls return the same folder id.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/storage/ensure-study-folder.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeStorageAdapter, resetFakeAdapterIds } from '../collection/fake-storage-adapter';
import { LocalStorageAdapter } from './local-storage';

describe('ensureStudyFolder — FakeStorageAdapter', () => {
  beforeEach(() => resetFakeAdapterIds());

  it('creates a Study folder when none exists', async () => {
    const adapter = new FakeStorageAdapter();
    const folder = await adapter.ensureStudyFolder();
    expect(folder.kind).toBe('study');
    expect(folder.name).toBe('Study');
    expect(folder.parentId).toBeNull();
    expect((await adapter.getFolders()).filter((f) => f.kind === 'study')).toHaveLength(1);
  });

  it('is idempotent — second call returns the same folder', async () => {
    const adapter = new FakeStorageAdapter();
    const first = await adapter.ensureStudyFolder();
    const second = await adapter.ensureStudyFolder();
    expect(second.id).toBe(first.id);
    expect((await adapter.getFolders()).filter((f) => f.kind === 'study')).toHaveLength(1);
  });
});

describe('ensureStudyFolder — LocalStorageAdapter', () => {
  beforeEach(() => localStorage.clear());

  it('creates then reuses the Study folder', async () => {
    const adapter = new LocalStorageAdapter();
    const first = await adapter.ensureStudyFolder();
    expect(first.kind).toBe('study');
    const second = await adapter.ensureStudyFolder();
    expect(second.id).toBe(first.id);
    expect((await adapter.getFolders()).filter((f) => f.kind === 'study')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/storage/ensure-study-folder.test.ts`
Expected: FAIL — `adapter.ensureStudyFolder is not a function`.

- [ ] **Step 3: Add to the interface**

In `src/notepad/storage/adapter.ts`, add a line inside the `StorageAdapter` interface after `deleteFolder` (line 19):

```ts
  deleteFolder(id: string): Promise<void>;
  /** Find-or-create the per-user system Study folder. Idempotent. */
  ensureStudyFolder(): Promise<Folder>;
}
```

- [ ] **Step 4: Implement in FakeStorageAdapter**

In `src/notepad/collection/fake-storage-adapter.ts`, add a method after `deleteFolder` (after line 88):

```ts
  async ensureStudyFolder(): Promise<Folder> {
    const existing = this.folders.find((f) => f.kind === 'study');
    if (existing) return { ...existing };
    return this.createFolder({
      name: 'Study',
      parentId: null,
      order: 0,
      icon: 'book',
      kind: 'study',
    });
  }
```

- [ ] **Step 5: Implement in LocalStorageAdapter**

In `src/notepad/storage/local-storage.ts`, add a method after `deleteFolder` (after line 122):

```ts
  async ensureStudyFolder(): Promise<Folder> {
    const existing = this.readFolders().find((f) => f.kind === 'study');
    if (existing) return existing;
    return this.createFolder({
      name: 'Study',
      parentId: null,
      order: 0,
      icon: 'book',
      kind: 'study',
    });
  }
```

- [ ] **Step 6: Implement in SupabaseStorageAdapter**

In `src/notepad/storage/supabase-adapter.ts`, add a method in the Folders section (after `deleteFolder`, after line 211):

```ts
  async ensureStudyFolder(): Promise<Folder> {
    const existing = await this.#getStudyFolder();
    if (existing) return existing;

    const { data, error } = await this.#client
      .from('folders')
      .insert({
        user_id: this.#userId,
        name: 'Study',
        parent_id: null,
        order: 0,
        icon: 'book',
        color: null,
        kind: 'study',
      })
      .select()
      .single();

    // 23505 = unique_violation: another tab created it first. Re-fetch and use it.
    if (error?.code === '23505') {
      const raced = await this.#getStudyFolder();
      if (raced) return raced;
    }
    if (error) throw error;
    return this.mapFolder(data);
  }

  async #getStudyFolder(): Promise<Folder | null> {
    const { data, error } = await this.#client
      .from('folders')
      .select('*')
      .eq('kind', 'study')
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapFolder(data) : null;
  }
```

- [ ] **Step 7: Run the test + typecheck**

Run: `npx vitest run src/notepad/storage/ensure-study-folder.test.ts`
Expected: PASS (all three describe blocks).

Run: `npx tsc -b`
Expected: No NEW errors. (If any adapter is missing `ensureStudyFolder`, tsc reports "does not implement StorageAdapter" — fix that adapter.)

- [ ] **Step 8: Commit**

```bash
git add src/notepad/storage/adapter.ts src/notepad/collection/fake-storage-adapter.ts src/notepad/storage/local-storage.ts src/notepad/storage/supabase-adapter.ts src/notepad/storage/ensure-study-folder.test.ts
git commit -m "feat(study): ensureStudyFolder() on all storage adapters"
```

> Note: the Supabase race/re-fetch path and the `kind` write path are covered by the cross-adapter idempotency tests above plus manual e2e (Task 7 verification), since the Supabase adapter has no client-mock harness in this repo.

---

### Task 3: `FolderHierarchy.ensureStudyFolder()` + `studyFolderId` state

**Files:**
- Modify: `src/notepad/collection/folder-hierarchy.ts:6-10` (state shape), add `ensureStudyFolder` method
- Test: `src/notepad/collection/folder-hierarchy.test.ts` (extend)

**Interfaces:**
- Consumes: `StorageAdapter.ensureStudyFolder()` (Task 2).
- Produces: `FolderHierarchyState.studyFolderId: string | null`; `FolderHierarchy.ensureStudyFolder(): Promise<Folder>` which merges the folder into `folders` and sets `studyFolderId`.

- [ ] **Step 1: Write the failing test**

Append to `src/notepad/collection/folder-hierarchy.test.ts` (inside the top-level `describe('FolderHierarchy', ...)`, after the last `it`):

```ts
  it('starts with a null studyFolderId', () => {
    expect(hierarchy.getSnapshot().studyFolderId).toBeNull();
  });

  it('ensureStudyFolder adds the folder and records its id', async () => {
    await hierarchy.init();
    const folder = await hierarchy.ensureStudyFolder();
    const state = hierarchy.getSnapshot();
    expect(state.studyFolderId).toBe(folder.id);
    expect(state.folders.filter((f) => f.kind === 'study')).toHaveLength(1);
  });

  it('ensureStudyFolder is idempotent across calls', async () => {
    await hierarchy.init();
    const first = await hierarchy.ensureStudyFolder();
    const second = await hierarchy.ensureStudyFolder();
    expect(second.id).toBe(first.id);
    expect(hierarchy.getSnapshot().folders.filter((f) => f.kind === 'study')).toHaveLength(1);
  });

  it('rebindAdapter clears studyFolderId', async () => {
    await hierarchy.init();
    await hierarchy.ensureStudyFolder();
    hierarchy.rebindAdapter(new FakeStorageAdapter());
    expect(hierarchy.getSnapshot().studyFolderId).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/collection/folder-hierarchy.test.ts`
Expected: FAIL — `studyFolderId` is `undefined` / `hierarchy.ensureStudyFolder is not a function`.

- [ ] **Step 3: Implement state + method**

In `src/notepad/collection/folder-hierarchy.ts`:

Replace the state interface + EMPTY_STATE (lines 6-10) with:

```ts
export interface FolderHierarchyState {
  folders: Folder[];
  studyFolderId: string | null;
}

const EMPTY_STATE: FolderHierarchyState = { folders: [], studyFolderId: null };
```

Add an `ensureStudyFolder` method after `createFolder` (after line 37):

```ts
  ensureStudyFolder = async (): Promise<Folder> => {
    const folder = await this.adapter.ensureStudyFolder();
    this.setState((prev) => ({
      ...prev,
      folders: prev.folders.some((f) => f.id === folder.id)
        ? prev.folders.map((f) => (f.id === folder.id ? folder : f))
        : [...prev.folders, folder],
      studyFolderId: folder.id,
    }));
    return folder;
  };
```

(Every existing `setState((prev) => ({ ...prev, folders: ... }))` already spreads `prev`, so `studyFolderId` is preserved through init/create/rename/delete — no other edits needed.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/collection/folder-hierarchy.test.ts`
Expected: PASS (existing + 4 new cases).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/collection/folder-hierarchy.ts src/notepad/collection/folder-hierarchy.test.ts
git commit -m "feat(study): FolderHierarchy.ensureStudyFolder + studyFolderId state"
```

---

### Task 4: `useEnsureStudyFolder` hook + trigger on Study entry

**Files:**
- Create: `src/notepad/study/useEnsureStudyFolder.ts`
- Modify: `src/notepad/study/StudyWorkspace.tsx:10-12` (call the hook)
- Test: `src/notepad/study/useEnsureStudyFolder.test.tsx`

**Interfaces:**
- Consumes: `useFolderHierarchy()` → `{ studyFolderId, hierarchy }`; `FolderHierarchy.ensureStudyFolder()` (Task 3).
- Produces: `useEnsureStudyFolder(): string | null` — fires `ensureStudyFolder()` once on mount, returns the current `studyFolderId`.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/useEnsureStudyFolder.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FolderHierarchy } from '../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../collection/fake-storage-adapter';
import { FolderHierarchyContext } from '../context/useFolderHierarchy';
import { useEnsureStudyFolder } from './useEnsureStudyFolder';

describe('useEnsureStudyFolder', () => {
  let hierarchy: FolderHierarchy;

  beforeEach(() => {
    hierarchy = new FolderHierarchy(new FakeStorageAdapter());
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <FolderHierarchyContext.Provider value={hierarchy}>
        {children}
      </FolderHierarchyContext.Provider>
    );
  }

  it('provisions a Study folder on mount and returns its id', async () => {
    const { result } = renderHook(() => useEnsureStudyFolder(), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(hierarchy.getSnapshot().folders.filter((f) => f.kind === 'study')).toHaveLength(1);
    expect(result.current).toBe(hierarchy.getSnapshot().studyFolderId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/useEnsureStudyFolder.test.tsx`
Expected: FAIL — cannot find module `./useEnsureStudyFolder`.

- [ ] **Step 3: Create the hook**

Create `src/notepad/study/useEnsureStudyFolder.ts`:

```ts
import { useEffect } from 'react';
import { useFolderHierarchy } from '../context/useFolderHierarchy';

/**
 * Provisions the per-user system Study folder when Study mode mounts.
 * Idempotent at every layer (adapter unique index + find-or-create), so firing
 * once per mount is safe. Returns the current studyFolderId for consumers.
 */
export function useEnsureStudyFolder(): string | null {
  const { studyFolderId, hierarchy } = useFolderHierarchy();
  useEffect(() => {
    void hierarchy.ensureStudyFolder();
  }, [hierarchy]);
  return studyFolderId;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/useEnsureStudyFolder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into StudyWorkspace**

In `src/notepad/study/StudyWorkspace.tsx`, add the import near the other study imports (after line 7):

```ts
import { useEnsureStudyFolder } from './useEnsureStudyFolder';
```

Then call it at the top of the component body, right after the existing `const userId = ...` line (line 12):

```ts
  const userId = user?.id ?? null;
  useEnsureStudyFolder();
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: No NEW errors.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/study/useEnsureStudyFolder.ts src/notepad/study/useEnsureStudyFolder.test.tsx src/notepad/study/StudyWorkspace.tsx
git commit -m "feat(study): provision Study folder on entering Study mode"
```

---

### Task 5: `isSystem` flag on FolderItem (hide rename/delete for the root)

**Files:**
- Modify: `src/notepad/sidebar/FolderItem.tsx:36-57` (prop), `:114-163` (dropdown menu), `:233-266` (context menu)
- Test: `src/notepad/sidebar/FolderItem.isSystem.test.tsx`

**Interfaces:**
- Produces: `FolderItemProps.isSystem?: boolean` — when true, the Rename and Delete menu items are not rendered (in both the dropdown and the context menu); "New Note Inside" and "New Subfolder" remain.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/sidebar/FolderItem.isSystem.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Folder } from '../types';
import { FolderItem } from './FolderItem';
import { TreeViewStateProvider } from './tree-view-state';

const STUDY: Folder = { id: 's1', name: 'Study', parentId: null, order: 0, icon: 'book', kind: 'study' };

function noop() {}

function renderFolder(isSystem: boolean) {
  return render(
    <TreeViewStateProvider>
      <FolderItem
        folder={STUDY}
        isSystem={isSystem}
        notes={[]}
        childFolders={[]}
        notesByFolder={new Map()}
        childFoldersByParent={new Map()}
        allFolders={[STUDY]}
        activeNoteId={null}
        onOpen={noop}
        onCreateNote={noop}
        onRenameNote={noop}
        onDuplicateNote={noop}
        onDeleteNote={noop}
        onMoveNote={noop}
        onRenameFolder={noop}
        onDeleteFolder={noop}
        onCreateSubfolder={noop}
      />
    </TreeViewStateProvider>,
  );
}

describe('FolderItem isSystem', () => {
  it('hides Rename and Delete but keeps create actions when isSystem', async () => {
    const user = userEvent.setup();
    renderFolder(true);
    await user.click(screen.getByLabelText(/folder options/i));
    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.getByText('New Note Inside')).toBeInTheDocument();
    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
  });

  it('shows Rename and Delete for a normal folder', async () => {
    const user = userEvent.setup();
    renderFolder(false);
    await user.click(screen.getByLabelText(/folder options/i));
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/sidebar/FolderItem.isSystem.test.tsx`
Expected: FAIL — no element labelled "folder options" (the trigger has no accessible label yet), and `isSystem` isn't a prop.

- [ ] **Step 3: Add the prop**

In `src/notepad/sidebar/FolderItem.tsx`, add `isSystem` to `FolderItemProps` (after line 36, the `folder` field):

```ts
export interface FolderItemProps {
  folder: Folder;
  /** When true (the system Study root), hide Rename + Delete actions. */
  isSystem?: boolean;
  /** Notes whose `folderId` matches this folder, already filtered. */
  notes: Note[];
```

Destructure it in the component body (in the `const { ... } = props;` block, after `folder,` on line 61):

```ts
  const {
    folder,
    isSystem = false,
    notes,
```

- [ ] **Step 4: Add an accessible label to the menu trigger + gate the items**

In `src/notepad/sidebar/FolderItem.tsx`, on the dropdown trigger `<span>` (lines 116-125), add `aria-label="Folder options"` and `role="button"`:

```tsx
                  <span
                    role="button"
                    aria-label="Folder options"
                    className="shrink-0 cursor-pointer rounded hover:bg-black/10 transition-all"
                    style={{
                      opacity: hovering || menuOpen || isMobile ? 1 : 0,
                      transition: 'opacity 0.15s',
                      color: 'var(--silica)',
                      padding: '1px',
                    }}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
                  >
```

In the **dropdown** menu, wrap the Rename item (lines 133-138) and the Delete separator+item (lines 154-161) so they only render when not system:

```tsx
                  {!isSystem && (
                    <DropdownMenuItem
                      onSelect={() => menuAction.run(() => setRenaming(true))}
                      style={{ fontFamily: 'Outfit, sans-serif' }}
                    >
                      Rename
                    </DropdownMenuItem>
                  )}
```

```tsx
                  {!isSystem && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => menuAction.run(() => setDeleteOpen(true))}
                        className="text-red-600 focus:text-red-600"
                        style={{ fontFamily: 'Outfit, sans-serif' }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
```

In the **context** menu, wrap the Rename item (lines 237-242) and the Delete separator+item (lines 258-265) identically, using `ContextMenuItem` / `ContextMenuSeparator`:

```tsx
          {!isSystem && (
            <ContextMenuItem
              onSelect={() => menuAction.run(() => setRenaming(true))}
              style={{ fontFamily: 'Outfit, sans-serif' }}
            >
              Rename
            </ContextMenuItem>
          )}
```

```tsx
          {!isSystem && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => menuAction.run(() => setDeleteOpen(true))}
                className="text-red-600 focus:text-red-600"
                style={{ fontFamily: 'Outfit, sans-serif' }}
              >
                Delete
              </ContextMenuItem>
            </>
          )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/notepad/sidebar/FolderItem.isSystem.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: No NEW errors.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/sidebar/FolderItem.tsx src/notepad/sidebar/FolderItem.isSystem.test.tsx
git commit -m "feat(study): isSystem flag hides rename/delete on FolderItem root"
```

---

### Task 6: Rewrite the Study Notes tab as a rooted tree

**Files:**
- Modify: `src/notepad/study/panes/StudySidePanel.tsx:34-75` (replace `StudyNotesTab`; add imports)
- Test: `src/notepad/study/panes/StudyNotesTab.test.tsx`

**Interfaces:**
- Consumes: `useNoteCollection()` → `{ notes, activeNote, collection }`; `useFolderHierarchy()` → `{ folders, studyFolderId, hierarchy }`; `buildFolderTreeView(notes, folders, '', null)`; `FolderItem` (+ `isSystem` from Task 5); `TreeViewStateProvider`; `collection.openNote(null)` to return to the tree.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/panes/StudyNotesTab.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NoteCollection } from '../../collection/note-collection';
import { FolderHierarchy } from '../../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../../collection/fake-storage-adapter';
import { NoteCollectionContext } from '../../context/useNoteCollection';
import { FolderHierarchyContext } from '../../context/useFolderHierarchy';
import { StudyNotesTab } from './StudySidePanel';

describe('StudyNotesTab', () => {
  let adapter: FakeStorageAdapter;
  let collection: NoteCollection;
  let hierarchy: FolderHierarchy;

  beforeEach(() => {
    adapter = new FakeStorageAdapter();
    collection = new NoteCollection(adapter);
    hierarchy = new FolderHierarchy(adapter);
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <NoteCollectionContext.Provider value={collection}>
        <FolderHierarchyContext.Provider value={hierarchy}>
          {children}
        </FolderHierarchyContext.Provider>
      </NoteCollectionContext.Provider>
    );
  }

  it('shows a setup state before the Study folder exists', () => {
    render(<StudyNotesTab />, { wrapper });
    expect(screen.getByText(/setting up your study folder/i)).toBeInTheDocument();
  });

  it('renders the Study root and a note inside it', async () => {
    await hierarchy.ensureStudyFolder();
    const studyId = hierarchy.getSnapshot().studyFolderId!;
    await collection.createNote(studyId, 'general');
    await collection.refetchAll();
    await collection.updateNote(collection.getSnapshot().notes[0].id, { title: 'My study note' });

    render(<StudyNotesTab />, { wrapper });
    await waitFor(() => expect(screen.getByText('Study')).toBeInTheDocument());
    expect(screen.getByText('My study note')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/StudyNotesTab.test.tsx`
Expected: FAIL — `StudyNotesTab` is not exported from `StudySidePanel`.

- [ ] **Step 3: Replace the imports + `StudyNotesTab` in StudySidePanel**

In `src/notepad/study/panes/StudySidePanel.tsx`, replace the import block (lines 5-8) with:

```tsx
import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { NotepadEditor } from '@/notepad/components/Editor';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useFolderHierarchy } from '@/notepad/context/useFolderHierarchy';
import { FolderItem } from '@/notepad/sidebar/FolderItem';
import { TreeViewStateProvider } from '@/notepad/sidebar/tree-view-state';
import { buildFolderTreeView } from '@/notepad/sidebar/folder-tree-view';
import { LamplightStudyPanel } from './LamplightStudyPanel';
```

Replace the entire `StudyNotesTab` function (lines 34-75) with (note it is now `export`ed for the test):

```tsx
// The Notes tab is a folder browser rooted at the per-user Study folder. With a
// note open it swaps to the editor (with a back affordance); otherwise it shows
// the Study folder's expand/collapse tree plus create actions.
export function StudyNotesTab() {
  const { notes, activeNote, collection } = useNoteCollection();
  const { folders, studyFolderId, hierarchy } = useFolderHierarchy();

  if (activeNote) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <button
          onClick={() => collection.openNote(null)}
          aria-label="Back to Study notes"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '8px 12px',
            border: 'none',
            borderBottom: '1px solid var(--pale-stone)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--deep-umber)',
            fontFamily: 'Outfit, sans-serif',
            fontSize: 12,
          }}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Study notes
        </button>
        <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto' }}>
          <NotepadEditor />
        </div>
      </div>
    );
  }

  const study = studyFolderId ? folders.find((f) => f.id === studyFolderId) : null;
  if (!study) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          color: 'var(--silica)',
          fontFamily: 'Outfit, sans-serif',
          fontSize: 13,
        }}
      >
        Setting up your Study folder…
      </div>
    );
  }

  const view = buildFolderTreeView(notes, folders, '', null);

  return (
    <TreeViewStateProvider>
      <div style={{ padding: 8 }}>
        <FolderItem
          folder={study}
          isSystem
          notes={view.notesByFolder.get(study.id) ?? []}
          childFolders={view.childFoldersByParent.get(study.id) ?? []}
          notesByFolder={view.notesByFolder}
          childFoldersByParent={view.childFoldersByParent}
          allFolders={folders}
          activeNoteId={null}
          onOpen={(id) => collection.openNote(id)}
          onCreateNote={(folderId, type) => { void collection.createNote(folderId, type); }}
          onRenameNote={(id, title) => { void collection.renameNote(id, title); }}
          onDuplicateNote={(id) => { void collection.duplicateNote(id); }}
          onDeleteNote={(id) => { void collection.deleteNote(id); }}
          onMoveNote={(noteId, folderId) => { void collection.moveNote(noteId, folderId); }}
          onRenameFolder={(id, name) => { void hierarchy.renameFolder(id, name); }}
          onDeleteFolder={(id) => { void hierarchy.deleteFolder(id); }}
          onCreateSubfolder={(parentId, name) => { void hierarchy.createFolder(name, parentId); }}
        />
      </div>
    </TreeViewStateProvider>
  );
}
```

(The `StudySidePanel` component below is unchanged — it already renders `<StudyNotesTab />`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/panes/StudyNotesTab.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + lint the touched files**

Run: `npx tsc -b`
Expected: No NEW errors.

Run: `npx eslint src/notepad/study/panes/StudySidePanel.tsx src/notepad/sidebar/FolderItem.tsx`
Expected: No NEW errors on these files (compare against the red baseline — these files should be clean).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/study/panes/StudySidePanel.tsx src/notepad/study/panes/StudyNotesTab.test.tsx
git commit -m "feat(study): Study Notes tab is a tree rooted at the Study folder"
```

---

### Task 7: Apply migration + manual verification

**Files:** none (DB + manual smoke).

- [ ] **Step 1: Apply the migration**

Run: `supabase db push`
Expected: migration `035_folder_kind.sql` applies; `folders.kind` column + `folders_one_study_per_user` index created. Confirm no other migrations were unexpectedly pushed.

- [ ] **Step 2: Run the full notepad test subset**

Run: `npx vitest run src/notepad`
Expected: The new tests pass; the only failures are the known red-baseline files (`Editor.toolbar-placement`, `garden-scene`) — nothing new.

- [ ] **Step 3: Manual smoke (signed-in + local)**

1. Sign in, open Study mode. Confirm a "Study" folder is created (check Supabase `folders` for a `kind='study'` row; only one even after re-entering Study).
2. Study → Notes tab shows the Study folder tree. Create a note via "New Note Inside" → it opens the editor; the back control returns to the tree and the note appears under Study.
3. Create a subfolder via "New Subfolder"; create a note inside it; confirm nesting renders.
4. Confirm the Study **root** offers no Rename/Delete (menu + right-click); a subfolder still does.
5. Open the main notepad sidebar — the Study folder and its notes appear there too.
6. Sign out / anonymous: open Study mode, confirm a local Study folder is created and the tab behaves the same.

- [ ] **Step 4: Commit any doc/status updates (if applicable)**

```bash
git add -A
git commit -m "chore(study): apply migration 035 + verification notes" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- A. Data model (`kind` + migration + partial unique index + TS type + mapper) → Task 1 (+ index in 035).
- B. Provisioning (`ensureStudyFolder` on all adapters, `FolderHierarchy` wrapper, `studyFolderId`, trigger on Study entry) → Tasks 2, 3, 4.
- C. Study Notes tab (rooted tree, create actions, editor + back, loading state) → Task 6.
- D. System-folder guardrails (`isSystem` hides rename/delete) → Task 5.
- E. Edge cases (self-heal via ensure; race via unique index + re-fetch; per-scope folders) → Tasks 2, 4; verified Task 7.
- F. Testing (adapter idempotency, hierarchy, hook, guardrail, tab; zero-new-error gate) → Tasks 1-6 tests + Task 7 verification.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only deferred-to-manual items (Supabase race path, editor/back render) are explicitly called out with reasons, not hidden.

**Type consistency:** `FolderKind`/`Folder.kind` (Task 1) used consistently in Tasks 2-6. `ensureStudyFolder(): Promise<Folder>` identical across adapter interface (Task 2), `FolderHierarchy` (Task 3), hook (Task 4). `studyFolderId` named identically in state (Task 3), hook (Task 4), tab (Task 6). `isSystem` prop (Task 5) consumed in Task 6. `FolderItem` callback names match its existing prop names verified in source.
