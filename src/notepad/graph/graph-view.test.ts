import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphView, DEFAULT_SETTINGS } from './graph-view';
import type { GraphViewDeps } from './graph-view';
import type { GraphEdge, GraphNode } from './types';

// ---------------------------------------------------------------------------
// DOM fakes — small enough to paste; reused by all GraphView tests.
// ---------------------------------------------------------------------------

class MockContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign: 'start' | 'end' | 'left' | 'right' | 'center' = 'start';
  calls: { method: string; args: unknown[] }[] = [];
  private rec(method: string, ...args: unknown[]) { this.calls.push({ method, args }); }
  clearRect(...a: unknown[]) { this.rec('clearRect', ...a); }
  save() { this.rec('save'); }
  restore() { this.rec('restore'); }
  setTransform(...a: unknown[]) { this.rec('setTransform', ...a); }
  beginPath() { this.rec('beginPath'); }
  arc(...a: unknown[]) { this.rec('arc', ...a); }
  moveTo(...a: unknown[]) { this.rec('moveTo', ...a); }
  lineTo(...a: unknown[]) { this.rec('lineTo', ...a); }
  stroke() { this.rec('stroke', { strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha }); }
  fill() { this.rec('fill'); }
  fillText(...a: unknown[]) { this.rec('fillText', ...a); }
  measureText(s: string) { return { width: s.length * 6 } as unknown as TextMetrics; }
}

class MockCanvas {
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  ctx = new MockContext();
  private listeners = new Map<string, Array<(e: unknown) => void>>();
  private rect = { left: 0, top: 0, width: 400, height: 400 };
  setRect(width: number, height: number, left = 0, top = 0) {
    this.rect = { left, top, width, height };
  }
  getContext(type: string) { return type === '2d' ? this.ctx : null; }
  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) };
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(cb);
  }
  removeEventListener(type: string, cb: (e: unknown) => void) {
    const arr = this.listeners.get(type);
    if (arr) this.listeners.set(type, arr.filter((c) => c !== cb));
  }
  dispatch(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((cb) => cb(event));
  }
}

class MockContainer {
  private rect: { width: number; height: number };
  constructor(width = 400, height = 400) { this.rect = { width, height }; }
  setSize(w: number, h: number) { this.rect = { width: w, height: h }; }
  getBoundingClientRect() {
    const { width, height } = this.rect;
    return { left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  }
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; MockResizeObserver.instances.push(this); }
  observe(_t: Element) {}
  unobserve(_t: Element) {}
  disconnect() {}
  trigger() { this.cb([], this as unknown as ResizeObserver); }
}

function makeDeps(over: Partial<GraphViewDeps> = {}): { deps: GraphViewDeps; opens: string[] } {
  const opens: string[] = [];
  const deps: GraphViewDeps = {
    onNodeOpen: (id) => opens.push(id),
    devicePixelRatio: () => 1,
    ...over,
  };
  return { deps, opens };
}

beforeEach(() => {
  MockResizeObserver.instances.length = 0;
  (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).ResizeObserver;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphView — initial state', () => {
  it('starts with popover null', () => {
    const { deps } = makeDeps();
    const view = new GraphView(deps);
    expect(view.getSnapshot()).toEqual({ popover: null });
  });

  it('attach + detach without errors', () => {
    const { deps } = makeDeps();
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(800, 600);
    expect(() => view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement)).not.toThrow();
    expect(() => view.detach()).not.toThrow();
  });

  it('detach without prior attach is a no-op', () => {
    const { deps } = makeDeps();
    const view = new GraphView(deps);
    expect(() => view.detach()).not.toThrow();
  });

  it('attach sizes the canvas to the container × DPR', () => {
    const { deps } = makeDeps({ devicePixelRatio: () => 2 });
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(300, 200);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(canvas.style.width).toBe('300px');
    expect(canvas.style.height).toBe('200px');
  });
});

const node = (over: Partial<GraphNode> & { id: string; type: GraphNode['type'] }): GraphNode => ({
  id: over.id, type: over.type, title: over.title ?? over.id,
  weight: over.weight ?? 0, tags: over.tags ?? [],
  scriptureText: over.scriptureText ?? '', scriptureTranslation: over.scriptureTranslation ?? '',
  folderId: over.folderId, color: over.color,
});

