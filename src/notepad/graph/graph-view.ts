import { Observable } from '../collection/observable';
import type { GraphEdge, GraphNode } from './types';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  type Simulation3,
} from 'd3-force-3d';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import { forceSphere } from './force-sphere';
import { projectPoint, depthNorm, depthScale, depthAlpha, type SphereCamera } from './sphere-math';
import { resolveGraphPalette } from './graph-palette';

export interface PopoverState {
  nodeId: string;
  screenX: number;
  screenY: number;
  title: string;
  text: string;
  translation: string;
}

export interface GraphViewState {
  popover: PopoverState | null;
}

export interface NodeTypeFilters {
  scripture: boolean;
  sermon: boolean;
  devotion: boolean;
  theme: boolean;
  general: boolean;
}

export interface GraphSettings {
  depth: number;
  linkDistance: number;
  linkForce: number;
  repelForce: number;
  nodeSize: number;
  edgeThickness: number;
}

export interface GraphViewDeps {
  onNodeOpen: (noteId: string) => void;
  devicePixelRatio?: () => number;
  /**
   * Wall clock in milliseconds. Defaults to performance.now(). Injected so tests
   * can drive the auto-rotation animation deterministically.
   */
  now?: () => number;
  /**
   * When this returns true, auto-rotation is disabled and the graph renders
   * perfectly static (respects the user's prefers-reduced-motion setting).
   * Defaults to false (animate).
   */
  prefersReducedMotion?: () => boolean;
  /**
   * Optional tap interceptor. When provided AND it returns true, the view
   * suppresses its default tap behavior (onNodeOpen for note nodes, popover for
   * scripture nodes). Used by the embedded mobile graph to route taps to a peek
   * view. Desktop omits it, so default behavior is preserved.
   */
  onNodeTap?: (node: { id: string; type: GraphNode['type']; title: string }) => boolean;
}

export const DEFAULT_FILTERS: NodeTypeFilters = {
  scripture: true, sermon: true, devotion: true, theme: true, general: true,
};

export const DEFAULT_SETTINGS: GraphSettings = {
  depth: 1,
  linkDistance: 30,
  linkForce: 0.01,
  repelForce: 120,
  nodeSize: 1,
  edgeThickness: 1,
};

const ZOOM_IN_FACTOR = 1.08;
const ZOOM_OUT_FACTOR = 0.92;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const AUTO_FIT_TICK = 80;
const AUTO_FIT_VIEWPORT_PADDING = 30;
// Fraction of the available viewport the auto-fit sphere fills (<1 leaves the globe
// zoomed out a touch so it doesn't crowd the frame).
const AUTO_FIT_FILL = 0.7;

// Sphere radius (world units) grows with node count so the surface doesn't overcrowd.
function sphereRadius(nodeCount: number): number {
  return Math.max(160, Math.sqrt(Math.max(1, nodeCount)) * 55);
}

const PITCH_LIMIT = 1.3;          // clamp pitch (~75°) so the globe can't flip
const ORBIT_SENSITIVITY = 0.01;   // rad of camera rotation per pixel dragged
const ROTATE_SPEED = 0.18;        // rad/sec auto-rotation (slow)


export interface SimNode extends SimulationNodeDatum {
  id: string;
  type: GraphNode['type'];
  title: string;
  weight: number;
  radius: number;
  tags: string[];
  scriptureText: string;
  scriptureTranslation: string;
  z?: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  edgeType: GraphEdge['type'];
  weight: number;
}

function computeRadius(type: string, weight: number, sizeMultiplier: number): number {
  const base = type === 'scripture' ? 24 : 20;
  return Math.min(64, Math.max(14, (base + weight * 3.5) * sizeMultiplier));
}


/**
 * Owns the d3-force simulation, canvas rendering, and pointer interaction
 * for the knowledge graph. Pure of React, persistence, and NoteCollection.
 *
 * The React shell (GraphPane) constructs an instance, calls `attach(canvas,
 * container)` once, forwards inputs via `setData`/`setMode`/etc. on every
 * change, and renders the popover from `getSnapshot().popover` via
 * `useSyncExternalStore`. On unmount the shell calls `detach()`.
 *
 * Test surface: all behavior is reachable through the public methods using
 * structural mocks for canvas/context/container/ResizeObserver. Tests drive
 * ticks deterministically via `tickFor(n)` since node has no rAF.
 */
