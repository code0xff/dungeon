import * as THREE from 'three';
import { BLOOD } from './config';
import { scene } from './scene';
import type { Monster } from './types';

/**
 * Blood from a landed blow: a pooled burst of unlit points.
 *
 * A hit used to change nothing at the point of contact — no mark, no spray —
 * so the only evidence the blade had gone in was a number and a red tint.
 * These are thrown from the struck side of the body back toward the attacker
 * and fall under gravity; a point that reaches the floor or runs out of life
 * is parked below the world until a later hit reuses it.
 */

const PARKED = -100;
const pos = new Float32Array(BLOOD.count * 3);
const vel = new Float32Array(BLOOD.count * 3);
const life = new Float32Array(BLOOD.count);
for (let i = 0; i < BLOOD.count; i++) pos[i * 3 + 1] = PARKED;
const attr = new THREE.BufferAttribute(pos, 3);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', attr);
const points = new THREE.Points(geometry, new THREE.PointsMaterial({
  color: BLOOD.colour, size: BLOOD.size, sizeAttenuation: true, depthWrite: false,
}));
// The burst lives far from the origin the bounds were computed at.
points.frustumCulled = false;
scene.add(points);

/** The next slot to overwrite: the oldest, since slots are handed out in turn. */
let next = 0;

/** Throws blood from creature `m`, struck by something standing at (fromX, fromZ). */
export function bleed(m: Monster, fromX: number, fromZ: number): void {
  const dx = m.mesh.position.x - fromX, dz = m.mesh.position.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  const ax = dx / d, az = dz / d;
  // The side of the body facing the blow.
  const ox = m.mesh.position.x - ax * m.type.r;
  const oz = m.mesh.position.z - az * m.type.r;
  for (let n = 0; n < BLOOD.perHit; n++) {
    const i = next;
    next = (next + 1) % BLOOD.count;
    pos[i * 3] = ox;
    pos[i * 3 + 1] = BLOOD.height * (0.85 + Math.random() * 0.3);
    pos[i * 3 + 2] = oz;
    // Back toward the attacker and fanned sideways, so it hangs in front of the
    // body where it can be seen rather than inside it.
    const side = (Math.random() - 0.5) * 1.8;
    const speed = BLOOD.speed * (0.4 + Math.random() * 0.8);
    vel[i * 3] = (-ax * 0.6 - az * side) * speed;
    vel[i * 3 + 1] = (0.4 + Math.random() * 1.1) * BLOOD.speed * 0.5;
    vel[i * 3 + 2] = (-az * 0.6 + ax * side) * speed;
    life[i] = BLOOD.life * (0.6 + Math.random() * 0.6);
  }
  attr.needsUpdate = true;
}

/** Moves and expires the live points. */
export function updateBlood(dt: number): void {
  let moved = false;
  for (let i = 0; i < BLOOD.count; i++) {
    if (life[i] <= 0) continue;
    moved = true;
    life[i] -= dt;
    if (life[i] <= 0 || pos[i * 3 + 1] < 0.02) {
      life[i] = 0;
      pos[i * 3 + 1] = PARKED;
      continue;
    }
    vel[i * 3 + 1] -= BLOOD.gravity * dt;
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
  }
  if (moved) attr.needsUpdate = true;
}

/** With the dungeon: blood in the air belongs to the fight that is over. */
export function clearBlood(): void {
  life.fill(0);
  for (let i = 0; i < BLOOD.count; i++) pos[i * 3 + 1] = PARKED;
  attr.needsUpdate = true;
}