const edge = (over: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge => ({
  id: over.id, source: over.source, target: over.target,
  type: over.type ?? 'explicit', weight: over.weight ?? 1,
  createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
});

function attached(): { view: GraphView; canvas: MockCanvas; container: MockContainer; opens: string[] } {
  const { deps, opens } = makeDeps();
  const view = new GraphView(deps);
  const canvas = new MockCanvas();
  const container = new MockContainer(400, 400);
  view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
  return { view, canvas, container, opens };
}

describe('GraphView — setData', () => {
  it('builds a simulation with the given nodes and edges', () => {
    const { view } = attached();
    const nodes = [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })];
    const edges = [edge({ id: 'r1', source: 'a', target: 'b' })];
    view.setData(nodes, edges, null);
    const sim = view.getSimNodes();
    expect(sim.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('preserves (x, y) of surviving nodes across rebuild', () => {
    const { view } = attached();
    const initial = [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })];
    view.setData(initial, [], null);
    const before = view.getSimNodes();
    const a = before.find((n) => n.id === 'a')!; a.x = 100; a.y = 200;
    const b = before.find((n) => n.id === 'b')!; b.x = 300; b.y = 400;

    view.setData(initial, [edge({ id: 'r1', source: 'a', target: 'b' })], null);
    const after = view.getSimNodes();
    expect(after.find((n) => n.id === 'a')?.x).toBe(100);
    expect(after.find((n) => n.id === 'a')?.y).toBe(200);
    expect(after.find((n) => n.id === 'b')?.x).toBe(300);
    expect(after.find((n) => n.id === 'b')?.y).toBe(400);
  });

  it('drops nodes that are no longer present', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })], [], null);
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['a']);
  });

  it('preserves node radius scaling from settings.nodeSize', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion', weight: 0 })], [], null);
    const baseRadius = view.getSimNodes()[0].radius;
    view.setSettings({ ...DEFAULT_SETTINGS, nodeSize: 2 });
    view.setData([node({ id: 'a', type: 'devotion', weight: 0 })], [], null);
    expect(view.getSimNodes()[0].radius).toBeGreaterThan(baseRadius);
  });
});

describe('GraphView — setMode', () => {
  it('global mode renders all nodes', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' }), node({ id: 'c', type: 'theme' })],
      [],
      'a',
    );
    view.setMode('global');
    expect(view.getSimNodes().map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('local mode without an active node renders nothing', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })],
      [],
      null,
    );
    view.setMode('local');
    expect(view.getSimNodes()).toEqual([]);
  });

  it('local mode filters to getNeighborhood(active, depth)', () => {
    const { view } = attached();
    view.setNeighborhoodFn((id, _depth) => new Set([id, 'b']));
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' }), node({ id: 'c', type: 'theme' })],
      [],
      'a',
    );
    view.setMode('local');
    expect(view.getSimNodes().map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('local mode passes settings.depth to getNeighborhood', () => {
    const calls: number[] = [];
    const { view } = attached();
    view.setNeighborhoodFn((id, depth) => { calls.push(depth); return new Set([id]); });
    view.setSettings({ ...DEFAULT_SETTINGS, depth: 3 });
    view.setData([node({ id: 'a', type: 'devotion' })], [], 'a');
    view.setMode('local');
    expect(calls).toContain(3);
  });
});

describe('GraphView — setFilters', () => {
  it('drops nodes whose category (folder) is filtered off', () => {
    const { view } = attached();
    view.setData(
      [
        node({ id: 'a', type: 'devotion', folderId: 'f1' }),
        node({ id: 'b', type: 'sermon', folderId: 'f2' }),
        node({ id: 'c', type: 'theme', folderId: 'f1' }),
      ],
      [],
      null,
    );
    view.setFilters({ f2: false });
    const ids = view.getSimNodes().map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });

  it('categories absent from the filter map stay visible (new folders default on)', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion', folderId: 'f1' }), node({ id: 'b', type: 'sermon', folderId: 'f2' })],
      [],
      null,
    );
    view.setFilters({ f1: true }); // f2 never mentioned → still shown
    const ids = view.getSimNodes().map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('filters scripture verse nodes via the scripture category', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion', folderId: 'f1' }), node({ id: 's1', type: 'scripture' })],
      [],
      null,
    );
    view.setFilters({ scripture: false });
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['a']);
  });

  it('treats root / unfiled notes as the "root" category', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion', folderId: 'root' }), node({ id: 'b', type: 'sermon', folderId: 'f1' })],
      [],
      null,
    );
    view.setFilters({ root: false });
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['b']);
  });

  it('drops edges whose endpoints have been filtered out', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion', folderId: 'f1' }), node({ id: 'b', type: 'sermon', folderId: 'f2' })],
      [edge({ id: 'r1', source: 'a', target: 'b' })],
      null,
    );
    view.setFilters({ f2: false });
    expect(view.getSimLinks()).toEqual([]);
  });

  it('preserves positions of surviving nodes when a filter toggles', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion', folderId: 'f1' }), node({ id: 'b', type: 'sermon', folderId: 'f2' })],
      [],
      null,
    );
    const before = view.getSimNodes();
    before.find((n) => n.id === 'a')!.x = 50;
    before.find((n) => n.id === 'a')!.y = 60;

    view.setFilters({ f2: false });
    const after = view.getSimNodes();
    const a = after.find((n) => n.id === 'a')!;
    expect(a.x).toBe(50);
    expect(a.y).toBe(60);
  });
});