export class GraphView extends Observable<GraphViewState> {
  private readonly deps: GraphViewDeps;

  // Wired by attach()
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private wheelListener: ((e: WheelEvent) => void) | null = null;

  private sim: Simulation3<SimNode> | null = null;
  private simNodes: SimNode[] = [];
  private simLinks: SimLink[] = [];
  private tickCount = 0;
  private rafHandle: number | null = null;

  private currentNodes: GraphNode[] = [];
  private currentEdges: GraphEdge[] = [];
  private activeNodeId: string | null = null;

  private settings: GraphSettings = { ...DEFAULT_SETTINGS };
  private filters: NodeTypeFilters = { ...DEFAULT_FILTERS };
  private mode: 'global' | 'local' = 'global';
  private focusNodeId: string | null = null;
  private getNeighborhoodFn: ((id: string, depth: number) => Set<string>) | null = null;

  private hoveredNodeId: string | null = null;
  private camera: SphereCamera = { yaw: 0, pitch: 0.35, scale: 1 };
  private lastRotateTime: number | null = null;
  private hasFit = false;
  private needsSettle = false;

  private dragState = {
    active: false, moved: false, startX: 0, startY: 0, origYaw: 0, origPitch: 0,
  };

  constructor(deps: GraphViewDeps) {
    super({ popover: null });
    this.deps = deps;
  }

