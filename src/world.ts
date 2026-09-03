import * as THREE from 'three';
import { floorPBR, spawnCreature, wallPBR } from './assets';
import {
  CELL, CHEST_COUNT, EYE_H, FOG_BASE, FOG_TORCH, GRID, PLAYER_R, SCALE_VARIANCE, SPAWN,
  SPEED_VARIANCE, TYPES, WALL_H,
} from './config';
import { generateDungeon } from './dungeon';
import { createChest, makeSconce, rollProp } from './props';
import { clipDuration, setAnim } from './assets';
import { progress } from './progress';
import { fog, handTorch, portal, portalCore, portalLight, scene, torch, world } from './scene';
import { state } from './state';
import { ceilTex, floorTex, wallTex } from './textures';
import type { CreatureKey, GridCell, ItemKind, Monster } from './types';
import { cancelLoot, minimapEl, objectiveEl, overlayEl, updateHUD, wpnBtn } from './ui';
import { pointerLock } from './input';
import { lockHintEl } from './ui';
import { setWeapon } from './weapons';

/**
 * Whether a circle of radius r overlaps a wall cell. Only the surrounding 3x3 is checked.
 * Testing x and z separately is what makes the player slide along walls.
 */
export function collides(wx: number, wz: number, r = PLAYER_R): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = Math.round(wx / CELL) + dx, gz = Math.round(wz / CELL) + dz;
      if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID || state.maze[gz][gx] !== 1) continue;
      const cx = gx * CELL, cz = gz * CELL, half = CELL / 2;
      const nx = Math.max(cx - half, Math.min(wx, cx + half));
      const nz = Math.max(cz - half, Math.min(wz, cz + half));
      if ((wx - nx) ** 2 + (wz - nz) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** Random number in [min, max]. */
function rand([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

/** A floor cell at least minDist from the start (1,1). Falls back to the far corner. */
/**
 * Cells already handed out this run.
 *
 * Creatures and chests are placed at the exact centre of their cell, so two that
 * draw the same cell end up perfectly on top of each other. With 14 creatures and
 * 10 chests drawn from a few hundred floor cells that is not a rare accident —
 * by the birthday argument it happens in most runs.
 */
const claimed = new Set<number>();

const cellKey = (x: number, z: number): number => z * GRID + x;

function usable(x: number, z: number, minDist: number): boolean {
  return state.maze[z][x] === 0
    && Math.hypot(x - 1, z - 1) >= minDist
    && !claimed.has(cellKey(x, z));
}

/**
 * A free floor cell at least minDist from the start (1,1), claimed on the way out.
 * Falls back to a scan rather than a fixed corner: the old fallback returned
 * (GRID-2, GRID-2), which is exactly where the exit portal stands.
 */
function randomFloorCell(minDist: number): GridCell {
  for (let t = 0; t < 400; t++) {
    const x = 1 + ((Math.random() * (GRID - 2)) | 0);
    const z = 1 + ((Math.random() * (GRID - 2)) | 0);
    if (!usable(x, z, minDist)) continue;
    claimed.add(cellKey(x, z));
    return [x, z];
  }
  for (let z = 1; z < GRID - 1; z++) {
    for (let x = 1; x < GRID - 1; x++) {
      if (!usable(x, z, minDist)) continue;
      claimed.add(cellKey(x, z));
      return [x, z];
    }
  }
  // The dungeon is full. Stacking on the start beats stacking on the portal.
  return [1, 1];
}

let guideTimer: ReturnType<typeof setTimeout> | null = null;

function clearWorld(): void {
  for (const m of [world.wall, world.floor, world.ceil]) {
    if (!m) continue;
    scene.remove(m);
    m.geometry.dispose();
  }
  state.monsters.forEach((m) => scene.remove(m.mesh));
  state.chests.forEach((c) => scene.remove(c.mesh));
  state.props.forEach((p) => scene.remove(p.object));
  state.sconces.forEach((s) => scene.remove(s.group));
  state.monsters = [];
  state.chests = [];
  state.props = [];
  state.sconces = [];
}

function buildGeometry(): void {
  // ---- Walls: one instanced mesh for the lot ----
  const wallCells: GridCell[] = [];
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) if (state.maze[z][x] === 1) wallCells.push([x, z]);
  }
  const wallMaps = wallPBR();
  const wall = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CELL, WALL_H, CELL),
    new THREE.MeshStandardMaterial(wallMaps ? { ...wallMaps, roughness: 1 } : { map: wallTex, roughness: 0.98 }),
    wallCells.length,
  );
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  wallCells.forEach(([x, z], i) => {
    // Jitter height and brightness a little so the tiling stops reading as tiling.
    const sy = 1 + Math.random() * 0.06;
    pv.set(x * CELL, (WALL_H * sy) / 2 - 0.01, z * CELL);
    sc.set(1, sy, 1);
    m4.compose(pv, q, sc);
    wall.setMatrixAt(i, m4);
    col.setHSL(0.6, 0.05, 0.6 + Math.random() * 0.4);
    wall.setColorAt(i, col);
  });
  if (wall.instanceColor) wall.instanceColor.needsUpdate = true;
  scene.add(wall);
  world.wall = wall;

  // ---- Floor and ceiling ----
  const size = GRID * CELL, cx = ((GRID - 1) * CELL) / 2;
  const floorMaps = floorPBR();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial(
      floorMaps ? { ...floorMaps, roughness: 0.9, metalness: 0.05 } : { map: floorTex, roughness: 0.85, metalness: 0.1 },
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cx);
  scene.add(floor);
  world.floor = floor;

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, WALL_H, cx);
  scene.add(ceil);
  world.ceil = ceil;
}

