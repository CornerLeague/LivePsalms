// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

afterEach(cleanup);

const spy = vi.hoisted(() => ({
  deps: null as null | { onNodeTap: (n: { id: string; type: string; title: string }) => boolean },
  focusCalls: [] as Array<string | null>,
  modeCalls: [] as string[],
}));

beforeEach(() => {
  spy.deps = null;
  spy.focusCalls = [];
  spy.modeCalls = [];
});

vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNoteId: null, collection: { openNote: vi.fn() } }),
}));

vi.mock('@/notepad/context/useReferenceGraph', () => ({
  useReferenceGraph: () => ({ references: [], scriptureNodes: [], graph: { getNeighborhood: vi.fn() } }),
}));

vi.mock('@/notepad/context/useFolderHierarchy', () => ({
  useFolderHierarchy: () => ({ folders: [] }),
}));

vi.mock('@/notepad/graph/project-graph', () => ({
  projectGraph: () => ({ nodes: [], edges: [] }),
}));

vi.mock('@/notepad/graph/graph-view', () => {
  const SNAPSHOT = { popover: null };
  class GraphView {
    constructor(deps: never) { spy.deps = deps; }
    subscribe = () => () => {};
    getSnapshot = () => SNAPSHOT;
    attach() {}
    detach() {}
    setNeighborhoodFn() {}
    setData() {}
    setMode(m: string) { spy.modeCalls.push(m); }
    setFilters() {}
    setSettings() {}
    setFocus(id: string | null) { spy.focusCalls.push(id); }
    handleMouseMove() {}
    handleMouseDown() {}
    handleMouseUp() {}
  }
  return {
    GraphView,
    DEFAULT_FILTERS: { scripture: true, sermon: true, devotion: true, theme: true },
    DEFAULT_SETTINGS: { depth: 1, nodeSize: 1, edgeThickness: 1, linkDistance: 100, linkForce: 0.005, repelForce: 500 },
  };
});

import { GraphPane } from './GraphPane';

describe('GraphPane', () => {
  it('hides itself below the md breakpoint in the desktop sidebar context', () => {
    render(<GraphPane graphOpen />);
    expect(screen.getByRole('complementary').classList.contains('hidden')).toBe(true);
  });

  it('renders visibly (no md-hide) when embedded, e.g. the mobile More sheet', () => {
    render(<GraphPane graphOpen embedded />);
    const aside = screen.getByRole('complementary');
    expect(aside.classList.contains('hidden')).toBe(false);
    expect(aside.classList.contains('flex')).toBe(true);
  });

  it('embedded: a node tap is routed to onNodePeek and reports handled', () => {
    const onNodePeek = vi.fn();
    render(<GraphPane graphOpen embedded onNodePeek={onNodePeek} />);
    const handled = spy.deps!.onNodeTap({ id: 'a', type: 'devotion', title: 'A' });
    expect(onNodePeek).toHaveBeenCalledWith({ id: 'a', type: 'devotion', title: 'A' });
    expect(handled).toBe(true);
  });

  it('non-embedded: onNodeTap returns false so default behavior runs', () => {
    render(<GraphPane graphOpen />);
    expect(spy.deps!.onNodeTap({ id: 'a', type: 'devotion', title: 'A' })).toBe(false);
  });

  it('embedded: a re-rendered onNodePeek is seen without recreating the view', () => {
    const first = vi.fn(), second = vi.fn();
    const { rerender } = render(<GraphPane graphOpen embedded onNodePeek={first} />);
    rerender(<GraphPane graphOpen embedded onNodePeek={second} />);
    spy.deps!.onNodeTap({ id: 'a', type: 'devotion', title: 'A' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('embedded: focusNodeId drives setFocus + local mode', () => {
    const { rerender } = render(<GraphPane graphOpen embedded focusNodeId={null} />);
    rerender(<GraphPane graphOpen embedded focusNodeId="scripture:x" />);
    expect(spy.focusCalls).toContain('scripture:x');
    expect(spy.modeCalls).toContain('local');
  });
});
