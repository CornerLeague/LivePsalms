# ConnectionDiscovery + ConnectionWhy Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the React-effect-locked `useConnectionCards` hook with three node-testable modules — a pure `decideConnectionQualification` gate, a `GraphView`-style `ConnectionDiscovery` Observable controller (with a cheap `presence` mode for the mobile glow-dot), and a separate `ConnectionWhy` controller for per-card explanations — so the generation-fencing and the why-generation branches get focused node tests instead of being reachable only through a React harness.

**Architecture:** `ConnectionDiscovery extends Observable<ConnectionDiscoveryState>` (the shared `src/notepad/collection/observable.ts` base). Inputs are forwarded via `setInputs()` from a `useEffect`; each call bumps an internal `generation` counter so stale async resolves are dropped inside the controller. A `mode` of `'presence'` stops after the neighbor fetch and emits a `{ phase: 'present'; count }` state; `'full'` continues to assemble `ConnectionCard[]`. `ConnectionWhy extends Observable<Record<relatedNoteId, ConnectionCardWhyState>>` and owns the `collapsed → loading → shown | error` per-card lifecycle. Thin hooks (`useConnectionDiscovery`, `useConnectionWhy`) wrap each controller with `useSyncExternalStore`, mirroring `useMigrationWorkflow`. The design is recorded under `## ConnectionDiscovery` and `## ConnectionWhy` in `docs/CONTEXT.md`.

**Tech Stack:** TypeScript ~5.9, React 19, Vitest (default env `node`; React tests opt into `// @vitest-environment jsdom`), `@testing-library/react`. The `FakeLamplightAdapter` (`src/notepad/storage/fake-lamplight-adapter.ts`) provides seam fakes (`__seedNoteEmbedding`, `__seedConnectionNeighbors`, `__failNextGetConnectionNeighbors`, `__seedConnectionWhy`, `__failNextGenerateConnectionWhy`).

**Test runner:** `npx vitest run` runs the whole suite. One file: `npx vitest run <path>`. Build check: `npm run build`.