describe('GraphView — tickFor', () => {
  it('advances the sim, moving nodes from their seed positions', () => {
    const { view } = attached();
    view.setData(
      [
        node({ id: 'a', type: 'devotion' }),
        node({ id: 'b', type: 'sermon' }),
        node({ id: 'c', type: 'theme' }),
      ],
      [edge({ id: 'r1', source: 'a', target: 'b' }), edge({ id: 'r2', source: 'b', target: 'c' })],
      null,
    );
    view.tickFor(120);
    const sim = view.getSimNodes();
    for (const n of sim) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    const distinctX = new Set(sim.map((n) => Math.round(n.x ?? 0))).size;
    expect(distinctX).toBeGreaterThan(1);
  });

  it('is a no-op when no sim is built yet', () => {
    const { view } = attached();
    expect(() => view.tickFor(10)).not.toThrow();
  });
});

describe('GraphView — canvas drawing', () => {
  it('draws an arc for each node and a line per edge each tick', () => {
    const { view, canvas } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })],
      [edge({ id: 'r1', source: 'a', target: 'b' })],
      null,
    );
    canvas.ctx.calls.length = 0;
    view.tickFor(1);
    const arcs = canvas.ctx.calls.filter((c) => c.method === 'arc').length;
    const moves = canvas.ctx.calls.filter((c) => c.method === 'moveTo').length;
    expect(arcs).toBeGreaterThanOrEqual(2);
    expect(moves).toBeGreaterThanOrEqual(1);
  });

  it('draws an additional glow ring around the active node', () => {
    const { view, canvas } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })],
      [],
      'a',
    );
    canvas.ctx.calls.length = 0;
    view.tickFor(1);
    // Active glow draws two extra arcs around 'a' (outer + inner halo) plus the node body.
    // Inactive 'b' draws one arc. So total >= 4 arcs for 2 nodes.
    const arcs = canvas.ctx.calls.filter((c) => c.method === 'arc').length;
    expect(arcs).toBeGreaterThanOrEqual(4);
  });

  it('clears the canvas before each tick', () => {
    const { view, canvas } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    canvas.ctx.calls.length = 0;
    view.tickFor(1);
    expect(canvas.ctx.calls[0].method).toBe('clearRect');
  });
});

describe('GraphView — pointer interaction', () => {
  function placeNode(view: GraphView, id: string, x: number, y: number) {
    const sim = view.getSimNodes();
    const n = sim.find((s) => s.id === id);
    if (n) { n.x = x; n.y = y; n.fx = x; n.fy = y; }
  }

  it('mouse-up on a non-scripture node fires onNodeOpen with its id', () => {
    const { view, opens } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    // Node at world (100, 100, 0) with default camera {yaw:0,pitch:0.35,scale:1}
    // projects to screen ≈ (300, 294) on a 400×400 canvas (cx=cy=200).
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(opens).toEqual(['a']);
  });

  it('mouse-up on empty space does NOT fire onNodeOpen', () => {
    const { view, opens } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    // (0, 0) is far from the node's projected screen position ≈ (300, 294).
    view.handleMouseDown({ clientX: 0, clientY: 0 });
    view.handleMouseUp({ clientX: 0, clientY: 0 });
    expect(opens).toEqual([]);
  });

  it('mouse-up on a scripture node sets popover state', () => {
    const { view } = attached();
    view.setData(
      [
        node({
          id: 'scripture:gen-1-1', type: 'scripture',
          title: 'Genesis 1:1', scriptureText: 'In the beginning...', scriptureTranslation: 'WEB',
        }),
      ],
      [],
      null,
    );
    placeNode(view, 'scripture:gen-1-1', 100, 100);
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    const snap = view.getSnapshot();
    expect(snap.popover).toMatchObject({
      nodeId: 'scripture:gen-1-1',
      title: 'Genesis 1:1',
      text: 'In the beginning...',
      translation: 'WEB',
    });
  });

  it('second click on the same scripture node clears popover', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 's', type: 'scripture', title: 'X', scriptureText: 'Y', scriptureTranslation: 'Z' })],
      [], null,
    );
    placeNode(view, 's', 100, 100);
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(view.getSnapshot().popover).not.toBeNull();
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(view.getSnapshot().popover).toBeNull();
  });

  it('mouse-up on empty space clears an open popover', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 's', type: 'scripture', title: 'X', scriptureText: 'Y', scriptureTranslation: 'Z' })],
      [], null,
    );
    placeNode(view, 's', 100, 100);
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(view.getSnapshot().popover).not.toBeNull();
    // (0, 0) is far from the node's projected screen position ≈ (300, 294).
    view.handleMouseDown({ clientX: 0, clientY: 0 });
    view.handleMouseUp({ clientX: 0, clientY: 0 });
    expect(view.getSnapshot().popover).toBeNull();
  });

  it('handleMouseMove sets hoveredNodeId when over a node', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    // Hover at the node's projected screen position ≈ (300, 294).
    view.handleMouseMove({ clientX: 300, clientY: 294 });
    expect(view.getHoveredNodeId()).toBe('a');
    // (0, 0) is far off — no node there.
    view.handleMouseMove({ clientX: 0, clientY: 0 });
    expect(view.getHoveredNodeId()).toBeNull();
  });

  it('wheel zoom changes camera.scale (popover screen-sync deferred to Task 11)', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 's', type: 'scripture', title: 'X', scriptureText: 'Y', scriptureTranslation: 'Z' })],
      [], null,
    );
    const before = view.getCamera().scale;
    view.handleWheel({ clientX: 0, clientY: 0, deltaY: -100 }); // zoom in
    // Wheel now drives camera.scale, not _transform.
    expect(view.getCamera().scale).toBeGreaterThan(before);
  });
});