function spawnMonsters(): void {
  for (const [key, count] of Object.entries(SPAWN) as [CreatureKey, number][]) {
    for (let i = 0; i < count; i++) spawnOne(key);
  }
}

function spawnOne(key: CreatureKey): void {
  const t = TYPES[key];
  const [gx, gz] = randomFloorCell(6);
  const sp = spawnCreature(key);
  sp.mesh.position.set(gx * CELL, 0, gz * CELL);
  // Vary the size per creature so the crowd stops looking like clones.
  const scale = rand(SCALE_VARIANCE);
  sp.mesh.scale.setScalar(scale);
  // Start each idle at a different point too, or the horde breathes in unison.
  if (sp.playback) {
    const idle = clipDuration(sp.playback, 'idle') ?? 0;
    setAnim(sp.playback, 'idle', { fade: 0, startAt: Math.random() * idle });
  }
  scene.add(sp.mesh);
  const m: Monster = {
    mesh: sp.mesh,
    key,
    type: t,
    hp: t.hp,
    playback: sp.playback,
    rig: sp.rig,
    atkCd: 0,
    attackT: 0,
    pendingHit: null,
    hurtT: 0,
    alert: 0,
    repath: 0,
    step: null,
    moving: false,
    speedMul: rand(SPEED_VARIANCE),
    anim: Math.random() * 6,
    bobSeed: Math.random() * 10,
    groanT: t.groan[0] + Math.random() * (t.groan[1] - t.groan[0]),
    dead: false,
    deadT: 0,
  };
  state.monsters.push(m);
}

function spawnChests(): void {
  // Exactly one torch and one map are guaranteed. The rest is 2 ammo and 2 potions.
  const items: ItemKind[] = ['torch', 'map', 'ammo', 'ammo', 'potion', 'potion'];
  for (let i = 0; i < CHEST_COUNT; i++) {
    const [gx, gz] = randomFloorCell(4);
    const c = createChest(20 + ((Math.random() * 60) | 0));
    c.mesh.position.set(gx * CELL + (Math.random() - 0.5) * 1.2, 0, gz * CELL + (Math.random() - 0.5) * 1.2);
    c.mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(c.mesh);
    state.chests.push({ ...c, item: null });
  }
  const order = state.chests.map((_, i) => i).sort(() => Math.random() - 0.5);
  items.forEach((it, i) => {
    state.chests[order[i]].item = it;
  });
}

