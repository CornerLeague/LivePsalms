// src/notepad-landing/three/garden/garden-blueprint.ts
//
// Declarative description of the garden's WORLD COMPOSITION — the hand-tuned
// position tuples that used to live inline in mountGarden's lifecycle. This is
// pure, node-testable data: a thin harness (mount-garden.ts) walks the blueprint
// and calls the same factories with the same args. No THREE / WebGL needed to
// assert "what the garden looks like."
//
// Mirrors the CAMERA_STATIONS / DevotionMoodBoard / HeroChoreography pattern:
// art-directed values preserved verbatim as data, invariants asserted in node.

/** A plant cluster (createPlantCluster) or tier-post — same factory + args. */
export interface ClusterSpec {
  x: number;
  y: number;
  z: number;
  scale: number;
  complexity: number;
}

/** A tall paper stem (createPaperStem). */
export interface StemSpec {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/** An ink splash (createInkSplash). */
export interface SplashSpec {
  x: number;
  y: number;
  z: number;
  count: number;
}

/** A decorative ink circle (createInkCircle). `opacity` omitted → factory default. */
export interface CircleSpec {
  x: number;
  y: number;
  z: number;
  radius: number;
  wobble: number;
  opacity?: number;
}

/** A stone basin (createStoneBasin). */
export interface BasinSpec {
  x: number;
  y: number;
  z: number;
}

/** A dove (createDove). Positions resolved via the injected rng at build time. */
export interface DoveSpec {
  x: number;
  y: number;
  z: number;
}

export interface GardenBlueprint {
  /** Whether the composition includes the crosshatch ground (always true today). */
  ground: boolean;
  clusters: ClusterSpec[];
  stems: StemSpec[];
  posts: ClusterSpec[];
  splashes: SplashSpec[];
  circles: CircleSpec[];
  basin: BasinSpec;
  doves: DoveSpec[];
  particleCount: number;
}

// 13 plant clusters scattered to support the 7 camera stations.
const CLUSTERS: readonly ClusterSpec[] = [
  { x: -5, y: 0, z: -3, scale: 1.2, complexity: 5 },
  { x: 6, y: 0, z: -2, scale: 0.8, complexity: 4 },
  { x: -3, y: 0, z: 2, scale: 0.6, complexity: 3 },
  { x: 4, y: 0, z: 3, scale: 0.5, complexity: 3 },
  { x: -15, y: 0, z: -5, scale: 1.4, complexity: 6 },
  { x: -12, y: 0, z: 0, scale: 1.0, complexity: 5 },
  { x: -18, y: 0, z: 2, scale: 0.7, complexity: 3 },
  { x: -10, y: 0, z: -8, scale: 0.9, complexity: 4 },
  { x: 15, y: 0, z: -4, scale: 1.3, complexity: 5 },
  { x: 12, y: 0, z: 1, scale: 1.1, complexity: 6 },
  { x: 18, y: 0, z: -1, scale: 0.6, complexity: 3 },
  { x: -4, y: 0, z: -22, scale: 0.9, complexity: 4 },
  { x: 5, y: 0, z: -20, scale: 1.0, complexity: 5 },
];

// Ink splashes.
const SPLASHES: readonly SplashSpec[] = [
  { x: -2, y: 0.5, z: -1, count: 20 },
  { x: 3, y: 1, z: -4, count: 15 },
  { x: -8, y: 0.3, z: -3, count: 25 },
  { x: 10, y: 0.8, z: -2, count: 18 },
  { x: -1, y: 0.2, z: -15, count: 30 },
];

// Decorative ink circles. The last entry is station 3's lamp halo — the only
// circle that overrides the factory's default opacity (0.35).
const CIRCLES: readonly CircleSpec[] = [
  { x: 0, y: 3, z: -5, radius: 2.5, wobble: 0.15 },
  { x: -14, y: 2.5, z: -3, radius: 1.8, wobble: 0.1 },
  { x: 14, y: 3.2, z: -2, radius: 2.0, wobble: 0.12 },
  { x: 0, y: 2.8, z: -20, radius: 3.0, wobble: 0.2 },
  { x: 0, y: 5.5, z: -3, radius: 1.4, wobble: 0.08, opacity: 0.35 },
];

// Station 7 — stone basin near origin.
const BASIN: BasinSpec = { x: 0, y: 0.02, z: -2 };

// Station 5 — row of 7 paper stems centered on x=0.
function buildStems(): StemSpec[] {
  return Array.from({ length: 7 }, (_, i) => ({
    x: (i - 3) * 1.8, // -5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4
    y: 0,
    z: 2,
    scale: 0.9,
  }));
}

// Station 6 — 8 tier-post clusters marching down -Z, x alternating ∓1.2.
function buildPosts(): ClusterSpec[] {
  return Array.from({ length: 8 }, (_, i) => ({
    x: (i % 2 === 0 ? -1 : 1) * 1.2,
    y: 0,
    z: -4 - i * 2.5, // -4, -6.5, -9 ... -21.5
    scale: 0.7,
    complexity: 2,
  }));
}

// 6 doves distributed via rng. The default (Math.random) keeps production
// byte-for-byte with the old inline mount; an injected rng pins the layout.
// rng is consumed in x, y, z order per dove (3 draws each).
function buildDoves(rng: () => number): DoveSpec[] {
  return Array.from({ length: 6 }, () => ({
    x: (rng() - 0.5) * 20,
    y: 1.5 + rng() * 3,
    z: (rng() - 0.5) * 15 - 5,
  }));
}

/**
 * Build the garden's world composition as declarative data.
 *
 * Static layout (ground, clusters, stems, posts, splashes, circles, basin,
 * particleCount) is fixed; only the doves depend on `rng`. Pass the default
 * `Math.random` in production for behavior identical to the old inline mount;
 * inject a deterministic rng in tests to pin and assert the dove positions.
 */
export function buildGardenBlueprint(rng: () => number = Math.random): GardenBlueprint {
  return {
    ground: true,
    clusters: CLUSTERS.map((c) => ({ ...c })),
    stems: buildStems(),
    posts: buildPosts(),
    splashes: SPLASHES.map((s) => ({ ...s })),
    circles: CIRCLES.map((c) => ({ ...c })),
    basin: { ...BASIN },
    doves: buildDoves(rng),
    particleCount: 60,
  };
}
