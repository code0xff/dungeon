import * as THREE from 'three';
import { floorPBR, spawnCreature, wallPBR } from './assets';
import {
  BEYOND_DMG, BEYOND_HP, BEYOND_REWARD, BLACK_KNIGHT_SHADE, CEIL_TILES_PER_CELL, CELL, CHEST_COUNT, CHEST_ITEMS, CHEST_SAFE_ITEMS,
  CHEST_TRAP_FRAC, EYE_H, FINAL_STAGE, MAX_HP, SWORD_DUR_MAX,
  FLOOR_TILES_PER_CELL, PLAYER_R, REF_FLOOR_CELLS, SCALE_VARIANCE, SPAWN, SPAWN_PEAK_STAGE,
  SPEED_VARIANCE, TRAP_COUNT, TRAP_JITTER, TUTORIAL_KIT, TUTORIAL_ROOM, TUTORIAL_SEED, TYPES, WALL_H,
} from './config';
import { dungeonSize, generateDungeon } from './dungeon';
import { createChest, makeSconce, makeTrap, rollProp } from './props';
import { clipDuration, setAnim } from './assets';
import { progress } from './progress';
import {
  flashLight, muzzleFlash, portal, portalCore, portalLight, scene, setLampLit, setPortalOpen,
  SMOKE_REST_Y, smoke, world,
} from './scene';
import { clearMobSync } from './net/mobsync';
import { clearWorldSync } from './net/worldsync';
import { clearRemotes } from './net/remote';
import { coop, coopKit, runLevel } from './net/session';
import { random, setSeed, mixSeed, shuffle } from './rng';
import { state } from './state';
import { ceilTex, floorTex, wallTex } from './textures';
import type { CreatureKey, CreatureType, GridCell, ItemKind, Monster } from './types';
import { cancelLoot, drinkBarEl, minimapEl, objectiveEl, overlayEl, updateHUD, wpnBtn } from './ui';
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
  return min + random() * (max - min);
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
    const x = 1 + ((random() * (state.gw - 2)) | 0);
    const z = 1 + ((random() * (state.gh - 2)) | 0);
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
  // The allies of the last dungeon are not the allies of this one, and a body
  // left behind would stand in the new maze until the fade timer noticed.
  clearRemotes();
  // Same for the creature targets: they index the old dungeon's monster array,
  // and the next one is a different set of creatures at the same indices.
  clearMobSync();
  // And the chest grants: they are indices into the dungeon that just ended.
  clearWorldSync();
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
    const sy = 1 + random() * 0.06;
    pv.set(x * CELL, (WALL_H * sy) / 2 - 0.01, z * CELL);
    sc.set(1, sy, 1);
    m4.compose(pv, q, sc);
    wall.setMatrixAt(i, m4);
    col.setHSL(0.6, 0.05, 0.6 + random() * 0.4);
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
  const { base, perStage, fromStage = 1 } = SPAWN[key];
  // Clamping the stage rather than the total keeps the mix intact at the peak —
  // capping the sum would have quietly changed which creatures got dropped.
  const s = Math.min(Math.max(stage, 1), SPAWN_PEAK_STAGE);
  if (s < fromStage) return 0;
  return Math.floor(base + perStage * (s - fromStage));
}

function spawnMonsters(scale: number): void {
  for (const key of Object.keys(SPAWN) as CreatureKey[]) {
    // At least one of each, so the mix does not lose its rarer half to rounding
    // in a small dungeon — meeting no brutes at all on stage 1 would teach the
    // wrong lesson about what is down there.
    const raw = spawnCount(key, runLevel(progress.stage));
    // Zero means "not on this stage", and the one-of-each floor below must not
    // override it — that floor exists to keep a mix intact, not to put a
    // creature on a stage it was kept off.
    if (raw === 0) continue;
    const count = Math.max(1, Math.round(raw * scale));
    for (let i = 0; i < count; i++) spawnOne(key);
  }
}

/**
 * The creature type for this stage: the base one until the ending, and a
 * heavier copy below it. See BEYOND_HP in config.ts.
 *
 * A copy rather than a mutation of TYPES: the base entry is read by name in
 * places that must not see the growth — GUARD_LEAK_HEAVY decides "heavy" off
 * it, and the co-op follower's walk retiming reads its speed.
 */
