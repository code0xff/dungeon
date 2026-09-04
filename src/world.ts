import * as THREE from 'three';
import { floorPBR, spawnCreature, wallPBR } from './assets';
import {
  CEIL_TILES_PER_CELL, CELL, CHEST_COUNT, CHEST_ITEMS, CHEST_TRAP_FRAC, EYE_H,
  FLOOR_TILES_PER_CELL, PLAYER_R, REF_FLOOR_CELLS, SCALE_VARIANCE, SPAWN, SPAWN_PEAK_STAGE,
  SPEED_VARIANCE, TRAP_COUNT, TYPES, WALL_H,
} from './config';
import { dungeonSize, generateDungeon } from './dungeon';
import { createChest, makeSconce, makeTrap, rollProp } from './props';
import { clipDuration, setAnim } from './assets';
import { progress } from './progress';
import { portal, portalCore, portalLight, scene, setLampLit, setPortalOpen, world } from './scene';
import { state } from './state';
import { ceilTex, floorTex, wallTex } from './textures';
import type { CreatureKey, GridCell, Monster } from './types';
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
      if (gx < 0 || gz < 0 || gx >= state.gw || gz >= state.gh || state.maze[gz][gx] !== 1) continue;
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

const cellKey = (x: number, z: number): number => z * state.gw + x;

function usable(x: number, z: number, minDist: number): boolean {
  return state.maze[z][x] === 0
    && Math.hypot(x - 1, z - 1) >= minDist
    && !claimed.has(cellKey(x, z));
}

/**
 * A free floor cell at least minDist from the start (1,1), claimed on the way out.
 * Falls back to a scan rather than a fixed corner: the old fallback returned the
 * far corner, which is exactly where the exit portal stands.
 */
