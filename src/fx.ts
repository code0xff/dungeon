import * as THREE from 'three';
import { scene } from './scene';

// Short-lived shapes on the floor: the colossus's shockwave and the
// plague-bearer's cloud. Unlit and additive, so they read in the dark with no
// light of their own — a light per effect would recompile every lit material
// the first time one appeared (see ward.ts).
//
// Each effect is one mesh with its own material, because each fades on its
// own clock; there are never more than a handful at once.

interface Effect {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  time: number;
  /** Scale at the start and the end. */
  from: number;
  to: number;
  opacity: number;
}

const effects: Effect[] = [];
const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
const cloudGeo = new THREE.SphereGeometry(1, 16, 10);

function add(geo: THREE.BufferGeometry, colour: number, x: number, y: number, z: number,
  from: number, to: number, time: number, opacity: number, flat: boolean): void {
  const mat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (flat) mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(from);
  scene.add(mesh);
  effects.push({ mesh, mat, t: 0, time, from, to, opacity });
}

/** A ring racing out across the floor to `radius`. */
export function shockwave(x: number, z: number, radius: number, colour: number): void {
  add(ringGeo, colour, x, 0.05, z, 0.3, radius, 0.35, 0.9, true);
}

/** A cloud swelling to `radius` and thinning out — `time` seconds of it. */
export function cloud(x: number, z: number, radius: number, colour: number, time: number): void {
  add(cloudGeo, colour, x, 0.4, z, radius * 0.25, radius, time, 0.45, false);
}

export function updateFx(dt: number): void {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = Math.min(1, e.t / e.time);
    // Out fast and settling, so the edge reads as the edge of the danger.
    e.mesh.scale.setScalar(e.from + (e.to - e.from) * (1 - (1 - k) ** 2));
    // Flattened for the cloud's sake; the ring is already flat on its side.
    if (e.mesh.geometry === cloudGeo) e.mesh.scale.y *= 0.45;
    e.mat.opacity = e.opacity * (1 - k);
    if (k >= 1) {
      scene.remove(e.mesh);
      e.mat.dispose();
      effects.splice(i, 1);
    }
  }
}

/** Drops whatever is still fading. buildWorld() calls it with the rest. */
export function clearFx(): void {
  for (const e of effects) {
    scene.remove(e.mesh);
    e.mat.dispose();
  }
  effects.length = 0;
}