function stageType(key: CreatureKey, level: number): CreatureType {
  const t = TYPES[key];
  const below = level - FINAL_STAGE;
  if (below <= 0) return t;
  return {
    ...t,
    hp: t.hp * (1 + BEYOND_HP) ** below,
    dmg: t.dmg * (1 + BEYOND_DMG) ** below,
    reward: Math.round(t.reward * (1 + BEYOND_REWARD) ** below),
  };
}

function spawnOne(key: CreatureKey): void {
  const [gx, gz] = randomFloorCell(6);
  spawnAt(key, gx * CELL, gz * CELL);
}

/**
 * Puts one creature at a world position and returns it. The dungeon's spawns
 * go through here from a random cell; the tutorial places its own by hand.
 */
export function spawnAt(key: CreatureKey, wx: number, wz: number): Monster {
  const t = stageType(key, runLevel(progress.stage));
  const sp = spawnCreature(key);
  sp.mesh.position.set(wx, 0, wz);
  // Yaw first, so the stagger lean rocks the creature backwards along its own
  // facing rather than along the world X axis — turnToward() writes rotation.y
  // every frame, and the default XYZ order would tilt a side-on creature sideways.
  sp.mesh.rotation.order = 'YXZ';
  // The Black Knight wears the player's body. Its materials are already cloned
  // per creature (for the hit flash), so darkening the colour here reaches only
  // this one. Colour, not emissive: the hit flash owns emissive and would wipe
  // an emissive tint on the first hit.
  if (key === 'blackknight') {
    sp.mesh.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.color) std.color.multiplyScalar(BLACK_KNIGHT_SHADE);
      }
    });
  }
  // Vary the size per creature so the crowd stops looking like clones.
  const scale = rand(SCALE_VARIANCE);
  sp.mesh.scale.setScalar(scale);
  // Start each idle at a different point too, or the horde breathes in unison.
  //
  // Drawn before the branch, not inside it. A creature whose model failed to
  // load has no playback and would have skipped the draw — and in co-op that is
  // not a cosmetic difference: one player missing one .glb would offset the
  // shared stream from that creature on, and every chest, trap and prop after it
  // would land somewhere else in their dungeon. Cosmetic randomness still has to
  // cost the same number of draws on every path.
  const idleOffset = random();
  if (sp.playback) {
    const idle = clipDuration(sp.playback, 'idle') ?? 0;
    setAnim(sp.playback, 'idle', { fade: 0, startAt: idleOffset * idle });
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
    swingSeq: 0,
    pendingHit: null,
    hurtT: 0,
    staggerT: 0,
    staggerX: 0,
    staggerZ: 0,
    alert: 0,
    repath: 0,
    step: null,
    moving: false,
    groundSpeed: 0,
    speedMul: rand(SPEED_VARIANCE),
    anim: random() * 6,
    bobSeed: random() * 10,
    groanT: t.groan[0] + random() * (t.groan[1] - t.groan[0]),
    dead: false,
    deadT: 0,
  };
  state.monsters.push(m);
  return m;
}

function spawnChests(scale: number): void {
  // Never fewer chests than there are guaranteed items: CHEST_ITEMS is ordered
  // with the key first because the run cannot end without it, and a dungeon too
  // small to hold the list would have indexed off the end of the chest array.
  const count = Math.max(CHEST_ITEMS.length, Math.round(CHEST_COUNT * scale));
  // Which chest holds which item is settled *before* the chests are built,
  // because a chest is trapped at construction — the tell goes on the lid then
  // — and one that will hold the key or the map has to be built untrapped. See
  // CHEST_SAFE_ITEMS for why those two and not the rest.
  const order = shuffle(Array.from({ length: count }, (_, i) => i));
  const itemAt = new Map<number, ItemKind>();
  CHEST_ITEMS.forEach((it, i) => itemAt.set(order[i], it));
  for (let i = 0; i < count; i++) {
    const [gx, gz] = randomFloorCell(4);
    const item = itemAt.get(i) ?? null;
    // The trap is rolled either way, so the number of draws does not depend on
    // what the chest holds and the rest of the layout stays where it was.
    const rolled = random() < CHEST_TRAP_FRAC;
    const trapped = rolled && !(item !== null && CHEST_SAFE_ITEMS.includes(item));
    const c = createChest(20 + ((random() * 60) | 0), trapped);
    c.mesh.position.set(gx * CELL + (random() - 0.5) * 1.2, 0, gz * CELL + (random() - 0.5) * 1.2);
    c.mesh.rotation.y = random() * Math.PI * 2;
    scene.add(c.mesh);
    state.chests.push({ ...c, item });
  }
}

