import * as THREE from 'three';
import { furnitureModel } from './assets';
import { CELL, LANDMARK_INFO, ROOM_DETAIL as D, ROOM_INLAY_HEIGHT, ROOM_LAMP, WALL_H } from './config';
import type { Chest, DungeonRoom, FurnitureKey, Maze, Monster, RoomKind } from './types';

/**
 * The three landmark rooms: what stands in them, and what the floor says.
 *
 * The furniture is real geometry — Poly Haven's CC0 models, fetched and baked
 * by `npm run fetch-assets` — where it used to be coloured boxes standing in
 * for shelves and banners. At lamplight range a box reads as a flat panel stuck
 * to the wall, which made an authored room look less finished than the corridor
 * outside it.
 *
 * **Nothing collides with any of it.** `collides()` reads the maze grid and
 * nothing else, and giving a bookcase its own collision box would strand the
 * creatures, which path on that same grid and cannot see one. So the large
 * pieces are backed onto real wall cells instead, and a piece with no wall to
 * stand against is not placed at all: a creature keeps its whole `clearance`
 * (1.15m and up) from a wall face and can never reach one, and the player, at
 * PLAYER_R, can only brush its front. Fixed coordinates put a bookcase in an
 * open doorway, which is exactly where something walks through it.
 *
 * What is still drawn in code is what a model cannot do: the floor inlay that
 * names the room even when a carved corridor has opened one of its walls, and
 * the lamp that lights it. Both are thin or overhead, so neither can hide a
 * bear trap or a chest.
 *
 * Every model is optional, like every other asset here. A missing file leaves a
 * box of about its size in its place, and the `[assets]` log says which file to
 * drop in.
 */

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ roughness: D.roughness });
const root = new THREE.Group();
const lampGeometry = new THREE.SphereGeometry(ROOM_LAMP.radius, 8, 6);
const lampMaterials = {
  chapel: new THREE.MeshBasicMaterial({ color: ROOM_LAMP.colours.chapel }),
  store: new THREE.MeshBasicMaterial({ color: ROOM_LAMP.colours.store }),
  guard: new THREE.MeshBasicMaterial({ color: ROOM_LAMP.colours.guard }),
};

/** Reassign existing loot and enemies, preserving counts, rewards and network indices. */
export function furnishRooms(rooms: DungeonRoom[], chests: Chest[], monsters: Monster[], hard: boolean): void {
  // Hard explicitly promises no supplies. Its one key chest retains its seeded
  // position; the room is a landmark, never a back door into normal-mode loot.
  const available = hard ? [] : chests.filter(c => c.item !== 'key');
  const guards = [...monsters].sort((a, b) => b.type.hp - a.type.hp);
  const used = new Set<Monster>();
  // The store chooses its potion before the other rooms take ordinary chests.
  const ordered = [...rooms].sort((a, b) => Number(b.kind === 'store') - Number(a.kind === 'store'));
  for (const room of ordered) {
    const cx = (room.x + (room.size - 1) / 2) * CELL;
    const cz = (room.z + (room.size - 1) / 2) * CELL;
    const preferred = room.kind === 'store' ? available.find(c => c.item === 'potion')
      : room.kind === 'guard' ? [...available].sort((a, b) => b.value - a.value)[0] : available[0];
    const chest = preferred ?? available[0];
    if (chest) {
      available.splice(available.indexOf(chest), 1);
      chest.mesh.position.set(cx, 0, cz);
      chest.mesh.rotation.y = Math.PI;
    }
    const guard = room.kind === 'guard' ? guards.find(m => !used.has(m))
      : room.kind === 'chapel' ? monsters.find(m => m.key === 'zombie' && !used.has(m)) : undefined;
    if (guard) {
      used.add(guard);
      guard.mesh.position.set(cx, 0, cz - CELL);
      guard.mesh.rotation.y = 0;
    }
  }
}

/**
 * One piece of furniture. A `wall` piece is backed onto that side of the room
 * and dropped if the maze opened it; the rest stand where they are put, in
 * metres from the room's centre.
 */
interface Piece {
  key: FurnitureKey;
  wall?: readonly [x: number, z: number];
  /** How far along that wall from its middle, in metres. */
  along?: number;
  x?: number;
  z?: number;
  yaw?: number;
}

/**
 * Where each room's furniture stands.
 *
 * A room is three cells — twelve metres — so its walls are 6m from the centre.
 * Nothing stands within 2m of that centre: the chest a room is built around
 * sits there, and its guard a cell behind it. Free-standing pieces are small
 * enough to walk around, since nothing here stops anyone walking through.
 */