describe('GraphView — settle (no entrance motion)', () => {
  const spread = () => ({
    nodes: [
      node({ id: 'a', type: 'devotion' }),
      node({ id: 'b', type: 'sermon' }),
      node({ id: 'c', type: 'theme' }),
      node({ id: 'd', type: 'scripture' }),
    ],
    edges: [
      edge({ id: 'r1', source: 'a', target: 'b' }),
      edge({ id: 'r2', source: 'b', target: 'c' }),
    ],
  });

  it('is a no-op when no sim is built yet', () => {
    const { view } = attached();
    expect(() => view.settle()).not.toThrow();
  });

  it('leaves the layout stable so the first painted frame shows no motion', () => {
    const { view } = attached();
    const { nodes, edges } = spread();
    view.setData(nodes, edges, null);
    view.settle();
    const before = view.getSimNodes().map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }));
    view.tickFor(1);
    const after = view.getSimNodes().map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }));
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(after[i].x - before[i].x)).toBeLessThan(2);
      expect(Math.abs(after[i].y - before[i].y)).toBeLessThan(2);
    }
  });


});

describe('GraphView — cursor management', () => {
  function placeNode(view: GraphView, id: string, x: number, y: number) {
    const sim = view.getSimNodes();
    const n = sim.find((s) => s.id === id);
    if (n) { n.x = x; n.y = y; n.fx = x; n.fy = y; }
  }

  it('attach sets the initial cursor to grab', () => {
    const { deps } = makeDeps();
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(400, 400);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    expect(canvas.style.cursor).toBe('grab');
  });

  it('handleMouseMove over a node sets cursor to pointer', () => {
    const { view, canvas } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    // Hover at the node's projected screen position ≈ (300, 294).
    view.handleMouseMove({ clientX: 300, clientY: 294 });
    expect(canvas.style.cursor).toBe('pointer');
  });

  it('handleMouseMove off any node reverts cursor to grab', () => {
    const { view, canvas } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    view.handleMouseMove({ clientX: 300, clientY: 294 });
    expect(canvas.style.cursor).toBe('pointer');
    // (0, 0) is far from the node — no node there.
    view.handleMouseMove({ clientX: 0, clientY: 0 });
    expect(canvas.style.cursor).toBe('grab');
  });

  it('cursor becomes grabbing while panning', () => {
    const { view, canvas } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.handleMouseDown({ clientX: 200, clientY: 200 });
    expect(canvas.style.cursor).toBe('grab');
    view.handleMouseMove({ clientX: 250, clientY: 230 });
    expect(canvas.style.cursor).toBe('grabbing');
  });

  it('cursor reverts to grab after a pan ends', () => {
    const { view, canvas } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.handleMouseDown({ clientX: 200, clientY: 200 });
    view.handleMouseMove({ clientX: 250, clientY: 230 });
    view.handleMouseUp({ clientX: 250, clientY: 230 });
    expect(canvas.style.cursor).toBe('grab');
  });
});