function scatterProps(): void {
  for (let z = 1; z < GRID - 1; z++) {
    for (let x = 1; x < GRID - 1; x++) {
      // Leave the start and exit cells clear.
      if (state.maze[z][x] !== 0 || (x === 1 && z === 1) || (x === state.exitCell.x && z === state.exitCell.z)) continue;
      const p = rollProp();
      if (!p) continue;
      p.object.position.set(
        x * CELL + (Math.random() - 0.5) * 2.2,
        p.object.position.y,
        z * CELL + (Math.random() - 0.5) * 2.2,
      );
      scene.add(p.object);
      state.props.push(p);
    }
  }
}

function placeSconces(): void {
  let placed = 0, tries = 0;
  while (placed < 5 && tries++ < 300) {
    const x = 1 + ((Math.random() * (GRID - 2)) | 0);
    const z = 1 + ((Math.random() * (GRID - 2)) | 0);
    if (state.maze[z][x] !== 0 || Math.hypot(x - 1, z - 1) < 3) continue;
    // Only cells with a wall to mount on.
    const dirs = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dz]) => state.maze[z + dz][x + dx] === 1);
    if (!dirs.length) continue;
    const [dx, dz] = dirs[(Math.random() * dirs.length) | 0];
    const s = makeSconce();
    s.group.position.set(x * CELL + dx * (CELL / 2 - 0.14), 2.25, z * CELL + dz * (CELL / 2 - 0.14));
    scene.add(s.group);
    state.sconces.push(s);
    placed++;
  }
}

/** Build a fresh dungeon and reset the run. Restart calls this too. */
export function buildWorld(): void {
  clearWorld();

  state.maze = generateDungeon();
  state.exitCell = { x: GRID - 2, z: GRID - 2 };
  state.maze[state.exitCell.z][state.exitCell.x] = 0;

  // Nothing spawns on the spot the player stands on or the one they escape through.
  claimed.clear();
  claimed.add(cellKey(1, 1));
  claimed.add(cellKey(state.exitCell.x, state.exitCell.z));

  buildGeometry();

  portal.position.set(state.exitCell.x * CELL, 1.5, state.exitCell.z * CELL);
  portalCore.position.copy(portal.position);
  portalLight.position.set(state.exitCell.x * CELL, 1.8, state.exitCell.z * CELL);

  spawnMonsters();
  spawnChests();
  scatterProps();
  placeSconces();

  // ---- Reset player and items ----
  state.pos.set(CELL, EYE_H, CELL);
  state.yaw = Math.PI * 0.25;
  state.pitch = 0;
  lockHintEl.style.display = pointerLock.locked || pointerLock.tried ? 'none' : 'flex';

  state.hp = 100;
  state.runGold = 0;
  state.gameOver = false;
  state.atkTimer = 0;
  state.swingT = -1;
  state.swingHit = false;
  // Gear carried out of the previous stage. A fresh run has none of it.
  state.hasTorch = progress.hasTorch;
  state.hasMap = progress.hasMap;
  handTorch.visible = state.hasTorch;

  // The sword is the default. Q swaps to the musket: one chambered round plus START_AMMO spare.
  state.hasMusket = true;
  state.ammo = progress.ammo;
  state.loaded = true;
  state.reloadT = -1;
  state.recoilT = -1;
  wpnBtn.classList.add('show');
  setWeapon('sword');

  // The torch and map change how the dungeon reads, so a carried one has to be
  // applied here rather than only where it is picked up.
  torch.distance = state.hasTorch ? 19 : 11;
  state.torchBase = state.hasTorch ? 2.7 : 1.75;
  fog.density = state.hasTorch ? FOG_TORCH : FOG_BASE;

  minimapEl.style.display = state.hasMap ? 'block' : 'none';
  objectiveEl.style.opacity = '1';
  if (guideTimer !== null) clearTimeout(guideTimer);
  guideTimer = setTimeout(() => {
    objectiveEl.style.opacity = '0';
  }, 7000);

  cancelLoot();
  updateHUD();
  overlayEl.style.display = 'none';
}