const FURNISHING: Record<RoomKind, readonly Piece[]> = {
  // The figure stands against the far wall, over its own offering.
  chapel: [
    { key: 'statue', wall: [0, -1], along: 0 },
    { key: 'candlestick', x: -1.9, z: -2.7 },
    { key: 'candlestick', x: 1.9, z: -2.7 },
    { key: 'crate', wall: [-1, 0], along: 3.4 },
  ],
  // Shelving down whichever long walls the maze left standing.
  store: [
    { key: 'shelf', wall: [-1, 0], along: -3.4 },
    { key: 'shelf', wall: [-1, 0], along: 0 },
    { key: 'shelf', wall: [-1, 0], along: 3.4 },
    { key: 'shelf', wall: [1, 0], along: -3.4 },
    { key: 'shelf', wall: [1, 0], along: 3.4 },
    { key: 'barrel', wall: [0, 1], along: 1.8 },
    { key: 'crate', wall: [0, 1], along: -1.8 },
    { key: 'crate', wall: [0, -1], along: 3.6 },
  ],
  // Somewhere a watch was kept: a table and seats in the open, stores behind.
  guard: [
    { key: 'table', x: 3.2, z: 2.6, yaw: 0.35 },
    { key: 'stool', x: 1.9, z: 3.5, yaw: 1.1 },
    { key: 'stool', x: 4.3, z: 1.3, yaw: -0.6 },
    { key: 'barrel', wall: [-1, 0], along: 3.6 },
    { key: 'barrel', wall: [-1, 0], along: 1.9 },
    { key: 'crate', wall: [-1, 0], along: -3.6 },
  ],
};

/** Roughly what each model occupies, for the box that stands in when it is missing. */
const STAND_IN: Record<FurnitureKey, { w: number; h: number; d: number; colour: number }> = {
  statue: { w: 0.8, h: 2.1, d: 0.8, colour: D.stoneColour },
  candlestick: { w: 0.18, h: 1.15, d: 0.18, colour: D.trimColour },
  shelf: { w: 1.6, h: 1.9, d: 0.45, colour: D.woodColour },
  crate: { w: 0.72, h: 0.72, d: 0.72, colour: D.woodColour },
  barrel: { w: 0.7, h: 0.86, d: 0.7, colour: D.woodColour },
  table: { w: 1.2, h: 0.74, d: 0.7, colour: D.woodColour },
  stool: { w: 0.42, h: 0.46, d: 0.42, colour: D.woodColour },
};

/** Measured once per model: how deep it sits, so its back can go on the wall. */
const depths = new Map<THREE.Object3D, number>();
function depthOf(model: THREE.Object3D | null, fallback: number): number {
  if (!model) return fallback;
  const known = depths.get(model);
  if (known !== undefined) return known;
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  // The larger footprint decides: a model may be authored facing either axis.
  const d = Math.max(size.x, size.z);
  depths.set(model, d);
  return d;
}

/** The maze the rooms are being built into, for the wall checks below. */
let roomMaze: Maze = [];

/** A place against a wall: which side of the room, and which cell along it. */
interface Slot {
  dir: readonly [number, number];
  along: number;
}

/** The four sides, in the order a piece falls back through them. */
const SIDES: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * Every spot in this room with a wall behind it — one per cell of each side.
 *
 * A room's walls are not a given: the maze carves corridors through them, and
 * which sides survive changes with the seed. Enumerating what is actually
 * there, and letting a piece fall back to another slot, is what keeps a room
 * furnished when its own wall turned out to be a doorway. Skipping outright
 * left one wall of the store bare, which is the unfinished look this set out
 * to fix.
 */
function wallSlots(room: DungeonRoom): Slot[] {
  const mid = (room.size - 1) / 2;
  const slots: Slot[] = [];
  for (const dir of SIDES) {
    const [dx, dz] = dir;
    for (let i = 0; i < room.size; i++) {
      const step = i - mid;
      const gx = room.x + (dx > 0 ? room.size - 1 : dx < 0 ? 0 : mid + step);
      const gz = room.z + (dz > 0 ? room.size - 1 : dz < 0 ? 0 : mid + step);
      if (roomMaze[gz + dz]?.[gx + dx] === 1) slots.push({ dir, along: step * CELL });
    }
  }
  return slots;
}

/** Where a slot puts a piece of this depth: back to the wall, facing the room. */
function slotPlacement(room: DungeonRoom, slot: Slot, depth: number): { x: number; z: number; yaw: number } {
  const cx = (room.x + (room.size - 1) / 2) * CELL;
  const cz = (room.z + (room.size - 1) / 2) * CELL;
  const [dx, dz] = slot.dir;
  const mid = (room.size - 1) / 2;
  const step = slot.along / CELL;
  const gx = room.x + (dx > 0 ? room.size - 1 : dx < 0 ? 0 : mid + step);
  const gz = room.z + (dz > 0 ? room.size - 1 : dz < 0 ? 0 : mid + step);
  // Out to the wall face, then back off by half the piece's own depth.
  const back = CELL / 2 - depth / 2;
  return {
    x: dx === 0 ? cx + slot.along : gx * CELL + dx * back,
    z: dz === 0 ? cz + slot.along : gz * CELL + dz * back,
    yaw: Math.atan2(-dx, -dz),
  };
}