**Behavior preserved exactly (so reviewers don't flag regressions):**
1. Qualification ordering and flags: `no_active_note` (meetsDepth=false), then `note_too_short` (meetsDepth=false), then `vault_too_small` (meetsDepth=true, meetsVault=false), else qualified — identical to the old hook.
2. Default thresholds: `qualifyingMinWords=10`, `qualifyingMinVaultSize=2`, `qualifyingMinSimilarity=0.78`, `maxRenderedCards=3`, neighbor `k=5`.
3. Card assembly: title falls back to `'(untitled)'`; `sharedTags`/`sharedVerseRefs` capped at 3; missing neighbor note → empty signals.
4. Why mapping: `ok → shown(text, cached)`; `!ok` with `reason==='validators_failed' → error('validators_failed')`; any other `!ok` or a throw → `error('network')`.
5. `userId` was an unused arg on the old hook — it is dropped from the new hooks but **kept on `ConnectionCardsPanelProps` and `UseHasConnectionsArgs`** so callers (`LamplightMobileView`, `ConnectionCardsStrip`, the stack test) are untouched.

**New behavior (intentional):** the mobile glow-dot (`useHasConnections`) runs `mode: 'presence'`, which stops before `loadNeighborNotes` + `computeSharedSignals` — it no longer does full card assembly just to read a boolean, and the faked-`{}`-adapter hack is removed.

---

### Task 1: Pure qualification gate `decideConnectionQualification`

The qualification decision — currently inline in the old hook's `useEffect` — becomes a pure function tested in isolation, mirroring `NotepadFirstLoad.decideFirstLoadActions`.

**Files:**
- Create: `src/notepad/connection-cards/connection-qualification.ts`
- Test: `src/notepad/connection-cards/connection-qualification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/notepad/connection-cards/connection-qualification.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideConnectionQualification } from './connection-qualification';

const base = { hasActiveNote: true, wordCount: 150, totalNoteCount: 50, minWords: 10, minVaultSize: 2 };

describe('decideConnectionQualification', () => {
  it('no_active_note when there is no active note (still reports meetsVault)', () => {
    expect(decideConnectionQualification({ ...base, hasActiveNote: false }))
      .toEqual({ qualified: false, reason: 'no_active_note', meetsDepth: false, meetsVault: true });
  });

  it('note_too_short when word count is below minWords', () => {
    expect(decideConnectionQualification({ ...base, wordCount: 5 }))
      .toEqual({ qualified: false, reason: 'note_too_short', meetsDepth: false, meetsVault: true });
  });

  it('vault_too_small when depth passes but the vault is too small', () => {
    expect(decideConnectionQualification({ ...base, totalNoteCount: 1 }))
      .toEqual({ qualified: false, reason: 'vault_too_small', meetsDepth: true, meetsVault: false });
  });

  it('short note reports meetsVault=false when the vault is also too small', () => {
    expect(decideConnectionQualification({ ...base, wordCount: 5, totalNoteCount: 1 }))
      .toEqual({ qualified: false, reason: 'note_too_short', meetsDepth: false, meetsVault: false });
  });

  it('qualified when active, deep enough, and vault large enough', () => {
    expect(decideConnectionQualification(base))
      .toEqual({ qualified: true, meetsDepth: true, meetsVault: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/connection-cards/connection-qualification.test.ts`
Expected: FAIL — `Failed to resolve import "./connection-qualification"`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/connection-cards/connection-qualification.ts`:

```ts
export type QualificationReason = 'no_active_note' | 'note_too_short' | 'vault_too_small';

export interface QualificationInput {
  hasActiveNote: boolean;
  wordCount: number;
  totalNoteCount: number;
  minWords: number;
  minVaultSize: number;
}

export type QualificationResult =
  | { qualified: false; reason: QualificationReason; meetsDepth: boolean; meetsVault: boolean }
  | { qualified: true; meetsDepth: true; meetsVault: true };

export function decideConnectionQualification(input: QualificationInput): QualificationResult {
  const meetsVault = input.totalNoteCount >= input.minVaultSize;
  if (!input.hasActiveNote) {
    return { qualified: false, reason: 'no_active_note', meetsDepth: false, meetsVault };
  }
  const meetsDepth = input.wordCount >= input.minWords;
  if (!meetsDepth) {
    return { qualified: false, reason: 'note_too_short', meetsDepth: false, meetsVault };
  }
  if (!meetsVault) {
    return { qualified: false, reason: 'vault_too_small', meetsDepth: true, meetsVault: false };
  }
  return { qualified: true, meetsDepth: true, meetsVault: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/connection-cards/connection-qualification.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/connection-cards/connection-qualification.ts src/notepad/connection-cards/connection-qualification.test.ts
git commit -m "feat(connection-cards): pure decideConnectionQualification gate"
```

---

### Task 2: `ConnectionDiscovery` Observable controller

The reactive controller that owns the qualify → embedding → neighbors → (assemble) sequence, the `presence`/`full` modes, and the generation-fencing — all node-testable with injected deps. Mirrors `GraphView` (Observable + injected `Deps`) and `MigrationWorkflow` (small status surface).

**Files:**
- Create: `src/notepad/connection-cards/connection-discovery.ts`
- Test: `src/notepad/connection-cards/connection-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/notepad/connection-cards/connection-discovery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ConnectionDiscovery } from './connection-discovery';
import type { ConnectionDiscoveryDeps, ConnectionDiscoveryInputs } from './connection-discovery';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';
import type { ConnectionNeighbor } from '../storage/lamplight-adapter';
import type { Note } from '../types';

// A macrotask boundary; the microtask queue (all chained awaits) drains first.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function makeContent(text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
}

function fakeNote(over: Partial<Note>): Note {
  return {
    id: 'note-1', title: 'Untitled', content: makeContent('word '.repeat(150).trim()),
    folderId: 'folder-1', type: 'devotion', tags: [], wordCount: 150,
    createdAt: '2026-05-27T00:00:00.000Z', updatedAt: '2026-05-27T00:00:00.000Z', ...over,
  };
}

const INPUTS: ConnectionDiscoveryInputs = {
  activeNote: fakeNote({ id: 'note-1' }),
  totalNoteCount: 50, minWords: 10, minVaultSize: 2, minSimilarity: 0.78,
  maxRenderedCards: 3, neighborK: 5,
};

function depsFromAdapter(adapter: FakeLamplightAdapter): ConnectionDiscoveryDeps {
  return {
    hasNoteEmbedding: (id) => adapter.hasNoteEmbedding(id),
    getConnectionNeighbors: (id, k, sim) => adapter.getConnectionNeighbors(id, k, sim),
    loadNeighborNotes: async (ids) => ids.map((id) => fakeNote({ id, title: `Note ${id}` })),
  };
}

describe('ConnectionDiscovery', () => {
  it('emits inactive (note_too_short) without touching the adapter', async () => {
    const c = new ConnectionDiscovery(depsFromAdapter(new FakeLamplightAdapter()), 'full');
    c.setInputs({ ...INPUTS, activeNote: fakeNote({ content: makeContent('too short') }) });
    await tick();
    expect(c.getSnapshot()).toEqual({ phase: 'inactive', reason: 'note_too_short', meetsDepth: false, meetsVault: true });
  });

  it('emits waiting_for_embedding when the note has no embedding', async () => {
    const c = new ConnectionDiscovery(depsFromAdapter(new FakeLamplightAdapter()), 'full');
    c.setInputs(INPUTS);
    await tick();
    expect(c.getSnapshot()).toEqual({ phase: 'waiting_for_embedding' });
  });

  it('emits no_connections when the embedded note has zero neighbors', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedNoteEmbedding('note-1');
    const c = new ConnectionDiscovery(depsFromAdapter(adapter), 'full');
    c.setInputs(INPUTS);
    await tick();
    expect(c.getSnapshot()).toEqual({ phase: 'no_connections' });
  });

  it('full mode assembles cards (title fallback + signal caps)', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedNoteEmbedding('note-1');
    adapter.__seedConnectionNeighbors('note-1', [{ relatedNoteId: 'note-2', similarity: 0.95 }]);
    const c = new ConnectionDiscovery(depsFromAdapter(adapter), 'full');
    c.setInputs(INPUTS);
    await tick();
    const state = c.getSnapshot();
    expect(state.phase).toBe('ready');
    if (state.phase !== 'ready') throw new Error('expected ready');
    expect(state.cards).toEqual([
      { relatedNoteId: 'note-2', relatedNoteTitle: 'Note note-2', similarity: 0.95, sharedTags: [], sharedVerseRefs: [] },
    ]);
  });

  it('presence mode stops at the neighbor count without loading notes', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedNoteEmbedding('note-1');
    adapter.__seedConnectionNeighbors('note-1', [
      { relatedNoteId: 'note-2', similarity: 0.95 },
      { relatedNoteId: 'note-3', similarity: 0.9 },
    ]);
    let loadCalls = 0;
    const deps: ConnectionDiscoveryDeps = {
      ...depsFromAdapter(adapter),
      loadNeighborNotes: async (ids) => { loadCalls++; return ids.map((id) => fakeNote({ id })); },
    };
    const c = new ConnectionDiscovery(deps, 'presence');
    c.setInputs(INPUTS);
    await tick();
    expect(c.getSnapshot()).toEqual({ phase: 'present', count: 2 });
    expect(loadCalls).toBe(0);
  });

  it('maps a neighbor-fetch failure to error/network', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedNoteEmbedding('note-1');
    adapter.__failNextGetConnectionNeighbors();
    const c = new ConnectionDiscovery(depsFromAdapter(adapter), 'full');
    c.setInputs(INPUTS);
    await tick();
    expect(c.getSnapshot()).toEqual({ phase: 'error', reason: 'network' });
  });

  it('fences a stale run: a second setInputs wins even if the first resolves later', async () => {
    let releaseFirst!: (v: ConnectionNeighbor[]) => void;
    const firstNeighbors = new Promise<ConnectionNeighbor[]>((res) => { releaseFirst = res; });
    let call = 0;
    const deps: ConnectionDiscoveryDeps = {
      hasNoteEmbedding: async () => true,
      getConnectionNeighbors: (_id, _k, _sim) => {
        call++;
        // First run blocks on the deferred promise; second run resolves immediately.
        return call === 1 ? firstNeighbors : Promise.resolve([{ relatedNoteId: 'fresh', similarity: 0.99 }]);
      },
      loadNeighborNotes: async (ids) => ids.map((id) => fakeNote({ id, title: `Note ${id}` })),
    };
    const c = new ConnectionDiscovery(deps, 'full');

    c.setInputs(INPUTS);                 // first run: blocks on firstNeighbors
    await tick();
    c.setInputs(INPUTS);                 // second run: bumps generation, resolves fast
    await tick();
    releaseFirst([{ relatedNoteId: 'stale', similarity: 0.1 }]); // late resolve from run 1
    await tick();

    const state = c.getSnapshot();
    if (state.phase !== 'ready') throw new Error('expected ready');
    expect(state.cards.map((card) => card.relatedNoteId)).toEqual(['fresh']);
  });

  it('parks inactive when the active note is null (nullable-adapter park)', async () => {
    const c = new ConnectionDiscovery(depsFromAdapter(new FakeLamplightAdapter()), 'presence');
    c.setInputs({ ...INPUTS, activeNote: null });
    await tick();
    expect(c.getSnapshot()).toEqual({ phase: 'inactive', reason: 'no_active_note', meetsDepth: false, meetsVault: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/connection-cards/connection-discovery.test.ts`
Expected: FAIL — `Failed to resolve import "./connection-discovery"`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/connection-cards/connection-discovery.ts`:

```ts
import { Observable } from '../collection/observable';
import { extractTextFromNote } from '../utils/tiptap-text';
import {
  computeSharedSignals as defaultComputeSharedSignals,
  type SharedSignals,
} from '../utils/connection-signals';
import { decideConnectionQualification, type QualificationReason } from './connection-qualification';
import type { ConnectionNeighbor } from '../storage/lamplight-adapter';
import type { Note } from '../types';

export interface ConnectionCard {
  relatedNoteId: string;
  relatedNoteTitle: string;
  similarity: number;
  sharedTags: string[];
  sharedVerseRefs: string[];
}

export type ConnectionDiscoveryState =
  | { phase: 'inactive'; reason: QualificationReason; meetsDepth: boolean; meetsVault: boolean }
  | { phase: 'waiting_for_embedding' }
  | { phase: 'no_connections' }
  | { phase: 'present'; count: number }
  | { phase: 'ready'; cards: ConnectionCard[] }
  | { phase: 'error'; reason: 'network' };

export type DiscoveryMode = 'presence' | 'full';

export interface ConnectionDiscoveryDeps {
  hasNoteEmbedding: (noteId: string) => Promise<boolean>;
  getConnectionNeighbors: (
    sourceNoteId: string,
    k: number,
    minSimilarity: number,
  ) => Promise<ConnectionNeighbor[]>;
  loadNeighborNotes: (ids: string[]) => Promise<Note[]>;
  computeSharedSignals?: (active: Note, related: Note) => SharedSignals;
}

export interface ConnectionDiscoveryInputs {
  activeNote: Note | null;
  totalNoteCount: number;
  minWords: number;
  minVaultSize: number;
  minSimilarity: number;
  maxRenderedCards: number;
  neighborK: number;
}

const INACTIVE_INITIAL: ConnectionDiscoveryState = {
  phase: 'inactive',
  reason: 'no_active_note',
  meetsDepth: false,
  meetsVault: false,
};

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export class ConnectionDiscovery extends Observable<ConnectionDiscoveryState> {
  private readonly deps: ConnectionDiscoveryDeps;
  private readonly mode: DiscoveryMode;
  private readonly computeSignals: (active: Note, related: Note) => SharedSignals;
  private generation = 0;

  constructor(deps: ConnectionDiscoveryDeps, mode: DiscoveryMode) {
    super(INACTIVE_INITIAL);
    this.deps = deps;
    this.mode = mode;
    this.computeSignals = deps.computeSharedSignals ?? defaultComputeSharedSignals;
  }

  setInputs(inputs: ConnectionDiscoveryInputs): void {
    const gen = ++this.generation;
    void this.run(gen, inputs);
  }

  /** Bumps the generation so any in-flight run's late resolves are dropped. */
  dispose(): void {
    this.generation++;
  }

  private isStale(gen: number): boolean {
    return gen !== this.generation;
  }

  private emit(gen: number, next: ConnectionDiscoveryState): void {
    if (this.isStale(gen)) return;
    this.setState(() => next);
  }

  private async run(gen: number, inputs: ConnectionDiscoveryInputs): Promise<void> {
    const { activeNote, totalNoteCount, minWords, minVaultSize, minSimilarity, maxRenderedCards, neighborK } = inputs;

    const wordCount = activeNote ? countWords(extractTextFromNote(activeNote)) : 0;
    const gate = decideConnectionQualification({
      hasActiveNote: activeNote !== null,
      wordCount,
      totalNoteCount,
      minWords,
      minVaultSize,
    });
    if (!gate.qualified) {
      this.emit(gen, {
        phase: 'inactive',
        reason: gate.reason,
        meetsDepth: gate.meetsDepth,
        meetsVault: gate.meetsVault,
      });
      return;
    }
    const note = activeNote as Note; // qualified ⇒ non-null

    const hasEmbedding = await this.deps.hasNoteEmbedding(note.id);
    if (this.isStale(gen)) return;
    if (!hasEmbedding) {
      this.emit(gen, { phase: 'waiting_for_embedding' });
      return;
    }

    let neighbors: ConnectionNeighbor[];
    try {
      neighbors = await this.deps.getConnectionNeighbors(note.id, neighborK, minSimilarity);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    if (neighbors.length === 0) {
      this.emit(gen, { phase: 'no_connections' });
      return;
    }

    if (this.mode === 'presence') {
      this.emit(gen, { phase: 'present', count: neighbors.length });
      return;
    }

    let neighborNotes: Note[];
    try {
      neighborNotes = await this.deps.loadNeighborNotes(neighbors.map((n) => n.relatedNoteId));
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    const byId = new Map(neighborNotes.map((n) => [n.id, n]));

    const cards: ConnectionCard[] = neighbors.slice(0, maxRenderedCards).map((n) => {
      const neighborNote = byId.get(n.relatedNoteId);
      const signals = neighborNote
        ? this.computeSignals(note, neighborNote)
        : { sharedTags: [], sharedVerseRefs: [] };
      return {
        relatedNoteId: n.relatedNoteId,
        relatedNoteTitle: neighborNote?.title?.trim() || '(untitled)',
        similarity: n.similarity,
        sharedTags: signals.sharedTags.slice(0, 3),
        sharedVerseRefs: signals.sharedVerseRefs.slice(0, 3),
      };
    });
    this.emit(gen, { phase: 'ready', cards });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/connection-cards/connection-discovery.test.ts`
Expected: PASS (8 passing).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/connection-cards/connection-discovery.ts src/notepad/connection-cards/connection-discovery.test.ts
git commit -m "feat(connection-cards): ConnectionDiscovery observable controller with presence/full modes + fencing"
```

---

### Task 3: `useConnectionDiscovery` hook

Thin React wrapper: `useMemo` the controller, `useSyncExternalStore` its snapshot, forward inputs via `setInputs` in a `useEffect`, dispose on unmount. Mirrors `useMigrationWorkflow`. No dedicated test — the controller carries the logic tests; the stack test (Task 7) and the useHasConnections test (Task 8) exercise this glue end-to-end.

**Files:**
- Create: `src/notepad/hooks/useConnectionDiscovery.ts`

- [ ] **Step 1: Write the implementation**

Create `src/notepad/hooks/useConnectionDiscovery.ts`:

```ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ConnectionDiscovery,
  type ConnectionDiscoveryDeps,
  type ConnectionDiscoveryState,
  type DiscoveryMode,
} from '../connection-cards/connection-discovery';
import type { LamplightAdapter } from '../storage/lamplight-adapter';
import type { Note } from '../types';

const NEIGHBOR_K = 5;

export interface UseConnectionDiscoveryArgs {
  adapter: LamplightAdapter | null;
  activeNote: Note | null;
  totalNoteCount: number;
  loadNeighborNotes: (ids: string[]) => Promise<Note[]>;
  mode: DiscoveryMode;
  qualifyingMinWords?: number;
  qualifyingMinVaultSize?: number;
  qualifyingMinSimilarity?: number;
  maxRenderedCards?: number;
}

export interface UseConnectionDiscoveryResult {
  state: ConnectionDiscoveryState;
  retry: () => void;
}

export function useConnectionDiscovery({
  adapter,
  activeNote,
  totalNoteCount,
  loadNeighborNotes,
  mode,
  qualifyingMinWords = 10,
  qualifyingMinVaultSize = 2,
  qualifyingMinSimilarity = 0.78,
  maxRenderedCards = 3,
}: UseConnectionDiscoveryArgs): UseConnectionDiscoveryResult {
  // Captured via ref so an unstable inline loadNeighborNotes doesn't recreate the controller.
  const loadRef = useRef(loadNeighborNotes);
  loadRef.current = loadNeighborNotes;

  const controller = useMemo(() => {
    const deps: ConnectionDiscoveryDeps = {
      hasNoteEmbedding: (id) => adapter!.hasNoteEmbedding(id),
      getConnectionNeighbors: (id, k, sim) => adapter!.getConnectionNeighbors(id, k, sim),
      loadNeighborNotes: (ids) => loadRef.current(ids),
    };
    return new ConnectionDiscovery(deps, mode);
  }, [adapter, mode]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    controller.setInputs({
      // When the adapter is absent, park inactive by passing a null active note;
      // the gate short-circuits before any adapter call.
      activeNote: adapter ? activeNote : null,
      totalNoteCount,
      minWords: qualifyingMinWords,
      minVaultSize: qualifyingMinVaultSize,
      minSimilarity: qualifyingMinSimilarity,
      maxRenderedCards,
      neighborK: NEIGHBOR_K,
    });
  }, [
    controller,
    adapter,
    activeNote,
    totalNoteCount,
    qualifyingMinWords,
    qualifyingMinVaultSize,
    qualifyingMinSimilarity,
    maxRenderedCards,
    retryNonce,
  ]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { state, retry: () => setRetryNonce((n) => n + 1) };
}
```

- [ ] **Step 2: Verify it type-checks (no test yet)**

Run: `npx tsc -b`
Expected: PASS (no errors). The hook is unused so far; that is fine.

- [ ] **Step 3: Commit**

```bash
git add src/notepad/hooks/useConnectionDiscovery.ts
git commit -m "feat(connection-cards): useConnectionDiscovery hook wrapping the controller"
```

---

### Task 4: `ConnectionWhy` Observable controller

The per-card why-explanation lifecycle, split out of the old hook's `expandCard`/`retryWhy`. Owns a `Record<relatedNoteId, ConnectionCardWhyState>`; node-tested with a fake adapter.

**Files:**
- Create: `src/notepad/connection-cards/connection-why.ts`
- Test: `src/notepad/connection-cards/connection-why.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/notepad/connection-cards/connection-why.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ConnectionWhy } from './connection-why';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function controllerFor(adapter: FakeLamplightAdapter) {
  return new ConnectionWhy(
    { generateConnectionWhy: (src, rel) => adapter.generateConnectionWhy(src, rel) },
    'note-1',
  );
}

describe('ConnectionWhy', () => {
  it('defaults each card to collapsed', () => {
    const c = controllerFor(new FakeLamplightAdapter());
    expect(c.whyState('note-2')).toEqual({ phase: 'collapsed' });
  });

  it('expand resolves to shown with cached flag', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedConnectionWhy('note-1', 'note-2', 'Both circle the same wilderness motif.');
    const c = controllerFor(adapter);
    await c.expand('note-2');
    expect(c.whyState('note-2')).toEqual({
      phase: 'shown',
      text: 'Both circle the same wilderness motif.',
      cached: true,
    });
  });

  it('passes through loading before shown', async () => {
    const c = controllerFor(new FakeLamplightAdapter());
    const p = c.expand('note-2');
    expect(c.whyState('note-2')).toEqual({ phase: 'loading' });
    await p;
    expect(c.whyState('note-2').phase).toBe('shown');
  });

  it('maps validators_failed to error/validators_failed', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__failNextGenerateConnectionWhy('validators_failed');
    const c = controllerFor(adapter);
    await c.expand('note-2');
    expect(c.whyState('note-2')).toEqual({ phase: 'error', reason: 'validators_failed' });
  });

  it('maps any other !ok reason to error/network', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__failNextGenerateConnectionWhy('not_neighbor');
    const c = controllerFor(adapter);
    await c.expand('note-2');
    expect(c.whyState('note-2')).toEqual({ phase: 'error', reason: 'network' });
  });

  it('maps a thrown adapter call to error/network', async () => {
    const c = new ConnectionWhy(
      { generateConnectionWhy: async () => { throw new Error('boom'); } },
      'note-1',
    );
    await c.expand('note-2');
    expect(c.whyState('note-2')).toEqual({ phase: 'error', reason: 'network' });
  });

  it('retry re-runs expand for the card', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__failNextGenerateConnectionWhy('network');
    const c = controllerFor(adapter);
    await c.retry('note-2');
    expect(c.whyState('note-2')).toEqual({ phase: 'error', reason: 'network' });
    await c.retry('note-2'); // no failure queued now ⇒ succeeds
    expect(c.whyState('note-2').phase).toBe('shown');
  });

  it('notifies subscribers on state changes', async () => {
    const c = controllerFor(new FakeLamplightAdapter());
    let count = 0;
    c.subscribe(() => { count++; });
    await c.expand('note-2'); // loading + shown ⇒ at least 2 notifications
    expect(count).toBeGreaterThanOrEqual(2);
    await tick();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/connection-cards/connection-why.test.ts`
Expected: FAIL — `Failed to resolve import "./connection-why"`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/connection-cards/connection-why.ts`:

```ts
import { Observable } from '../collection/observable';
import type { ConnectionWhyResult } from '../storage/lamplight-adapter';

export interface ConnectionCardWhyState {
  phase: 'collapsed' | 'loading' | 'shown' | 'error';
  text?: string;
  cached?: boolean;
  reason?: 'validators_failed' | 'network';
}

export interface ConnectionWhyDeps {
  generateConnectionWhy: (sourceNoteId: string, relatedNoteId: string) => Promise<ConnectionWhyResult>;
}

type WhyMap = Record<string, ConnectionCardWhyState>;

const COLLAPSED: ConnectionCardWhyState = { phase: 'collapsed' };

export class ConnectionWhy extends Observable<WhyMap> {
  private readonly deps: ConnectionWhyDeps;
  private readonly sourceNoteId: string;

  constructor(deps: ConnectionWhyDeps, sourceNoteId: string) {
    super({});
    this.deps = deps;
    this.sourceNoteId = sourceNoteId;
  }

  whyState(relatedNoteId: string): ConnectionCardWhyState {
    return this.getSnapshot()[relatedNoteId] ?? COLLAPSED;
  }

  private set(relatedNoteId: string, next: ConnectionCardWhyState): void {
    this.setState((prev) => ({ ...prev, [relatedNoteId]: next }));
  }

  expand = async (relatedNoteId: string): Promise<void> => {
    this.set(relatedNoteId, { phase: 'loading' });
    let result: ConnectionWhyResult;
    try {
      result = await this.deps.generateConnectionWhy(this.sourceNoteId, relatedNoteId);
    } catch {
      this.set(relatedNoteId, { phase: 'error', reason: 'network' });
      return;
    }
    if (result.ok) {
      this.set(relatedNoteId, { phase: 'shown', text: result.why, cached: result.cached });
    } else {
      const reason = result.reason === 'validators_failed' ? 'validators_failed' : 'network';
      this.set(relatedNoteId, { phase: 'error', reason });
    }
  };

  retry = (relatedNoteId: string): Promise<void> => this.expand(relatedNoteId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/connection-cards/connection-why.test.ts`
Expected: PASS (8 passing).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/connection-cards/connection-why.ts src/notepad/connection-cards/connection-why.test.ts
git commit -m "feat(connection-cards): ConnectionWhy controller for per-card explanations"
```

---

### Task 5: `useConnectionWhy` hook

Thin wrapper: `useMemo` the controller keyed on `sourceNoteId` (a new active note gets a fresh why map), subscribe to the map, expose `whyState`/`expand`/`retry`.

**Files:**
- Create: `src/notepad/hooks/useConnectionWhy.ts`

- [ ] **Step 1: Write the implementation**

Create `src/notepad/hooks/useConnectionWhy.ts`:

```ts
import { useMemo, useRef, useSyncExternalStore } from 'react';
import {
  ConnectionWhy,
  type ConnectionWhyDeps,
  type ConnectionCardWhyState,
} from '../connection-cards/connection-why';
import type { LamplightAdapter } from '../storage/lamplight-adapter';

const COLLAPSED: ConnectionCardWhyState = { phase: 'collapsed' };

export interface UseConnectionWhyArgs {
  adapter: LamplightAdapter;
  sourceNoteId: string | null;
}

export interface UseConnectionWhyResult {
  whyState: (relatedNoteId: string) => ConnectionCardWhyState;
  expand: (relatedNoteId: string) => Promise<void>;
  retry: (relatedNoteId: string) => Promise<void>;
}

export function useConnectionWhy({ adapter, sourceNoteId }: UseConnectionWhyArgs): UseConnectionWhyResult {
  // Captured via ref so the controller isn't recreated when the adapter identity churns.
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const controller = useMemo(() => {
    const deps: ConnectionWhyDeps = {
      generateConnectionWhy: (src, rel) => adapterRef.current.generateConnectionWhy(src, rel),
    };
    return new ConnectionWhy(deps, sourceNoteId ?? '');
  }, [sourceNoteId]);

  const map = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  return {
    whyState: (relatedNoteId) => map[relatedNoteId] ?? COLLAPSED,
    expand: controller.expand,
    retry: controller.retry,
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/notepad/hooks/useConnectionWhy.ts
git commit -m "feat(connection-cards): useConnectionWhy hook wrapping the controller"
```

---

### Task 6: Point `ConnectionCardsEmpty` at the new state type

`ConnectionCardsEmpty` consumes the empty (non-`ready`) phases. Re-target its imported state type to `ConnectionDiscoveryState` and exclude the new `present` phase too. The empty-phase shapes (`inactive`/`waiting_for_embedding`/`no_connections`/`error`) are structurally identical to the old ones, so the component body needs no change.

**Files:**
- Modify: `src/notepad/components/lamplight/ConnectionCardsEmpty.tsx:9` (the type import + `EmptyState` alias)

- [ ] **Step 1: Update the import and the `EmptyState` alias**

Replace:

```ts
import type { ConnectionCardsState } from '../../hooks/useConnectionCards';

type EmptyState = Exclude<ConnectionCardsState, { phase: 'ready' }>;
```

with:

```ts
import type { ConnectionDiscoveryState } from '../../connection-cards/connection-discovery';

type EmptyState = Exclude<ConnectionDiscoveryState, { phase: 'ready' } | { phase: 'present' }>;
```

- [ ] **Step 2: Run the existing empty-state test + type-check**

Run: `npx vitest run src/notepad/components/lamplight/ConnectionCardsEmpty.test.tsx && npx tsc -b`
Expected: PASS. (The component renders the same phases; only the type source changed.)

- [ ] **Step 3: Commit**

```bash
git add src/notepad/components/lamplight/ConnectionCardsEmpty.tsx
git commit -m "refactor(connection-cards): ConnectionCardsEmpty reads ConnectionDiscoveryState"
```

---

### Task 7: Rewire `ConnectionCardsPanel` to compose the two hooks

The panel switches from the monolithic `useConnectionCards` to `useConnectionDiscovery({ mode: 'full' })` for the cards plus `useConnectionWhy` for per-card explanations. Behavior is preserved — the integration safety net is `ConnectionCardsPanel.stack.test.tsx`, which must stay green.

**Files:**
- Modify: `src/notepad/components/lamplight/ConnectionCardsPanel.tsx`

- [ ] **Step 1: Swap the hook imports**

Replace:

```ts
import { useConnectionCards } from '../../hooks/useConnectionCards';
```

with:

```ts
import { useConnectionDiscovery } from '../../hooks/useConnectionDiscovery';
import { useConnectionWhy } from '../../hooks/useConnectionWhy';
```

- [ ] **Step 2: Replace the hook call (lines ~54-61) and drop the unused `userId` destructure**

In the component signature destructure, remove `userId` (keep it in `ConnectionCardsPanelProps` — callers still pass it). The destructure becomes:

```tsx
export function ConnectionCardsPanel({
  adapter,
  activeNote,
  totalNoteCount,
  loadNeighborNotes,
  onOpenNote,
  showEmptyStates = false,
  layout = 'strip',
}: ConnectionCardsPanelProps) {
```

Replace the `const { state, expandCard, retryWhy, retry } = useConnectionCards({...});` block with:

```tsx
  const { state, retry } = useConnectionDiscovery({
    adapter,
    activeNote,
    totalNoteCount,
    loadNeighborNotes,
    mode: 'full',
    qualifyingMinSimilarity: minSimilarity,
  });
  const { whyState, expand, retry: retryWhy } = useConnectionWhy({
    adapter,
    sourceNoteId: activeNote?.id ?? null,
  });
```

- [ ] **Step 3: Update the non-ready guard to handle the (unreachable-in-full-mode) `present` phase**

Replace:

```tsx
  if (state.phase !== 'ready') {
    if (showEmptyStates) {
      return <ConnectionCardsEmpty state={state} onRetry={retry} />;
    }
    return null;
  }
```

with:

```tsx
  if (state.phase !== 'ready') {
    // 'present' is a presence-mode-only phase; full mode never emits it.
    if (state.phase === 'present') return null;
    if (showEmptyStates) {
      return <ConnectionCardsEmpty state={state} onRetry={retry} />;
    }
    return null;
  }
```

- [ ] **Step 4: Read the why from `whyState` instead of `card.why`**

In `handleChipClick`, replace:

```tsx
    const card = cards.find((c) => c.relatedNoteId === relatedNoteId);
    if (card && card.why.phase === 'collapsed') {
      await expandCard(relatedNoteId);
    }
```

with:

```tsx
    if (whyState(relatedNoteId).phase === 'collapsed') {
      await expand(relatedNoteId);
    }
```

In `renderWhy`, replace the first line's reliance on `card.why` by deriving the why at the top of the function. Change the signature body from using `card.why` to:

```tsx
  const renderWhy = (card: typeof cards[number]) => {
    const why = whyState(card.relatedNoteId);
    if (why.phase === 'loading') {
```

and within `renderWhy` replace every remaining `card.why.` with `why.` (there are three: `card.why.phase === 'shown'`, `card.why.text`, `card.why.cached`, and `card.why.phase === 'error'`). The `retryWhy(card.relatedNoteId)` call in the error branch stays as-is (now bound to `useConnectionWhy`'s `retry`).

- [ ] **Step 5: Run the integration safety net + type-check**

Run: `npx vitest run src/notepad/components/lamplight/ConnectionCardsPanel.stack.test.tsx && npx tsc -b`
Expected: PASS (all stack-layout cases green — cards render, why expands to the seeded text, footer hint toggles).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/components/lamplight/ConnectionCardsPanel.tsx
git commit -m "refactor(connection-cards): ConnectionCardsPanel composes ConnectionDiscovery + ConnectionWhy"
```

---

### Task 8: Rewire `useHasConnections` to presence mode + update its test

The mobile glow-dot uses `mode: 'presence'`, reads `state.phase === 'present'`, and drops the faked-`{}`-adapter hack (the controller parks on a null adapter).

**Files:**
- Modify: `src/components/sections/notepad/mobile/useHasConnections.ts`
- Modify: `src/components/sections/notepad/mobile/useHasConnections.test.tsx`

- [ ] **Step 1: Rewrite the test to mock `useConnectionDiscovery`**

Replace the entire contents of `src/components/sections/notepad/mobile/useHasConnections.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the underlying hook so this stays a pure unit of the wrapper logic.
vi.mock('../../../../notepad/hooks/useConnectionDiscovery', () => ({
  useConnectionDiscovery: vi.fn(),
}));
import { useConnectionDiscovery } from '../../../../notepad/hooks/useConnectionDiscovery';
import { useHasConnections } from './useHasConnections';

afterEach(cleanup);

const baseArgs = {
  adapter: {} as never,
  userId: 'u1',
  activeNote: { id: 'n1' } as never,
  totalNoteCount: 5,
  loadNeighborNotes: async () => [],
};

function Probe() {
  const has = useHasConnections(baseArgs);
  return <div data-testid="has">{String(has)}</div>;
}

describe('useHasConnections', () => {
  it('is true when discovery is in the present phase', () => {
    vi.mocked(useConnectionDiscovery).mockReturnValue({
      state: { phase: 'present', count: 2 } as never,
      retry: vi.fn(),
    });
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('has').textContent).toBe('true');
  });

  it('is false for any non-present phase', () => {
    vi.mocked(useConnectionDiscovery).mockReturnValue({
      state: { phase: 'no_connections' } as never,
      retry: vi.fn(),
    });
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('has').textContent).toBe('false');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/notepad/mobile/useHasConnections.test.tsx`
Expected: FAIL — `useHasConnections` still imports `useConnectionCards` and returns based on `phase === 'ready'`, so the mock of `useConnectionDiscovery` is never consulted (the real `useConnectionCards` runs, returning `inactive`).

- [ ] **Step 3: Rewrite `useHasConnections.ts`**

Replace the entire contents of `src/components/sections/notepad/mobile/useHasConnections.ts` with:

```ts
import { useConnectionDiscovery } from '../../../../notepad/hooks/useConnectionDiscovery';
import type { LamplightAdapter } from '../../../../notepad/storage/lamplight-adapter';
import type { Note } from '../../../../notepad/types';

export interface UseHasConnectionsArgs {
  adapter: LamplightAdapter | null;
  userId: string | null;
  activeNote: Note | null;
  totalNoteCount: number;
  loadNeighborNotes: (ids: string[]) => Promise<Note[]>;
}

/**
 * True when the active note has at least one qualifying Lamplight connection.
 * Drives the bottom-bar Lamplight glow-dot. Runs the cheap 'presence' discovery
 * mode, which stops at the neighbor count and never loads neighbor notes.
 * Safe no-op when adapter/user absent: useConnectionDiscovery parks inactive on
 * a null adapter.
 */
export function useHasConnections({
  adapter,
  activeNote,
  totalNoteCount,
  loadNeighborNotes,
}: UseHasConnectionsArgs): boolean {
  const { state } = useConnectionDiscovery({
    adapter,
    activeNote,
    totalNoteCount,
    loadNeighborNotes,
    mode: 'presence',
  });
  return state.phase === 'present';
}
```

Note: `userId` stays in `UseHasConnectionsArgs` (callers untouched) but is intentionally not destructured/used — the discovery hook handles the null-adapter park.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/notepad/mobile/useHasConnections.test.tsx && npx tsc -b`
Expected: PASS (2 passing), type-check clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/notepad/mobile/useHasConnections.ts src/components/sections/notepad/mobile/useHasConnections.test.tsx
git commit -m "refactor(connection-cards): useHasConnections uses presence-mode discovery"
```

---

### Task 9: Delete the old `useConnectionCards`, run the full suite + build

With all three consumers rewired, the monolithic hook and its React-harness test are dead. Remove them and verify the whole project is green.

**Files:**
- Delete: `src/notepad/hooks/useConnectionCards.ts`
- Delete: `src/notepad/hooks/useConnectionCards.test.tsx`

- [ ] **Step 1: Confirm there are no remaining references**

Run: `grep -rn "useConnectionCards\|ConnectionCardsState\b" src --include='*.ts' --include='*.tsx'`
Expected: NO matches. (If any appear, they are leftover imports — fix them before deleting.)

- [ ] **Step 2: Delete the old files**

```bash
git rm src/notepad/hooks/useConnectionCards.ts src/notepad/hooks/useConnectionCards.test.tsx
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — entire suite green, including `ConnectionCardsPanel.stack.test.tsx`, `ConnectionCardsEmpty.test.tsx`, `ConnectionCardsStrip.test.tsx`, the new `connection-qualification`/`connection-discovery`/`connection-why` tests, and the rewritten `useHasConnections` test.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: PASS (`tsc -b` clean, `vite build` succeeds).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(connection-cards): remove monolithic useConnectionCards (replaced by ConnectionDiscovery + ConnectionWhy)"
```

---

## Self-Review notes (for the implementer)

- **Type consistency:** the state phase added by this plan is `present` (carrying `count: number`); it is excluded in `ConnectionCardsEmpty` and early-returned in the panel. `ConnectionCard` no longer carries a `why` field — the panel reads `whyState(card.relatedNoteId)` instead. `ConnectionCardWhyState` now lives in `connection-why.ts`.
- **Hook return shapes:** `useConnectionDiscovery → { state, retry }`; `useConnectionWhy → { whyState, expand, retry }`. The panel aliases the why hook's `retry` to `retryWhy` to avoid colliding with discovery's `retry`.
- **Default thresholds** live on `useConnectionDiscovery` (10 / 2 / 0.78 / 3) and `NEIGHBOR_K = 5`, matching the old hook exactly. The panel forwards `qualifyingMinSimilarity: minSimilarity` (undefined while the server-threshold fetch is in flight → falls back to 0.78).
- **No new tsconfig wiring:** the new `.test.ts` files run in the default `node` env and import no `node:fs`, so they do not need to move to `tsconfig.node.json` (unlike the moodboard asset/aspect tests).
- **CONTEXT.md** already documents `ConnectionDiscovery` and `ConnectionWhy`; no doc edit is part of this plan.