/** One chest, placed by hand. The tutorial's; the dungeon rolls its own above. */
export function placeChest(wx: number, wz: number, item: ItemKind | null, trapped: boolean): void {
  const c = createChest(20, trapped);
  c.mesh.position.set(wx, 0, wz);
  c.mesh.rotation.y = Math.atan2(state.pos.x - wx, state.pos.z - wz);
  scene.add(c.mesh);
  state.chests.push({ ...c, item });
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
    // Anywhere in the cell, walls included — see TRAP_JITTER. A trap always near
    // the middle made hugging a wall a blanket answer.
    const jx = (random() * 2 - 1) * TRAP_JITTER, jz = (random() * 2 - 1) * TRAP_JITTER;
    mesh.position.set(gx * CELL + jx, 0, gz * CELL + jz);
    mesh.rotation.y = random() * Math.PI * 2;
    scene.add(mesh);
    state.traps.push({ mesh, jaws, sprung: false, springT: 0 });
  }
}

function scatterProps(): void {
  for (let z = 1; z < state.gh - 1; z++) {
    for (let x = 1; x < state.gw - 1; x++) {
      // Leave the start and exit cells clear.
      // Claimed cells hold traps, chests and creatures. A barrel dropped over a
      // trap hides the one thing the player is supposed to see coming.
      if (state.maze[z][x] !== 0 || claimed.has(cellKey(x, z))) continue;
      const p = rollProp();
      if (!p) continue;
      p.object.position.set(
        x * CELL + (random() - 0.5) * 2.2,
        p.object.position.y,
        z * CELL + (random() - 0.5) * 2.2,
      );
      scene.add(p.object);
      state.props.push(p);
    }
  }
}

