// src/notepad-landing/three/garden/garden-blueprint.test.ts
import { describe, expect, it } from 'vitest';
import { buildGardenBlueprint } from './garden-blueprint';

describe('buildGardenBlueprint', () => {
  it('includes the crosshatch ground', () => {
    expect(buildGardenBlueprint().ground).toBe(true);
  });

  it('has the exact composition counts', () => {
    const b = buildGardenBlueprint();
    expect(b.clusters).toHaveLength(13);
    expect(b.stems).toHaveLength(7);
    expect(b.posts).toHaveLength(8);
    expect(b.splashes).toHaveLength(5);
    expect(b.circles).toHaveLength(5);
    expect(b.doves).toHaveLength(6);
    expect(b.particleCount).toBe(60);
  });

  it('preserves the 13 hand-authored plant-cluster tuples verbatim', () => {
    expect(buildGardenBlueprint().clusters).toEqual([
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
    ]);
  });

  it('places the 7 paper stems on the (i-3)*1.8 row', () => {
    const b = buildGardenBlueprint();
    expect(b.stems.map((s) => s.x)).toEqual([-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4]);
    for (const s of b.stems) {
      expect(s.y).toBe(0);
      expect(s.z).toBe(2);
      expect(s.scale).toBe(0.9);
    }
  });

  it('walks the 8 tier-posts down -Z with alternating ∓1.2 x', () => {
    const b = buildGardenBlueprint();
    // z = -4 - i*2.5
    expect(b.posts.map((p) => p.z)).toEqual([-4, -6.5, -9, -11.5, -14, -16.5, -19, -21.5]);
    // x = (i even ? -1 : 1) * 1.2
    expect(b.posts.map((p) => p.x)).toEqual([-1.2, 1.2, -1.2, 1.2, -1.2, 1.2, -1.2, 1.2]);
    for (const p of b.posts) {
      expect(p.y).toBe(0);
      expect(p.scale).toBe(0.7);
      expect(p.complexity).toBe(2);
    }
  });

  it('preserves the 5 ink-splash tuples verbatim', () => {
    expect(buildGardenBlueprint().splashes).toEqual([
      { x: -2, y: 0.5, z: -1, count: 20 },
      { x: 3, y: 1, z: -4, count: 15 },
      { x: -8, y: 0.3, z: -3, count: 25 },
      { x: 10, y: 0.8, z: -2, count: 18 },
      { x: -1, y: 0.2, z: -15, count: 30 },
    ]);
  });

  it('gives only the lamp circle (y≈5.5) an explicit 6th opacity arg', () => {
    const b = buildGardenBlueprint();
    const lamp = b.circles.find((c) => c.y === 5.5);
    expect(lamp).toBeDefined();
    expect(lamp?.opacity).toBe(0.35);

    const others = b.circles.filter((c) => c.y !== 5.5);
    expect(others).toHaveLength(4);
    for (const c of others) {
      expect(c.opacity).toBeUndefined();
    }
  });

  it('preserves the 5 ink-circle tuples verbatim', () => {
    expect(buildGardenBlueprint().circles).toEqual([
      { x: 0, y: 3, z: -5, radius: 2.5, wobble: 0.15 },
      { x: -14, y: 2.5, z: -3, radius: 1.8, wobble: 0.1 },
      { x: 14, y: 3.2, z: -2, radius: 2.0, wobble: 0.12 },
      { x: 0, y: 2.8, z: -20, radius: 3.0, wobble: 0.2 },
      { x: 0, y: 5.5, z: -3, radius: 1.4, wobble: 0.08, opacity: 0.35 },
    ]);
  });

  it('has exactly one stone basin near the origin', () => {
    expect(buildGardenBlueprint().basin).toEqual({ x: 0, y: 0.02, z: -2 });
  });

  it('resolves all 6 dove tuples through an injected deterministic rng', () => {
    const b = buildGardenBlueprint(() => 0.5);
    expect(b.doves).toHaveLength(6);
    for (const d of b.doves) {
      // (0.5-0.5)*20=0, 1.5+0.5*3=3, (0.5-0.5)*15-5=-5
      expect(d).toEqual({ x: 0, y: 3, z: -5 });
    }
  });

  it('consumes the rng in x,y,z order, 3 draws per dove (18 total)', () => {
    const draws = [
      0.10, 0.20, 0.30,
      0.40, 0.50, 0.60,
      0.05, 0.15, 0.25,
      0.35, 0.45, 0.55,
      0.65, 0.75, 0.85,
      0.95, 0.01, 0.99,
    ];
    let i = 0;
    const rng = () => draws[i++];
    const b = buildGardenBlueprint(rng);

    expect(i).toBe(18); // 6 doves × 3 draws
    expect(b.doves[0]).toEqual({
      x: (0.10 - 0.5) * 20,
      y: 1.5 + 0.20 * 3,
      z: (0.30 - 0.5) * 15 - 5,
    });
    expect(b.doves[1]).toEqual({
      x: (0.40 - 0.5) * 20,
      y: 1.5 + 0.50 * 3,
      z: (0.60 - 0.5) * 15 - 5,
    });
  });

  it('defaults rng to Math.random, placing doves within the formula bounds', () => {
    const b = buildGardenBlueprint();
    expect(b.doves).toHaveLength(6);
    for (const d of b.doves) {
      expect(d.x).toBeGreaterThanOrEqual(-10); // (r-0.5)*20, r∈[0,1)
      expect(d.x).toBeLessThanOrEqual(10);
      expect(d.y).toBeGreaterThanOrEqual(1.5); // 1.5 + r*3
      expect(d.y).toBeLessThanOrEqual(4.5);
      expect(d.z).toBeGreaterThanOrEqual(-12.5); // (r-0.5)*15 - 5
      expect(d.z).toBeLessThanOrEqual(2.5);
    }
  });

  it('keeps every placed element within the scene extents (assert-in-node)', () => {
    const b = buildGardenBlueprint(() => 0.5);
    const placed = [
      ...b.clusters,
      ...b.stems,
      ...b.posts,
      ...b.splashes,
      ...b.circles,
      b.basin,
      ...b.doves,
    ];
    for (const p of placed) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(20);
      expect(p.z).toBeGreaterThanOrEqual(-25);
      expect(p.z).toBeLessThanOrEqual(5);
    }
  });
});