describe('GraphView — setSettings (in-place updates)', () => {
  it('nodeSize change does not rebuild the sim and updates radii in place', () => {
    const { view } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })],
      [], null,
    );
    const beforeA = view.getSimNodes().find((n) => n.id === 'a')!;
    const beforeRadius = beforeA.radius;
    view.setSettings({ ...DEFAULT_SETTINGS, nodeSize: 2 });
    const afterA = view.getSimNodes().find((n) => n.id === 'a')!;
    expect(afterA).toBe(beforeA);
    expect(afterA.radius).toBeGreaterThan(beforeRadius);
  });

  it('force-related changes (linkDistance, repelForce, etc.) do not rebuild the sim', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    const before = view.getSimNodes()[0];
    view.setSettings({
      ...DEFAULT_SETTINGS,
      linkDistance: 100,
      linkForce: 0.005,
      repelForce: 500,
      edgeThickness: 2,
    });
    expect(view.getSimNodes()[0]).toBe(before);
  });

  it('depth change in global mode does not rebuild', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.setMode('global');
    const before = view.getSimNodes()[0];
    view.setSettings({ ...DEFAULT_SETTINGS, depth: 3 });
    expect(view.getSimNodes()[0]).toBe(before);
  });

  it('depth change in local mode rebuilds the sim', () => {
    const { view } = attached();
    view.setNeighborhoodFn((id, _depth) => new Set([id]));
    view.setData([node({ id: 'a', type: 'devotion' })], [], 'a');
    view.setMode('local');
    const before = view.getSimNodes()[0];
    view.setSettings({ ...DEFAULT_SETTINGS, depth: 3 });
    const after = view.getSimNodes()[0];
    expect(after).not.toBe(before);
  });
});

describe('GraphView — onNodeTap interception', () => {
  type Tap = { id: string; type: GraphNode['type']; title: string };
  function placeNode(view: GraphView, id: string, x: number, y: number) {
    const n = view.getSimNodes().find((s) => s.id === id);
    if (n) { n.x = x; n.y = y; n.fx = x; n.fy = y; }
  }
  function attachedWith(over: Partial<GraphViewDeps>) {
    const { deps, opens } = makeDeps(over);
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(400, 400);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    return { view, opens };
  }

  it('routes a note-node tap to onNodeTap and suppresses onNodeOpen', () => {
    const taps: Tap[] = [];
    const { view, opens } = attachedWith({ onNodeTap: (n) => { taps.push(n); return true; } });
    view.setData([node({ id: 'a', type: 'devotion', title: 'A' })], [], null);
    placeNode(view, 'a', 100, 100);
    // Click at projected screen position of world (100, 100, 0) ≈ (300, 294).
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(taps).toEqual([{ id: 'a', type: 'devotion', title: 'A' }]);
    expect(opens).toEqual([]);
  });

  it('routes a scripture-node tap to onNodeTap and suppresses the popover', () => {
    const taps: Tap[] = [];
    const { view } = attachedWith({ onNodeTap: (n) => { taps.push(n); return true; } });
    view.setData(
      [node({ id: 'scripture:gen-1-1', type: 'scripture', title: 'Genesis 1:1', scriptureText: 'In the beginning...', scriptureTranslation: 'WEB' })],
      [],
      null,
    );
    placeNode(view, 'scripture:gen-1-1', 100, 100);
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(taps).toEqual([{ id: 'scripture:gen-1-1', type: 'scripture', title: 'Genesis 1:1' }]);
    expect(view.getSnapshot().popover).toBeNull();
  });

  it('falls back to default behavior when onNodeTap returns false', () => {
    const { view, opens } = attachedWith({ onNodeTap: () => false });
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(opens).toEqual(['a']);
  });

  it('omitting onNodeTap entirely preserves default behavior (desktop path)', () => {
    const { view, opens } = attachedWith({}); // no onNodeTap key
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    placeNode(view, 'a', 100, 100);
    view.handleMouseDown({ clientX: 300, clientY: 294 });
    view.handleMouseUp({ clientX: 300, clientY: 294 });
    expect(opens).toEqual(['a']);
  });
});

