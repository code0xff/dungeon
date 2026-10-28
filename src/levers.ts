import * as THREE from 'three';
import { sfxTrap } from './audio';
import {
  CELL, LEVER_ALERT_RADIUS, LEVER_ALERT_TIME, LEVER_COUNT, LEVER_MIN_DIST, LEVER_REACH, LEVER_STAGES, SHRINE_GLOW,
} from './config';
import { ironMat } from './creatures';
import { setPortalOpen } from './scene';
import { state } from './state';
import type { GridCell, Lever } from './types';
import { showMsg, updateHUD } from './ui';

// The sealed stages' puzzle: the portal is held shut by iron, and the means
// of lifting it hang in the dungeon's far dead ends. Throw them all and the
// seal lifts — the key, on these stages, is a walk and a noise.
//
// The levers are found the way the map finds everything else: placed by
// rule rather than by the seeded stream, so laying them out draws nothing and
// every client in a party puts them in the same dead ends. Thrown ones travel
// as a `lever` world event; whoever throws the last one, every client sees the
// count reach the end and opens its own portal, as the chest key does.
//
// Nothing at the top level reads an imported binding: loot.ts imports this,
// and ui.ts imports loot.ts (see Module layers in docs/architecture.md).

/** Whether a stage's — or a co-op level's — portal is sealed by levers. See LEVER_STAGES. */
export const sealedStage = (level: number): boolean => LEVER_STAGES.includes(level);

/**
 * The dead ends: floor cells with one open neighbour, and the direction of the
 * wall facing the way in — where a lever hangs so it is seen on arrival.
 */
export function deadEnds(): { cell: GridCell; back: GridCell }[] {
  const out: { cell: GridCell; back: GridCell }[] = [];
  const dirs: readonly GridCell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let z = 1; z < state.gh - 1; z++) {
    for (let x = 1; x < state.gw - 1; x++) {
      if (state.maze[z][x] !== 0) continue;
      const open = dirs.filter(([dx, dz]) => state.maze[z + dz][x + dx] === 0);
      if (open.length !== 1) continue;
      const [ox, oz] = open[0];
      out.push({ cell: [x, z], back: [-ox, -oz] });
    }
  }
  return out;
}

/**
 * Picks LEVER_COUNT dead ends spread over the dungeon: the furthest from the
 * start first, then each next the one furthest from every lever already
 * chosen. Deterministic, so it draws nothing (see the module note).
 *
 * `free` says whether a cell may be used — the caller's claimed set.
 */
export function placeLevers(free: (x: number, z: number) => boolean): GridCell[] {
  const ends = deadEnds().filter(({ cell: [x, z] }) => free(x, z) && Math.hypot(x - 1, z - 1) >= LEVER_MIN_DIST);
  const chosen: typeof ends = [];
  while (chosen.length < LEVER_COUNT && ends.length) {
    let best = 0, bestScore = -1;
    ends.forEach(({ cell: [x, z] }, i) => {
      const score = chosen.length
        ? Math.min(...chosen.map(({ cell: [cx, cz] }) => Math.hypot(x - cx, z - cz)))
        : Math.hypot(x - 1, z - 1);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    chosen.push(ends.splice(best, 1)[0]);
  }
  for (const { cell: [x, z], back: [bx, bz] } of chosen) {
    const l = makeLever();
    // On the wall at the back of the dead end, facing the way in.
    l.group.position.set(x * CELL + bx * (CELL / 2 - 0.06), 1.25, z * CELL + bz * (CELL / 2 - 0.06));
    l.group.rotation.y = Math.atan2(-bx, -bz);
    l.x = x * CELL;
    l.z = z * CELL;
    state.levers.push(l);
  }
  return chosen.map(({ cell }) => cell);
}

/** A glowing knob so the lever is found by eye in a dark dead end. Cloned per lever: the glow goes out when it is thrown. */
function makeLever(): Lever {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.56, 0.08), ironMat);
  group.add(plate);
  const handle = new THREE.Group();
  handle.position.z = 0.05;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8), ironMat);
  rod.position.y = 0.21;
  const knobMat = new THREE.MeshStandardMaterial({
    color: 0x6a4a2a, roughness: 0.6, emissive: SHRINE_GLOW.colour, emissiveIntensity: SHRINE_GLOW.max,
  });
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), knobMat);
  knob.position.y = 0.43;
  handle.add(rod, knob);
  // Up and leaning a little off the wall; thrown, it swings out and down to
  // point at the floor. Positive x tips the top toward +z, away from the wall.
  handle.rotation.x = LEVER_UP;
  group.add(handle);
  return { group, handle, x: 0, z: 0, pulled: false, throwT: 0 };
}

/** Levers left to throw. */
export const leversLeft = (): number => state.levers.filter((l) => !l.pulled).length;

/** The line the sealed portal says, by what seals it. */
export function sealedLine(): string {
  if (state.levers.length) return `The portal is sealed — ${leversLeft()} of ${state.levers.length} levers still to throw`;
  if (state.boss) return `The portal is sealed — the ${state.boss.type.name} carries the key`;
  return 'The portal is sealed — find the key';
}

/** The handle's angle up and thrown, in radians about the plate's x. */
const LEVER_UP = 0.45;
const LEVER_DOWN = 2.65;

function nearest(): Lever | null {
  let best: Lever | null = null;
  let bestD: number = LEVER_REACH;
  for (const l of state.levers) {
    if (l.pulled) continue;
    const d = Math.hypot(l.x - state.pos.x, l.z - state.pos.z);
    if (d < bestD) { best = l; bestD = d; }
  }
  return best;
}

/**
 * Throws a lever. Instant — it is iron and a shove, not a search — and loud.
 * `by` is the ally who threw it, or null for this player; the caller sends it.
 * Returns whether it was thrown, so the caller knows to make the noise.
 */
export function throwLever(l: Lever, by: string | null): boolean {
  if (l.pulled) return false;
  l.pulled = true;
  l.throwT = 0;
  sfxTrap();
  const left = leversLeft();
  if (left === 0) {
    state.hasKey = true;
    setPortalOpen(true);
    showMsg(by ? `${by} threw the last lever — the seal is lifted` : 'The last lever — the seal on the portal lifts');
  } else {
    showMsg(by ? `${by} threw a lever — ${left} left` : `A lever thrown — ${left} left. That was loud`);
  }
  updateHUD();
  return true;
}

/** The radius and time a thrown lever alerts, for the caller to hand to alertCreatures(). */
export const LEVER_NOISE = { radius: LEVER_ALERT_RADIUS, time: LEVER_ALERT_TIME } as const;

/** Finds the lever in reach and moves the thrown ones. Every frame. */
export function updateLevers(dt: number): void {
  state.nearLever = nearest();
  for (const l of state.levers) {
    if (!l.pulled || l.throwT >= 1) continue;
    l.throwT = Math.min(1, l.throwT + dt * 5);
    l.handle.rotation.x = LEVER_UP + (LEVER_DOWN - LEVER_UP) * (1 - (1 - l.throwT) ** 3);
    const knob = l.handle.children[1];
    if (knob instanceof THREE.Mesh && knob.material instanceof THREE.MeshStandardMaterial) {
      knob.material.emissiveIntensity = SHRINE_GLOW.max * (1 - l.throwT);
    }
  }
}