  attach(canvas: HTMLCanvasElement, container: HTMLElement): void {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');
    this.resize();
    this.startAutoTick();
    this.updateCursor();

    this.wheelListener = (e: WheelEvent) => this.handleWheel(e);
    canvas.addEventListener('wheel', this.wheelListener, { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
  }

  detach(): void {
    this.stopAutoTick();
    this.sim?.stop();
    this.sim = null;
    if (this.canvas && this.wheelListener) {
      this.canvas.removeEventListener('wheel', this.wheelListener);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.wheelListener = null;
    this.canvas = null;
    this.container = null;
    this.ctx = null;
  }

  tickFor(n: number): void {
    if (!this.sim) return;
    for (let i = 0; i < n; i++) {
      this.sim.tick();
      this.onTick();
    }
  }

  /**
   * Run the simulation to a stable layout and fit the camera in one shot,
   * WITHOUT painting intermediate frames. The production animation loop calls
   * this once per (re)build so the graph appears already settled and fitted —
   * no entrance motion and no resize, only the final state is ever drawn.
   * Tests drive ticks via tickFor instead and exercise this directly.
   */
  settle(): void {
    if (!this.sim) return;
    // d3 scales every force by alpha, so once alpha decays past alphaMin the
    // layout is visually stable. The cap bounds the worst case for large graphs.
    const MAX_SETTLE_TICKS = 500;
    let i = 0;
    while (i < MAX_SETTLE_TICKS && this.sim.alpha() > this.sim.alphaMin()) {
      this.sim.tick();
      i++;
    }
    this.tickCount = AUTO_FIT_TICK;
    if (!this.hasFit) {
      this.runAutoFit();
      this.hasFit = true;
    }
    this.draw();
  }

  private startAutoTick(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    this.stopAutoTick();
    const loop = () => {
      if (this.sim) {
        if (this.needsSettle) {
          // First frame after a (re)build: lay the graph out and fit the camera
          // in one shot so the user never sees the scale=1 → fit-scale jump that
          // resized every node, nor the spreading motion. Only the final,
          // already-fitted state is ever painted — no entrance motion, no resize.
          this.needsSettle = false;
          this.settle();
        } else {
          // Layout is frozen post-settle; only the camera rotates.
          // Do NOT tick the sim — positions are stable.
          this.advanceRotation();
          this.draw();
        }
      }
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  private stopAutoTick(): void {
    if (this.rafHandle != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;
  }

  private onTick(): void {
    this.tickCount++;
    if (!this.hasFit && this.tickCount === AUTO_FIT_TICK) {
      this.runAutoFit();
      this.hasFit = true;
    }
    this.advanceRotation();
    this.draw();
  }

  private runAutoFit(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (this.simNodes.length === 0) return;
    const dpr = this.deps.devicePixelRatio?.() ?? 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const R = sphereRadius(this.simNodes.length);
    const maxNodeR = Math.max(...this.simNodes.map((n) => n.radius));
    const fit = (AUTO_FIT_FILL * (Math.min(width, height) - 2 * AUTO_FIT_VIEWPORT_PADDING)) / (2 * (R + maxNodeR));
    this.camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));
    // Sphere is origin-centred; projection adds the viewport centre, so no x/y offset.
  }

  private advanceRotation(): void {
    const now = this.deps.now?.() ?? (typeof performance !== 'undefined' ? performance.now() : 0);
    const last = this.lastRotateTime ?? now;
    const dt = (now - last) / 1000;
    this.lastRotateTime = now;
    const reduced = this.deps.prefersReducedMotion?.() ?? false;
    const idle = !this.dragState.active && this.hoveredNodeId === null;
    if (!reduced && idle && dt > 0) {
      this.camera.yaw += ROTATE_SPEED * dt;
      this.syncPopoverScreen();
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    const styles = this.container && typeof getComputedStyle !== 'undefined' ? getComputedStyle(this.container) : null;
    const palette = resolveGraphPalette((name) => styles?.getPropertyValue(name) ?? '');

    const dpr = this.deps.devicePixelRatio?.() ?? 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const cx = width / 2;
    const cy = height / 2;
    const cam = this.camera;
    const R = sphereRadius(this.simNodes.length);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel screen space

    const hovered = this.hoveredNodeId;
    const connectedIds = new Set<string>();
    if (hovered) {
      connectedIds.add(hovered);
      for (const link of this.simLinks) {
        const src = typeof link.source === 'object' ? (link.source as SimNode).id : String(link.source);
        const tgt = typeof link.target === 'object' ? (link.target as SimNode).id : String(link.target);
        if (src === hovered) connectedIds.add(tgt);
        if (tgt === hovered) connectedIds.add(src);
      }
    }

    // Project every node once; depth-sort back-to-front.
    const drawn = this.simNodes
      .filter((n) => n.x != null && n.y != null)
      .map((n) => {
        const p = projectPoint({ x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }, cam, cx, cy);
        const dn = depthNorm(p.depth, R);
        return { n, p, dn };
      })
      .sort((a, b) => a.p.depth - b.p.depth);

    // Edges — alpha reduced by endpoint depth so back edges recede.
    const screen = new Map<string, { sx: number; sy: number; dn: number }>();
    for (const d of drawn) screen.set(d.n.id, { sx: d.p.sx, sy: d.p.sy, dn: d.dn });
    for (const link of this.simLinks) {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      const a = screen.get(src.id);
      const b = screen.get(tgt.id);
      if (!a || !b) continue;
      const meanDepth = (a.dn + b.dn) / 2;            // 0 back .. 1 front
      const depthFade = 0.2 + meanDepth * 0.8;        // never fully invisible
      const isHighlighted = hovered && connectedIds.has(src.id) && connectedIds.has(tgt.id);
      const base = hovered ? (isHighlighted ? 0.9 : 0.06) : 0.5;
      const alpha = base * depthFade;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = palette.edge;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = (1.8 + link.weight * 1.5) * this.settings.edgeThickness * cam.scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Nodes — back-to-front, depth-scaled radius + depth-faded fill.
    const activeId = this.effectiveActiveId();
    for (const { n, p, dn } of drawn) {
      const drawR = n.radius * cam.scale * depthScale(dn);
      const isConnected = !hovered || connectedIds.has(n.id);
      const fade = depthAlpha(dn) * (hovered ? (isConnected ? 1 : 0.18) : 1);
      const color = palette.nodeColors[n.type as keyof typeof palette.nodeColors] ?? '#999';

      if (n.id === activeId) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, drawR + 10 * cam.scale, 0, Math.PI * 2);
        ctx.fillStyle = `${color}30`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, drawR + 5 * cam.scale, 0, Math.PI * 2);
        ctx.fillStyle = `${color}20`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, drawR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = fade;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Hover label — only the hovered node, at its projected position.
    if (hovered) {
      const d = drawn.find((x) => x.n.id === hovered);
      if (d) {
        const drawR = d.n.radius * cam.scale * depthScale(d.dn);
        ctx.beginPath();
        ctx.arc(d.p.sx, d.p.sy, drawR + 4 * cam.scale, 0, Math.PI * 2);
        ctx.strokeStyle = `${palette.nodeColors[d.n.type as keyof typeof palette.nodeColors] ?? '#999'}80`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = `${d.n.radius > 24 ? '15px' : '13px'} Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.label;
        ctx.fillText(d.n.title, d.p.sx, d.p.sy + drawR + 10);
      }
    }

    ctx.restore();
  }

  setData(nodes: GraphNode[], edges: GraphEdge[], activeNodeId: string | null): void {
    this.currentNodes = nodes;
    this.currentEdges = edges;
    this.activeNodeId = activeNodeId;
    // focusNodeId is intentionally NOT cleared here — callers own focus lifetime
    // and clear it explicitly via setFocus(null). Focus persists across setData.
    this.rebuild();
  }

  setSettings(settings: GraphSettings): void {
    const prev = this.settings;
    this.settings = settings;

    // Depth only matters in local mode (changes the active node set).
    if (this.mode === 'local' && prev.depth !== settings.depth) {
      this.rebuild();
      return;
    }

    if (!this.sim) return;

    if (prev.nodeSize !== settings.nodeSize) {
      for (const n of this.simNodes) {
        n.radius = computeRadius(n.type, n.weight, settings.nodeSize);
      }
    }

    const link = this.sim.force('link') as import('d3-force-3d').LinkForce3<SimNode, SimLink> | undefined;
    if (link) {
      link.distance((d) => settings.linkDistance / d.weight);
      link.strength((d) => settings.linkForce * d.weight);
    }

    const charge = this.sim.force('charge') as import('d3-force-3d').ManyBodyForce3<SimNode> | undefined;
    if (charge) charge.strength(-settings.repelForce);
    // No center force in the sphere layout; the 'sphere' force owns global shape.

    // Re-warm alpha so the next external tick applies the new forces.
    // Do NOT call .restart() — d3's internal timer is intentionally stopped;
    // the rAF auto-runner (and tickFor in tests) drive ticks.
    this.sim.alpha(0.3);
    this.draw();
  }

  setFilters(filters: NodeTypeFilters): void {
    this.filters = filters;
    this.rebuild();
  }

  setMode(mode: 'global' | 'local'): void {
    this.mode = mode;
    this.rebuild();
  }

  setNeighborhoodFn(fn: (id: string, depth: number) => Set<string>): void {
    this.getNeighborhoodFn = fn;
    this.rebuild();
  }

  /**
   * Overrides the "active" node used for local-mode neighborhood filtering and
   * the active-node highlight ring. Lets the embedded mobile graph center local
   * mode on an arbitrary node — including a scripture node, which never appears
   * as the collection's activeNoteId. Pass null to clear.
   */
  setFocus(id: string | null): void {
    if (this.focusNodeId === id) return;
    this.focusNodeId = id;
    this.rebuild();
  }

  private effectiveActiveId(): string | null {
    return this.focusNodeId ?? this.activeNodeId;
  }

  /** Test affordance — read sim nodes (positions, radius) without subscribing. */
  getSimNodes(): SimNode[] {
    return this.simNodes;
  }

  /** Test affordance — read sim links. */
  getSimLinks(): SimLink[] {
    return this.simLinks;
  }

  /** Test affordance — read hovered id without subscribing to draws. */
  getHoveredNodeId(): string | null {
    return this.hoveredNodeId;
  }

  handleMouseMove = (e: { clientX: number; clientY: number }): void => {
    if (this.dragState.active) {
      this.dragState.moved = true;
      const dx = e.clientX - this.dragState.startX;
      const dy = e.clientY - this.dragState.startY;
      this.camera.yaw = this.dragState.origYaw + dx * ORBIT_SENSITIVITY;
      let pitch = this.dragState.origPitch - dy * ORBIT_SENSITIVITY;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
      this.camera.pitch = pitch;
      this.syncPopoverScreen();
      this.updateCursor();
      this.draw();
      return;
    }
    const { sx, sy } = this.toScreen(e.clientX, e.clientY);
    const id = this.findNodeAt(sx, sy)?.id ?? null;
    if (id !== this.hoveredNodeId) {
      this.hoveredNodeId = id;
      this.updateCursor();
      this.draw();
    }
  };

  handleMouseLeave = (): void => {
    if (this.hoveredNodeId !== null) {
      this.hoveredNodeId = null;
      this.updateCursor();
      this.draw();
    }
  };

  handleMouseDown = (e: { clientX: number; clientY: number }): void => {
    const { sx, sy } = this.toScreen(e.clientX, e.clientY);
    if (!this.findNodeAt(sx, sy)) {
      this.dragState = {
        active: true, moved: false,
        startX: e.clientX, startY: e.clientY,
        origYaw: this.camera.yaw, origPitch: this.camera.pitch,
      };
    }
  };

  handleMouseUp = (e: { clientX: number; clientY: number }): void => {
    if (this.dragState.active && this.dragState.moved) {
      this.dragState.active = false;
      this.dragState.moved = false;
      this.updateCursor();
      return;
    }
    this.dragState.active = false;
    this.dragState.moved = false;
    const { sx, sy } = this.toScreen(e.clientX, e.clientY);
    const node = this.findNodeAt(sx, sy);
    if (!node) {
      this.setState((prev) => prev.popover === null ? prev : { ...prev, popover: null });
      return;
    }
    if (this.deps.onNodeTap) {
      const handled = this.deps.onNodeTap({ id: node.id, type: node.type, title: node.title });
      if (handled) {
        this.setState((prev) => (prev.popover === null ? prev : { ...prev, popover: null }));
        return;
      }
    }
    if (node.type === 'scripture') {
      const current = this.getSnapshot().popover;
      if (current && current.nodeId === node.id) {
        this.setState((prev) => ({ ...prev, popover: null }));
      } else {
        const dpr = this.deps.devicePixelRatio?.() ?? 1;
        const width = (this.canvas?.width ?? 0) / dpr, height = (this.canvas?.height ?? 0) / dpr;
        const p = projectPoint({ x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 }, this.camera, width / 2, height / 2);
        const screenX = p.sx;
        const screenY = p.sy;
        this.setState(() => ({
          popover: {
            nodeId: node.id,
            screenX,
            screenY,
            title: node.title,
            text: node.scriptureText || 'Verse text unavailable.',
            translation: node.scriptureTranslation || 'BSB',
          },
        }));
      }
    } else {
      this.setState((prev) => prev.popover === null ? prev : { ...prev, popover: null });
      this.deps.onNodeOpen(node.id);
    }
  };

  private updateCursor(): void {
    if (!this.canvas) return;
    let next: string;
    if (this.dragState.active && this.dragState.moved) {
      next = 'grabbing';
    } else if (this.hoveredNodeId !== null) {
      next = 'pointer';
    } else {
      next = 'grab';
    }
    if (this.canvas.style.cursor !== next) {
      this.canvas.style.cursor = next;
    }
  }

  private toScreen(clientX: number, clientY: number): { sx: number; sy: number } {
    if (!this.canvas) return { sx: 0, sy: 0 };
    const rect = this.canvas.getBoundingClientRect();
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  }

  private findNodeAt(sx: number, sy: number): SimNode | null {
    if (!this.canvas) return null;
    const dpr = this.deps.devicePixelRatio?.() ?? 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    const cx = width / 2, cy = height / 2;
    const cam = this.camera;
    const R = sphereRadius(this.simNodes.length);
    let best: SimNode | null = null;
    let bestDepth = -Infinity;
    for (const n of this.simNodes) {
      if (n.x == null || n.y == null) continue;
      const p = projectPoint({ x: n.x, y: n.y, z: n.z ?? 0 }, cam, cx, cy);
      const drawR = n.radius * cam.scale * depthScale(depthNorm(p.depth, R));
      const dx = sx - p.sx, dy = sy - p.sy;
      if (dx * dx + dy * dy <= (drawR + 4) ** 2 && p.depth > bestDepth) {
        best = n;
        bestDepth = p.depth;
      }
    }
    return best;
  }

  handleWheel = (e: { clientX: number; clientY: number; deltaY: number; preventDefault?: () => void }): void => {
    e.preventDefault?.();
    const factor = e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
    this.camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.camera.scale * factor));
    this.syncPopoverScreen();
    this.draw();
  };

  private syncPopoverScreen(): void {
    const current = this.getSnapshot().popover;
    if (!current || !this.canvas) return;
    const n = this.simNodes.find((x) => x.id === current.nodeId);
    if (!n || n.x == null || n.y == null) return;
    const dpr = this.deps.devicePixelRatio?.() ?? 1;
    const width = this.canvas.width / dpr, height = this.canvas.height / dpr;
    const p = projectPoint({ x: n.x, y: n.y, z: n.z ?? 0 }, this.camera, width / 2, height / 2);
    if (p.sx === current.screenX && p.sy === current.screenY) return;
    this.setState((prev) => prev.popover ? { popover: { ...prev.popover, screenX: p.sx, screenY: p.sy } } : prev);
  }

  /** Test affordance — read the camera without subscribing. */
  getCamera(): SphereCamera {
    return { ...this.camera };
  }

  private rebuild(): void {
    const filtered = this.filterNodes(this.currentNodes);
    const filteredIds = new Set(filtered.map((n) => n.id));

    // Preserve positions of surviving nodes.
    const prevPos = new Map<string, { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number }>();
    for (const n of this.simNodes) {
      if (n.x != null && n.y != null) {
        prevPos.set(n.id, { x: n.x, y: n.y, z: n.z ?? 0, vx: n.vx, vy: n.vy, vz: (n as { vz?: number }).vz });
      }
    }

    const R = sphereRadius(filtered.length);
    const golden = Math.PI * (3 - Math.sqrt(5));
    this.simNodes = filtered.map((n, i) => {
      const prev = prevPos.get(n.id);
      // Seed on a Fibonacci sphere so the sim starts near a good sphere and settles fast.
      const yUnit = filtered.length > 1 ? 1 - (i / (filtered.length - 1)) * 2 : 0;
      const rUnit = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
      const theta = golden * i;
      return {
        id: n.id, type: n.type, title: n.title, weight: n.weight,
        radius: computeRadius(n.type, n.weight, this.settings.nodeSize),
        tags: n.tags,
        scriptureText: n.scriptureText,
        scriptureTranslation: n.scriptureTranslation,
        x: prev?.x ?? Math.cos(theta) * rUnit * R,
        y: prev?.y ?? yUnit * R,
        z: prev?.z ?? Math.sin(theta) * rUnit * R,
        vx: prev?.vx, vy: prev?.vy, vz: prev?.vz,
      };
    });

    const nodeMap = new Map(this.simNodes.map((n) => [n.id, n]));
    this.simLinks = this.currentEdges
      .filter((e) => filteredIds.has(e.source) && filteredIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        edgeType: e.type,
        weight: e.weight,
      }));

    if (this.sim) this.sim.stop();

    this.sim = forceSimulation<SimNode>(this.simNodes, 3)
      .force('link', forceLink<SimNode, SimLink>(this.simLinks)
        .id((d) => d.id)
        .distance((d) => this.settings.linkDistance / d.weight)
        .strength((d) => this.settings.linkForce * d.weight))
      .force('charge', forceManyBody<SimNode>().strength(-this.settings.repelForce))
      .force('sphere', forceSphere<SimNode>(R, 0.08))
      .numDimensions(3)
      .alphaDecay(0.015)
      .velocityDecay(0.15);

    // Stop d3's auto-runner — we drive ticks via rAF in production / tickFor in tests.
    this.sim.stop();
    this.tickCount = 0;
    this.hasFit = false;
    // Production rAF loop settles + fits this build on its next frame before any
    // paint. tickFor (tests) ignores this and ticks/fits incrementally instead.
    this.needsSettle = true;
  }

  private filterNodes(nodes: GraphNode[]): GraphNode[] {
    let filtered = nodes;
    if (this.mode === 'local') {
      const focusId = this.effectiveActiveId();
      if (focusId && this.getNeighborhoodFn) {
        const neighborhood = this.getNeighborhoodFn(focusId, this.settings.depth);
        filtered = filtered.filter((n) => neighborhood.has(n.id));
      } else {
        filtered = [];
      }
    }
    return filtered.filter((n) => this.filters[n.type]);
  }

  private resize(): void {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = this.deps.devicePixelRatio?.() ?? 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
  }
}
