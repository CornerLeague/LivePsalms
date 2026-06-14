// src/notepad-landing/three/garden/mount-garden.ts
import * as THREE from 'three';
import { PAPER_COLOR } from './ink-materials';
import { createCrosshatchGround } from './ground';
import { createPlantCluster, createPaperStem } from './plants';
import { createInkSplash } from './splashes';
import { createInkCircle, createStoneBasin } from './circles';
import { createDove, animateDove } from './doves';
import { createFloatingParticles, animateParticle } from './particles';
import { CAMERA_STATIONS } from './camera-stations';
import { buildGardenBlueprint } from './garden-blueprint';

export interface MountGardenOptions {
  scrollProgress: { current: number };
  onStationChange?: (index: number) => void;
}

export interface MountGardenReturn {
  cleanup: () => void;
}

const LAST = CAMERA_STATIONS.length - 1; // 6

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerpVec3(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  return new THREE.Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

export function mountGarden(
  canvas: HTMLCanvasElement,
  opts: MountGardenOptions,
): MountGardenReturn {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER_COLOR);
  scene.fog = new THREE.FogExp2(PAPER_COLOR, 0.012);

  const camera = new THREE.PerspectiveCamera(
    50,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    200,
  );
  camera.position.set(0, 2, 12);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = THREE.NoToneMapping;

  // ── World composition ──
  // Layout lives in the declarative GardenBlueprint (node-testable, designer-
  // iterable). Here we just WALK it, calling the same factories with the same
  // args. allGroups membership (ground + clusters + stems + posts) drives the
  // per-frame plant sway below; splashes/circles/basin are created-and-forgotten
  // (not swayed); doves go to their own list for animateDove.
  const blueprint = buildGardenBlueprint();
  const allGroups: THREE.Object3D[] = [];

  if (blueprint.ground) {
    allGroups.push(createCrosshatchGround(scene));
  }

  for (const c of blueprint.clusters) {
    allGroups.push(createPlantCluster(scene, c.x, c.y, c.z, c.scale, c.complexity));
  }

  for (const s of blueprint.stems) {
    allGroups.push(createPaperStem(scene, s.x, s.y, s.z, s.scale));
  }

  for (const p of blueprint.posts) {
    allGroups.push(createPlantCluster(scene, p.x, p.y, p.z, p.scale, p.complexity));
  }

  for (const sp of blueprint.splashes) {
    createInkSplash(scene, sp.x, sp.y, sp.z, sp.count);
  }

  for (const ci of blueprint.circles) {
    // opacity undefined → createInkCircle's default applies (byte-identical).
    createInkCircle(scene, ci.x, ci.y, ci.z, ci.radius, ci.wobble, ci.opacity);
  }

  createStoneBasin(scene, blueprint.basin.x, blueprint.basin.y, blueprint.basin.z);

  const doves: THREE.Group[] = [];
  for (const d of blueprint.doves) {
    doves.push(createDove(scene, d.x, d.y, d.z));
  }

  const particles = createFloatingParticles(scene, blueprint.particleCount);

  // ── Resize ──
  function onResize() {
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }
  window.addEventListener('resize', onResize);

  // ── RAF loop ──
  let time = 0;
  let lastStation = -1;
  let rafId = 0;
  let stopped = false;

  function tick() {
    if (stopped) return;
    rafId = requestAnimationFrame(tick);
    time += 0.01;

    const p = opts.scrollProgress.current;
    const exact = p * LAST;
    const fromIdx = Math.floor(exact);
    const toIdx = Math.min(fromIdx + 1, LAST);
    const localT = smoothstep(exact - fromIdx);

    const camPos = lerpVec3(CAMERA_STATIONS[fromIdx].pos, CAMERA_STATIONS[toIdx].pos, localT);
    const camLook = lerpVec3(CAMERA_STATIONS[fromIdx].look, CAMERA_STATIONS[toIdx].look, localT);

    // Subtle breathing — reference's exact constants
    camPos.y += Math.sin(time * 0.5) * 0.08;
    camPos.x += Math.sin(time * 0.3) * 0.04;

    camera.position.lerp(camPos, 0.08);

    // Look-at low-pass — match reference
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook);
    const targetLook = camLook.clone().sub(camera.position).normalize();
    currentLook.lerp(targetLook, 0.06);
    camera.lookAt(camera.position.clone().add(currentLook.multiplyScalar(10)));

    // Station change emission
    const newStation = Math.round(p * LAST);
    if (newStation !== lastStation) {
      lastStation = newStation;
      opts.onStationChange?.(newStation);
    }

    // Per-frame animation
    particles.forEach((pt) => animateParticle(pt, time));
    doves.forEach((d) => animateDove(d, time));

    // Gentle plant sway — only non-dove groups
    allGroups.forEach((g, i) => {
      if (g.userData && (g.userData as { baseY?: number }).baseY !== undefined) return;
      g.rotation.z = Math.sin(time * 0.4 + i * 0.7) * 0.015;
      g.rotation.x = Math.cos(time * 0.3 + i * 0.5) * 0.01;
    });

    renderer.render(scene, camera);
  }
  rafId = requestAnimationFrame(tick);

  // ── Cleanup ──
  function cleanup() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    scene.traverse((obj) => {
      const anyObj = obj as THREE.Mesh & THREE.Line;
      if (anyObj.geometry) anyObj.geometry.dispose();
      const mat = anyObj.material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    renderer.dispose();
  }

  return { cleanup };
}
