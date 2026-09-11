import * as THREE from 'three';
import { WARD_COLOR, WARD_GAP, WARD_HEIGHT, WARD_SPIN } from './config';
import { context2d } from './dom';
import { scene } from './scene';
import { state } from './state';

/**
 * Wards: a green gem set down on the floor, to say "this way has been walked".
 *
 * The maze has no landmarks of its own — every corridor is the same stone —
 * and without the map the only record of where you have been is memory. A ward
 * is a record you leave in the world instead: seen down a corridor, it says
 * turn back.
 *
 * **No light.** It glows by an emissive gem and an additive halo, not a
 * PointLight, and that is the whole reason it is cheap. Three compiles the
 * light count into every lit material's shader, so a light added mid-run
 * recompiles every material in the dungeon — a visible hitch on the very frame
 * the player presses the key, and again for every ward after. The sconces get
 * away with lights because their number is fixed when the dungeon is built.
 *
 * `fog: false` on all three materials, so a ward reads further down a corridor
 * than the stone around it. Walls still hide it — depth testing is on — so it
 * marks a direction without seeing through the maze.
 */

interface Parts {
  gem: THREE.BufferGeometry;
  gemMat: THREE.Material;
  pool: THREE.BufferGeometry;
  poolMat: THREE.Material;
  halo: THREE.Texture;
}

let parts: Parts | null = null;

/** Built on the first ward rather than at load: most runs may never set one. */
function shared(): Parts {
  if (parts) return parts;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = context2d(c);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(170,255,190,0.95)');
  grad.addColorStop(0.3, 'rgba(80,235,125,0.4)');
  grad.addColorStop(1, 'rgba(40,200,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const halo = new THREE.CanvasTexture(c);
  parts = {
    gem: new THREE.OctahedronGeometry(0.13),
    // Lit as well as glowing, so the player's torch catches the facets and it
    // reads as a stone rather than a green blob.
    gemMat: new THREE.MeshStandardMaterial({
      color: 0x1d6a38, emissive: WARD_COLOR, emissiveIntensity: 0.85,
      roughness: 0.2, metalness: 0, flatShading: true, fog: false,
    }),
    pool: new THREE.CircleGeometry(0.55, 20),
    poolMat: new THREE.MeshBasicMaterial({
      map: halo, color: WARD_COLOR, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
    halo,
  };
  return parts;
}

/** Whether a ward already stands within WARD_GAP of a spot. */
export function wardNear(x: number, z: number): boolean {
  return state.wardMarks.some((w) => Math.hypot(w.x - x, w.z - z) < WARD_GAP);
}

/** Sets a ward down at a floor position. The caller spends the item. */
export function dropWard(x: number, z: number): void {
  const p = shared();
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const gem = new THREE.Mesh(p.gem, p.gemMat);
  // Stretched upright, so it stands on its point like a cut stone.
  gem.scale.set(1, 1.6, 1);
  gem.position.y = WARD_HEIGHT;
  // Its own material, because each ward pulses on its own phase.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: p.halo, color: WARD_COLOR, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  halo.scale.setScalar(1.1);
  halo.position.y = WARD_HEIGHT;
  // A pool of light on the stone under it, so it marks the ground and not just
  // a point in the air.
  const pool = new THREE.Mesh(p.pool, p.poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  group.add(pool, halo, gem);
  scene.add(group);
  // Math.random, not the seeded stream: this happens mid-run, and a draw from
  // the dungeon's generator here would move everything generated after it.
  state.wardMarks.push({ group, gem, halo, seed: Math.random() * 6.3, x, z });
}

/** Turns and pulses every ward. Cheap enough to run whether or not the game is paused. */
export function animateWards(dt: number, now: number): void {
  const t = now / 1000;
  for (const w of state.wardMarks) {
    w.gem.rotation.y += WARD_SPIN * dt;
    w.gem.position.y = WARD_HEIGHT + Math.sin(t * 1.6 + w.seed) * 0.035;
    w.halo.position.y = w.gem.position.y;
    w.halo.material.opacity = 0.6 + Math.sin(t * 2.2 + w.seed) * 0.2;
  }
}

/** With the dungeon: a ward marks this maze, and the next one is a different maze. */
export function clearWards(): void {
  for (const w of state.wardMarks) {
    scene.remove(w.group);
    w.halo.material.dispose();
  }
  state.wardMarks = [];
}