/** Distinct floors and furnished interiors; nothing here obstructs the room. */
export function buildRooms(maze: Maze, rooms: DungeonRoom[]): THREE.Group {
  roomMaze = maze;
  for (const child of root.children) if (child instanceof THREE.InstancedMesh) child.dispose();
  root.clear();
  const matrices: THREE.Matrix4[] = [];
  const colours: THREE.Color[] = [];
  const pose = new THREE.Object3D();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, colour: number, yaw = 0): void => {
    pose.position.set(x, y, z); pose.rotation.set(0, yaw, 0); pose.scale.set(w, h, d); pose.updateMatrix();
    matrices.push(pose.matrix.clone()); colours.push(new THREE.Color(colour));
  };

  for (const room of rooms) {
    const cx = (room.x + (room.size - 1) / 2) * CELL;
    const cz = (room.z + (room.size - 1) / 2) * CELL;
    const span = room.size * CELL;
    const theme = LANDMARK_INFO[room.kind];

    // ---- The lamp: one practical light, hung from the ceiling on a bar ----
    const lamp = new THREE.Mesh(lampGeometry, lampMaterials[room.kind]);
    lamp.position.set(cx, ROOM_LAMP.height, cz);
    root.add(lamp);
    const light = new THREE.PointLight(ROOM_LAMP.colours[room.kind], ROOM_LAMP.intensity, ROOM_LAMP.distance, ROOM_LAMP.decay);
    light.position.copy(lamp.position);
    root.add(light);
    box(cx, (WALL_H + ROOM_LAMP.height) / 2, cz, ROOM_LAMP.bar,
      WALL_H - ROOM_LAMP.height, ROOM_LAMP.bar, D.ironColour);
    for (const side of [-1, 1]) {
      box(cx, ROOM_LAMP.height + side * ROOM_LAMP.cage / 2, cz,
        ROOM_LAMP.cage, ROOM_LAMP.bar, ROOM_LAMP.cage, D.ironColour);
      box(cx + side * ROOM_LAMP.cage / 2, ROOM_LAMP.height, cz,
        ROOM_LAMP.bar, ROOM_LAMP.cage, ROOM_LAMP.bar, D.ironColour);
    }

    // ---- The floor: what names the room from the doorway ----
    // Thin enough to walk over and to leave a bear trap's jaws proud of it.
    if (room.kind === 'chapel') {
      box(cx, ROOM_INLAY_HEIGHT / 2, cz, D.aisleWidth, ROOM_INLAY_HEIGHT, span, theme.colour);
      for (const side of [-1, 1]) {
        box(cx + side * D.aisleWidth / 2, ROOM_INLAY_HEIGHT, cz, D.bar, ROOM_INLAY_HEIGHT, span, D.trimColour);
      }
    } else if (room.kind === 'guard') {
      box(cx, ROOM_INLAY_HEIGHT / 2, cz, span, ROOM_INLAY_HEIGHT, D.aisleWidth, theme.colour);
      box(cx, ROOM_INLAY_HEIGHT, cz, D.aisleWidth, ROOM_INLAY_HEIGHT, span, theme.colour);
    } else {
      // A boarded floor down each shelved wall, so the aisle between them reads.
      for (const side of [-1, 1]) {
        box(cx + side * (span / 2 - 1.4), ROOM_INLAY_HEIGHT / 2, cz, 2.4, ROOM_INLAY_HEIGHT, span, theme.colour);
      }
    }

    // ---- The furniture itself ----
    const free = wallSlots(room);
    for (const piece of FURNISHING[room.kind]) {
      const model = furnitureModel(piece.key);
      const stand = STAND_IN[piece.key];
      let x = cx + (piece.x ?? 0), z = cz + (piece.z ?? 0), yaw = piece.yaw ?? 0;

      if (piece.wall) {
        const want = piece.wall;
        const along = piece.along ?? 0;
        // The authored spot, then the same wall elsewhere, then any wall at all.
        let i = free.findIndex(sl => sl.dir === want && Math.abs(sl.along - along) < CELL / 2);
        if (i < 0) i = free.findIndex(sl => sl.dir === want);
        if (i < 0) i = 0;
        // A room with every side opened has nowhere to stand this; leave it out
        // rather than put it where something will walk through it.
        if (!free.length) continue;
        const slot = free.splice(i, 1)[0];
        ({ x, z, yaw } = slotPlacement(room, slot, depthOf(model, stand.d)));
      }

      if (model) {
        // Cloned per placement: one loaded model stands in every room that
        // wants it, and the clones share its geometry and materials.
        const copy = model.clone(true);
        copy.position.set(x, model.position.y, z);
        copy.rotation.y = yaw;
        root.add(copy);
        continue;
      }
      box(x, stand.h / 2, z, stand.w, stand.h, stand.d, stand.colour, yaw);
    }
  }

  if (matrices.length) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, colours[i]); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
  }
  root.name = 'Landmark rooms';
  return root;
}