function placeSconces(): void {
  let placed = 0, tries = 0;
  while (placed < 5 && tries++ < 300) {
    const x = 1 + ((random() * (state.gw - 2)) | 0);
    const z = 1 + ((random() * (state.gh - 2)) | 0);
    if (state.maze[z][x] !== 0 || Math.hypot(x - 1, z - 1) < 3) continue;
    // Only cells with a wall to mount on.
    const dirs = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dz]) => state.maze[z + dz][x + dx] === 1);
    if (!dirs.length) continue;
    const [dx, dz] = dirs[(random() * dirs.length) | 0];
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

  // Seeded before anything is placed, so this stage's layout is a pure function
  // of (run seed, stage). Reloading the page mid-run rebuilds the same dungeon
  // rather than rerolling one, which is the point: an extraction game where a
  // bad map can be refreshed away is not asking anything of the player.
  //
  // The run seed lives in progress.ts and is redrawn on death and on New game,
  // so a new run is a new dungeon — it is only fixed for as long as the run is.
  // In co-op the seed comes off the wire and is used as-is: every player has to
  // land in the same dungeon, and mixing it with a level they all share would
  // only be the same function applied by four machines.
  const level = runLevel(progress.stage);
  const seed = state.tutorial ? TUTORIAL_SEED : coop.active ? coop.seed : mixSeed(progress.seed, progress.stage);
  setSeed(seed);
  console.log(state.tutorial ? '[world] tutorial room' : coop.active
    ? `[world] co-op seed ${seed} level ${level}`
    : `[world] seed ${progress.seed} stage ${progress.stage} -> ${seed}`);

  // The dungeon grows with the stage and is not always square, so its size has
  // to be settled before anything that indexes the grid runs.
  //
  // The tutorial is one open room rather than a maze: every lesson in it wants
  // the zombie in sight and the player with space to dodge, and a corridor
  // gives neither.
  const { gw, gh } = state.tutorial ? { gw: TUTORIAL_ROOM, gh: TUTORIAL_ROOM } : dungeonSize(level);
  state.gw = gw;
  state.gh = gh;
  state.maze = state.tutorial
    ? Array.from({ length: gh }, (_, z) => Array.from({ length: gw }, (_, x) =>
      (x === 0 || z === 0 || x === gw - 1 || z === gh - 1 ? 1 : 0)))
    : generateDungeon(gw, gh);
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
  // The room starts empty; tutorial.ts brings each zombie in when its lesson
  // comes. No chests or traps either — the lesson is the sword, the shield and
  // the pack, and a trap under the first step would teach the wrong thing.
  if (!state.tutorial) {
    spawnMonsters(scale);
    spawnChests(scale);
    placeTraps(scale);
    scatterProps();
  }
  placeSconces();

  // ---- Reset player and items ----
  state.pos.set(CELL, EYE_H, CELL);
  state.yaw = Math.PI * 0.25;
  state.pitch = 0;
  lockHintEl.style.display = pointerLock.locked || pointerLock.tried ? 'none' : 'flex';

  // Co-op brings nothing in from the solo save — see docs/coop.md. The kit is
  // handed out by level instead, because there is no shop between runs.
  const kit = state.tutorial
    ? { ...TUTORIAL_KIT, hp: MAX_HP, swordDur: SWORD_DUR_MAX, lanternT: 0 }
    : coop.active ? coopKit(level) : progress;
  state.hp = kit.hp;
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
  state.guarding = false;
  state.guardT = 0;
  state.parryT = 0;
  state.parryCd = 0;
  state.parryShown = false;
  state.swingLunge = false;
  state.lungeHitT = 0;
  state.swordDur = kit.swordDur;
  state.swordWarned = false;
  // Gear carried out of the previous stage. A fresh run has none of it.
  // The map is never carried — see the note on Progress in src/progress.ts.
  // A potion left half-drunk when the run ended must not leave its bar on screen.
  state.drinkT = -1;
  drinkBarEl.style.display = 'none';
  // Cleared with the rest of the run. updateChests() rewrites it every frame,
  // but E and the loot button are read before the next frame — so starting a new
  // dungeon while stood beside a chest left the old one lootable for a moment,
  // paying out its gold or springing its trap in a world it no longer exists in.
  state.nearChest = null;
  state.lanternT = kit.lanternT;
  state.lanternWarned = false;
  state.hasMap = false;
  // Each dungeon has its own key, so this never carries — it is the objective.
  state.hasKey = false;
  state.atPortal = false;
  setPortalOpen(false);
  state.potions = kit.potions;
  state.lanterns = kit.lanterns;
  state.whetstones = kit.whetstones;

  // The sword is the default. Q swaps to the musket: one chambered round plus START_AMMO spare.
  state.hasMusket = true;
  state.ammo = kit.ammo;
  state.loaded = true;
  state.reloadT = -1;
  state.recoilT = -1;
  // The muzzle flash, its light and its smoke are driven by updateWeapons(),
  // which does not run once the run is over — so firing and dying inside the
  // same 0.09s froze all of them mid-fade and carried them into the next
  // dungeon. recoilT was already reset here; the rest was missed.
  //
  // The light and the smoke's height have to be put back **by hand**, and that
  // is the part that is easy to get wrong: both are only ever restored inside
  // the `flashT > 0` and `opacity > 0` branches of the loop. Zeroing the timer
  // and the opacity without them leaves a bright light following the player for
  // the whole next run, and a smoke puff hanging permanently above the muzzle.
  //
  // flashLight is shared with the lunge impact, whose lungeHitT is zeroed just
  // above — so this covers dying mid-lunge as well, which stranded the light on
  // before any of this existed.
  state.flashT = 0;
  muzzleFlash.visible = false;
  flashLight.intensity = 0;
  smoke.material.opacity = 0;
  smoke.position.y = SMOKE_REST_Y;
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