function randomFloorCell(minDist: number): GridCell {
  for (let t = 0; t < 400; t++) {
    const x = 1 + ((Math.random() * (state.gw - 2)) | 0);
    const z = 1 + ((Math.random() * (state.gh - 2)) | 0);
    if (!usable(x, z, minDist)) continue;
    claimed.add(cellKey(x, z));
    return [x, z];
  }
  for (let z = 1; z < state.gh - 1; z++) {
    for (let x = 1; x < state.gw - 1; x++) {
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
  state.traps.forEach((t) => scene.remove(t.mesh));
  state.monsters = [];
  state.chests = [];
  state.props = [];
  state.sconces = [];
  state.traps = [];
}

function buildGeometry(): void {
  // ---- Walls: one instanced mesh for the lot ----
  const wallCells: GridCell[] = [];
  for (let z = 0; z < state.gh; z++) {
    for (let x = 0; x < state.gw; x++) if (state.maze[z][x] === 1) wallCells.push([x, z]);
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
  // The plane is sized to the dungeon, so the texture repeat has to be set here
  // rather than once at load: a fixed repeat would stretch the cobbles by
  // whatever the stage happened to change the map to.
  const w = state.gw * CELL, h = state.gh * CELL;
  const cx = ((state.gw - 1) * CELL) / 2, cz = ((state.gh - 1) * CELL) / 2;
  const floorMaps = floorPBR();
  for (const t of floorMaps ? Object.values(floorMaps) : [floorTex]) {
    t.repeat.set(state.gw * FLOOR_TILES_PER_CELL, state.gh * FLOOR_TILES_PER_CELL);
  }
  ceilTex.repeat.set(state.gw * CEIL_TILES_PER_CELL, state.gh * CEIL_TILES_PER_CELL);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial(
      floorMaps ? { ...floorMaps, roughness: 0.9, metalness: 0.05 } : { map: floorTex, roughness: 0.85, metalness: 0.1 },
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  scene.add(floor);
  world.floor = floor;

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, WALL_H, cz);
  scene.add(ceil);
  world.ceil = ceil;
}

/**
 * Open floor cells in the dungeon just carved, over the count the SPAWN and
 * CHEST_COUNT numbers were written against.
 *
 * Everything placed per run is multiplied by this. The dungeon changes size with
 * the stage now, and rooms are stamped at random on top, so the carved area is
 * not something that can be worked out ahead of time — it has to be counted.
 *
 * Without it, shrinking stage 1 would have made it *harder*: the same 40
 * creatures in a third of the space is three times the density, which is the
 * opposite of the point.
 */
function areaScale(): number {
  let floor = 0;
  for (let z = 0; z < state.gh; z++) {
    for (let x = 0; x < state.gw; x++) if (state.maze[z][x] === 0) floor++;
  }
  return floor / REF_FLOOR_CELLS;
}

/** How many of one creature this stage gets. See SPAWN in config.ts. */
function spawnCount(key: CreatureKey, stage: number): number {
  const { base, perStage } = SPAWN[key];
  // Clamping the stage rather than the total keeps the mix intact at the peak —
  // capping the sum would have quietly changed which creatures got dropped.
  const s = Math.min(Math.max(stage, 1), SPAWN_PEAK_STAGE);
  return Math.floor(base + perStage * (s - 1));
}

function spawnMonsters(scale: number): void {
  for (const key of Object.keys(SPAWN) as CreatureKey[]) {
    // At least one of each, so the mix does not lose its rarer half to rounding
    // in a small dungeon — meeting no brutes at all on stage 1 would teach the
    // wrong lesson about what is down there.
    const count = Math.max(1, Math.round(spawnCount(key, progress.stage) * scale));
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
    groundSpeed: 0,
    speedMul: rand(SPEED_VARIANCE),
    anim: Math.random() * 6,
    bobSeed: Math.random() * 10,
    groanT: t.groan[0] + Math.random() * (t.groan[1] - t.groan[0]),
    dead: false,
    deadT: 0,
  };
  state.monsters.push(m);
}

function spawnChests(scale: number): void {
  // Never fewer chests than there are guaranteed items: CHEST_ITEMS is ordered
  // with the key first because the run cannot end without it, and a dungeon too
  // small to hold the list would have indexed off the end of the chest array.
  const count = Math.max(CHEST_ITEMS.length, Math.round(CHEST_COUNT * scale));
  for (let i = 0; i < count; i++) {
    const [gx, gz] = randomFloorCell(4);
    const c = createChest(20 + ((Math.random() * 60) | 0), Math.random() < CHEST_TRAP_FRAC);
    c.mesh.position.set(gx * CELL + (Math.random() - 0.5) * 1.2, 0, gz * CELL + (Math.random() - 0.5) * 1.2);
    c.mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(c.mesh);
    state.chests.push({ ...c, item: null });
  }
  const order = state.chests.map((_, i) => i).sort(() => Math.random() - 0.5);
  CHEST_ITEMS.forEach((it, i) => {
    state.chests[order[i]].item = it;
  });
}

/**
 * Traps, on their own claimed cells so nothing else sits on top of one.
 *
 * minDist 5 keeps them off the doorstep: a trap inside the first couple of cells
 * would fire before the player has any idea what one looks like, and the whole
 * mechanic depends on learning the tell.
 */
function placeTraps(scale: number): void {
  const count = Math.round(TRAP_COUNT * scale);
  for (let i = 0; i < count; i++) {
    const [gx, gz] = randomFloorCell(5);
    const { group: mesh, jaws } = makeTrap();
    // Off-centre, so a corridor of them does not read as a dotted line.
    mesh.position.set(gx * CELL + (Math.random() - 0.5) * 1.4, 0, gz * CELL + (Math.random() - 0.5) * 1.4);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    state.traps.push({ mesh, jaws, sprung: false, springT: 0 });
  }
}

function scatterProps(): void {
  for (let z = 1; z < state.gh - 1; z++) {
    for (let x = 1; x < state.gw - 1; x++) {
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
    const x = 1 + ((Math.random() * (state.gw - 2)) | 0);
    const z = 1 + ((Math.random() * (state.gh - 2)) | 0);
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

  // The dungeon grows with the stage and is not always square, so its size has
  // to be settled before anything that indexes the grid runs.
  const { gw, gh } = dungeonSize(progress.stage);
  state.gw = gw;
  state.gh = gh;
  state.maze = generateDungeon(gw, gh);
  state.exitCell = { x: gw - 2, z: gh - 2 };
  state.maze[state.exitCell.z][state.exitCell.x] = 0;

  // Nothing spawns on the spot the player stands on or the one they escape through.
  claimed.clear();
  claimed.add(cellKey(1, 1));
  claimed.add(cellKey(state.exitCell.x, state.exitCell.z));

  buildGeometry();

  portal.position.set(state.exitCell.x * CELL, 1.5, state.exitCell.z * CELL);
  portalCore.position.copy(portal.position);
  portalLight.position.set(state.exitCell.x * CELL, 1.8, state.exitCell.z * CELL);

  // Counted once and shared: both populations are scaled by the same area, and
  // recounting the floor twice would be the only way for them to disagree.
  const scale = areaScale();
  spawnMonsters(scale);
  spawnChests(scale);
  placeTraps(scale);
  scatterProps();
  placeSconces();

  // ---- Reset player and items ----
  state.pos.set(CELL, EYE_H, CELL);
  state.yaw = Math.PI * 0.25;
  state.pitch = 0;
  lockHintEl.style.display = pointerLock.locked || pointerLock.tried ? 'none' : 'flex';

  state.hp = progress.hp;
  state.runGold = 0;
  state.gameOver = false;
  state.atkTimer = 0;
  state.atkQueue = 0;
  state.queueLunge = false;
  state.swingT = -1;
  state.swingHit = false;
  state.dashT = -1;
  state.dashCd = 0;
  state.dashSide = 0;
  state.lungeT = 0;
  state.swingLunge = false;
  state.lungeShown = false;
  state.lungeHitT = 0;
  state.swordDur = progress.swordDur;
  state.swordWarned = false;
  // Gear carried out of the previous stage. A fresh run has none of it.
  // The map is never carried — see the note on Progress in src/progress.ts.
  state.lanternT = progress.lanternT;
  state.lanternWarned = false;
  state.hasMap = false;
  // Each dungeon has its own key, so this never carries — it is the objective.
  state.hasKey = false;
  state.atPortal = false;
  setPortalOpen(false);
  state.potions = progress.potions;
  state.lanterns = progress.lanterns;
  state.whetstones = progress.whetstones;

  // The sword is the default. Q swaps to the musket: one chambered round plus START_AMMO spare.
  state.hasMusket = true;
  state.ammo = progress.ammo;
  state.loaded = true;
  state.reloadT = -1;
  state.recoilT = -1;
  wpnBtn.classList.add('show');
  setWeapon('sword');

  // A carried lantern changes how far the dungeon reads, so the light has to be
  // applied here and not only where one is picked up.
  state.lightBase = setLampLit(state.lanternT > 0);

  minimapEl.style.display = 'none';
  objectiveEl.style.opacity = '1';
  if (guideTimer !== null) clearTimeout(guideTimer);
  guideTimer = setTimeout(() => {
    objectiveEl.style.opacity = '0';
  }, 7000);

  cancelLoot();
  updateHUD();
  overlayEl.style.display = 'none';
}