describe('GraphView — setFocus', () => {
  it('local mode centers on the focus id instead of the active id', () => {
    const { view } = attached();
    view.setNeighborhoodFn((id) => new Set([id])); // neighborhood = just the focused node
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'scripture:x', type: 'scripture' })],
      [],
      'a', // activeNodeId = 'a'
    );
    view.setFocus('scripture:x'); // override to the scripture node
    view.setMode('local');
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['scripture:x']);
  });

  it('clearing focus falls back to the active id', () => {
    const { view } = attached();
    view.setNeighborhoodFn((id) => new Set([id]));
    view.setData([node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })], [], 'a');
    view.setMode('local');
    view.setFocus('b');
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['b']);
    view.setFocus(null);
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['a']);
  });

  it('focus persists across setData until explicitly cleared', () => {
    const { view } = attached();
    view.setNeighborhoodFn((id) => new Set([id]));
    view.setData([node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })], [], 'a');
    view.setMode('local');
    view.setFocus('b');
    // Update data with a different activeNodeId — focus stays on 'b'.
    view.setData([node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })], [], 'c');
    expect(view.getSimNodes().map((n) => n.id)).toEqual(['b']);
  });
});





describe('GraphView — sphere rendering', () => {
  // Pull the radius of the LAST node-circle arc drawn (front-most, painted last).
  function arcs(canvas: MockCanvas) {
    return canvas.ctx.calls.filter((c) => c.method === 'arc').map((c) => c.args as number[]);
  }

  it('paints nodes back-to-front (deeper nodes drawn earlier, so radii increase)', () => {
    const { view, canvas } = attached();
    view.setData(
      [node({ id: 'back', type: 'devotion' }), node({ id: 'mid', type: 'sermon' }), node({ id: 'front', type: 'theme' })],
      [], null,
    );
    const sim = view.getSimNodes();
    const pin = (id: string, z: number) => {
      const s = sim.find((n) => n.id === id)!;
      s.x = 0; s.y = 0; s.z = z; s.fx = 0; s.fy = 0; (s as { fz?: number }).fz = z;
    };
    // All non-scripture → identical base radius, so depthScale alone drives drawn size.
    pin('back', -200); pin('mid', 0); pin('front', 200);
    view.settle();
    const radii = arcs(canvas).map((a) => a[2]); // arc radius arg, in draw order
    expect(radii.length).toBe(3);
    expect(radii[0]).toBeLessThan(radii[1]); // back drawn first, smallest
    expect(radii[1]).toBeLessThan(radii[2]); // front drawn last, largest
  });

  it('a front-facing node is drawn larger than the same node facing away', () => {
    const { view, canvas } = attached();
    view.setData([node({ id: 'solo', type: 'devotion' })], [], null);
    const s = view.getSimNodes()[0];
    // Pin one node straight in front (+z) vs straight behind (-z); compare drawn radius.
    s.x = 0; s.y = 0; s.z = 200; s.fx = 0; s.fy = 0; (s as { fz?: number }).fz = 200;
    view.settle();
    const front = arcs(canvas).at(-1)![2]; // arc radius arg
    s.z = -200; (s as { fz?: number }).fz = -200;
    view.settle();
    const back = arcs(canvas).at(-1)![2];
    expect(front).toBeGreaterThan(back);
  });
});

describe('GraphView — 3D sphere layout', () => {
  it('settles every node onto the sphere surface (≈ radius R from origin)', () => {
    const { view } = attached();
    view.setData(
      [
        node({ id: 'a', type: 'devotion' }),
        node({ id: 'b', type: 'sermon' }),
        node({ id: 'c', type: 'theme' }),
        node({ id: 'd', type: 'devotion' }),
        node({ id: 'e', type: 'sermon' }),
      ],
      [edge({ id: 'r1', source: 'a', target: 'b' }), edge({ id: 'r2', source: 'b', target: 'c' })],
      null,
    );
    view.settle();
    const sim = view.getSimNodes();
    const R = Math.max(160, Math.sqrt(5) * 55); // sphereRadius(5)
    for (const n of sim) {
      const d = Math.sqrt((n.x ?? 0) ** 2 + (n.y ?? 0) ** 2 + (n.z ?? 0) ** 2);
      // Within 35% of R — the constraint is soft, not a hard projection.
      expect(d).toBeGreaterThan(R * 0.65);
      expect(d).toBeLessThan(R * 1.35);
    }
  });

  it('gives every node a defined 3D position', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })], [], null);
    view.settle();
    for (const n of view.getSimNodes()) {
      expect(typeof n.x).toBe('number');
      expect(typeof n.y).toBe('number');
      expect(typeof n.z).toBe('number');
    }
  });
});

