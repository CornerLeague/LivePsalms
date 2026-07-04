// src/notepad-landing/three/garden/camera-stations.ts
import * as THREE from 'three';

export interface CameraStation {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 7 hand-authored waypoints. Indices map 1:1 to STATION_META in
// src/notepad-landing/sections/garden-scene/station-meta.ts.
export const CAMERA_STATIONS: readonly CameraStation[] = [
  { pos: V(0, 2.5, 12),  look: V(0, 1, 0)      }, // 1 Three Voices    — entry, three saplings
  { pos: V(-10, 3, 6),   look: V(-14, 1.5, -3) }, // 2 Living Graph    — left thicket
  { pos: V(-2, 4, 4),    look: V(0, 5, -2)     }, // 3 Connections     — looking up at lamp circle
  { pos: V(8, 2.5, 6),   look: V(14, 1.5, -2)  }, // 4 Scripture Margin— right cluster
  { pos: V(0, 3, 8),     look: V(0, 1, 2)      }, // 5 Seven Papers    — wide on the row of 7
  { pos: V(0, 4, -2),    look: V(0, 1.5, -20)  }, // 6 Tier Path       — deep dolly
  { pos: V(0, 2, 4),     look: V(0, 1, -2)     }, // 7 Yours/Trust     — close on doves + basin
] as const;