describe('GraphView — sphere hit-testing', () => {
  it('returns the front-most node when two overlap in screen space', () => {
    const { view } = attached();
    view.setData([node({ id: 'front', type: 'devotion' }), node({ id: 'back', type: 'sermon' })], [], null);
    const sim = view.getSimNodes();
    const front = sim.find((n) => n.id === 'front')!;
    const back = sim.find((n) => n.id === 'back')!;
    // Same x/y (overlap on screen), different z. Pin so the sim can't move them.
    front.x = 0; front.y = 0; front.z = 150; front.fx = 0; front.fy = 0; (front as { fz?: number }).fz = 150;
    back.x = 0; back.y = 0; back.z = -150; back.fx = 0; back.fy = 0; (back as { fz?: number }).fz = -150;
    view.settle();
    // Flatten pitch to 0 so both nodes project to the exact screen centre and truly
    // overlap (with the default tilt they'd project to different screen Y).
    (view as unknown as { camera: { pitch: number } }).camera.pitch = 0;
    view.handleMouseMove({ clientX: 200, clientY: 200 }); // 400x400 canvas → centre
    expect(view.getHoveredNodeId()).toBe('front');
  });

  it('draws only the hovered node\'s label', () => {
    const { view, canvas } = attached();
    view.setData(
      [node({ id: 'a', type: 'devotion', title: 'Alpha' }), node({ id: 'b', type: 'sermon', title: 'Beta' })],
      [], null,
    );
    const sim = view.getSimNodes();
    const a = sim.find((n) => n.id === 'a')!;
    const b = sim.find((n) => n.id === 'b')!;
    a.x = 0; a.y = 0; a.z = 0; a.fx = 0; a.fy = 0; (a as { fz?: number }).fz = 0;       // projects to centre
    b.x = 999; b.y = 999; b.z = 0; b.fx = 999; b.fy = 999; (b as { fz?: number }).fz = 0; // far off-screen
    view.settle();
    (view as unknown as { camera: { pitch: number } }).camera.pitch = 0;
    const before = canvas.ctx.calls.length;
    view.handleMouseMove({ clientX: 200, clientY: 200 }); // hover node 'a' at the centre
    expect(view.getHoveredNodeId()).toBe('a');
    const labels = canvas.ctx.calls.slice(before).filter((c) => c.method === 'fillText').map((c) => c.args[0]);
    expect(labels).toEqual(['Alpha']);
  });
});

describe('GraphView — drag to orbit', () => {
  it('horizontal drag changes yaw, vertical drag changes pitch (clamped)', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.settle();
    const before = view.getCamera();
    view.handleMouseDown({ clientX: 10, clientY: 10 });   // empty space (node is centred, away from 10,10)
    view.handleMouseMove({ clientX: 60, clientY: 40 });   // dragged +50x, +30y
    const after = view.getCamera();
    expect(after.yaw).not.toBeCloseTo(before.yaw, 6);
    expect(after.pitch).not.toBeCloseTo(before.pitch, 6);
    view.handleMouseUp({ clientX: 60, clientY: 40 });
  });

  it('clamps pitch within ±PITCH_LIMIT', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.settle();
    view.handleMouseDown({ clientX: 10, clientY: 10 });
    view.handleMouseMove({ clientX: 10, clientY: 100000 }); // huge vertical drag
    expect(Math.abs(view.getCamera().pitch)).toBeLessThanOrEqual(1.3 + 1e-9);
    view.handleMouseUp({ clientX: 10, clientY: 100000 });
  });
});

describe('GraphView — edge depth fade', () => {
  function alphaOf(strokeData: { strokeStyle: string; globalAlpha: number } | string): number {
    if (typeof strokeData === 'string') {
      const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(strokeData);
      return m ? parseFloat(m[1]) : NaN;
    }
    return strokeData.globalAlpha;
  }

  it('draws an edge between back-facing nodes fainter than one between front-facing nodes', () => {
    const { view, canvas } = attached();
    view.setData(
      [node({ id: 'fa', type: 'devotion' }), node({ id: 'fb', type: 'sermon' }),
       node({ id: 'ba', type: 'devotion' }), node({ id: 'bb', type: 'sermon' })],
      // 'front' edge first, 'back' edge second → strokes recorded in this order.
      [edge({ id: 'front', source: 'fa', target: 'fb' }),
       edge({ id: 'back', source: 'ba', target: 'bb' })],
      null,
    );
    const sim = view.getSimNodes();
    const pin = (id: string, x: number, y: number, z: number) => {
      const s = sim.find((n) => n.id === id)!;
      s.x = x; s.y = y; s.z = z; s.fx = x; s.fy = y; (s as { fz?: number }).fz = z;
    };
    // y=0 so depth ≈ z*cos(pitch). Front pair +z, back pair -z. No hover → 2 strokes total.
    pin('fa', -40, 0, 200); pin('fb', 40, 0, 200);
    pin('ba', -40, 0, -200); pin('bb', 40, 0, -200);
    view.settle();

    const strokes = canvas.ctx.calls.filter((c) => c.method === 'stroke').map((c) => c.args[0]);
    expect(strokes.length).toBe(2);
    expect(alphaOf(strokes[0])).toBeGreaterThan(alphaOf(strokes[1])); // front brighter than back
  });
});

describe('GraphView — sphere zoom and auto-fit', () => {
  it('wheel up increases camera scale, wheel down decreases it', () => {
    const { view } = attached();
    view.setData([node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' })], [], null);
    view.settle();
    const base = view.getCamera().scale;
    view.handleWheel({ clientX: 0, clientY: 0, deltaY: -100 });
    expect(view.getCamera().scale).toBeGreaterThan(base);
    const up = view.getCamera().scale;
    view.handleWheel({ clientX: 0, clientY: 0, deltaY: 100 });
    expect(view.getCamera().scale).toBeLessThan(up);
  });

  it('auto-fit scales the sphere to fit the viewport', () => {
    const { view } = attached(); // 400x400
    view.setData(
      [node({ id: 'a', type: 'devotion' }), node({ id: 'b', type: 'sermon' }), node({ id: 'c', type: 'theme' })],
      [], null,
    );
    view.settle(); // runs auto-fit
    const R = Math.max(160, Math.sqrt(3) * 55);
    const maxNodeR = Math.max(...view.getSimNodes().map((n) => n.radius));
    const expected = (0.7 * (Math.min(400, 400) - 2 * 30)) / (2 * (R + maxNodeR));
    expect(view.getCamera().scale).toBeCloseTo(expected, 4);
  });
});

describe('GraphView — auto-rotation', () => {
  it('advances yaw over time when idle', () => {
    let clock = 0;
    const { deps } = makeDeps({ now: () => clock });
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(400, 400);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.settle();
    const before = view.getCamera().yaw;
    clock = 0; view.tickFor(1);      // establishes last-frame time
    clock = 1000; view.tickFor(1);   // +1s
    expect(view.getCamera().yaw).toBeGreaterThan(before);
  });

  it('does not advance yaw under prefers-reduced-motion', () => {
    let clock = 0;
    const { deps } = makeDeps({ now: () => clock, prefersReducedMotion: () => true });
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(400, 400);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    view.settle();
    const before = view.getCamera().yaw;
    clock = 0; view.tickFor(1);
    clock = 5000; view.tickFor(1);
    expect(view.getCamera().yaw).toBe(before);
  });

  it('does not advance yaw while a node is hovered', () => {
    let clock = 0;
    const { deps } = makeDeps({ now: () => clock });
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(400, 400);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    const s = view.getSimNodes()[0];
    s.x = 0; s.y = 0; s.z = 0; s.fx = 0; s.fy = 0; (s as { fz?: number }).fz = 0;
    view.settle();
    (view as unknown as { camera: { pitch: number } }).camera.pitch = 0; // project to centre
    view.handleMouseMove({ clientX: 200, clientY: 200 }); // hover the centred node
    expect(view.getHoveredNodeId()).toBe('a');
    const before = view.getCamera().yaw;
    clock = 0; view.tickFor(1);
    clock = 3000; view.tickFor(1);
    expect(view.getCamera().yaw).toBe(before);
  });
});

describe('GraphView — pointer leave', () => {
  it('clears hover and resumes auto-rotation when the pointer leaves', () => {
    let clock = 0;
    const { deps } = makeDeps({ now: () => clock });
    const view = new GraphView(deps);
    const canvas = new MockCanvas();
    const container = new MockContainer(400, 400);
    view.attach(canvas as unknown as HTMLCanvasElement, container as unknown as HTMLElement);
    view.setData([node({ id: 'a', type: 'devotion' })], [], null);
    const s = view.getSimNodes()[0];
    s.x = 0; s.y = 0; s.z = 0; s.fx = 0; s.fy = 0; (s as { fz?: number }).fz = 0;
    view.settle();
    (view as unknown as { camera: { pitch: number } }).camera.pitch = 0; // project to centre
    view.handleMouseMove({ clientX: 200, clientY: 200 });
    expect(view.getHoveredNodeId()).toBe('a');
    // hovered → rotation paused
    const paused = view.getCamera().yaw;
    clock = 0; view.tickFor(1); clock = 2000; view.tickFor(1);
    expect(view.getCamera().yaw).toBe(paused);
    // pointer leaves → hover cleared → rotation resumes
    view.handleMouseLeave();
    expect(view.getHoveredNodeId()).toBe(null);
    const resumed = view.getCamera().yaw;
    clock = 2000; view.tickFor(1); clock = 3000; view.tickFor(1);
    expect(view.getCamera().yaw).toBeGreaterThan(resumed);
  });
});

