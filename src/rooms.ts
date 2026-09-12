import * as THREE from 'three';
import { furnitureModel } from './assets';
import { CELL, LANDMARK_INFO, ROOM_DETAIL as D, ROOM_INLAY_HEIGHT, ROOM_LAMP, WALL_H } from './config';
import type { Chest, DungeonRoom, FurnitureKey, Monster, RoomKind } from './types';

/**
 * The three landmark rooms: what stands in them, and what the floor says.
 *
 * The furniture is real geometry now — Poly Haven's CC0 models, fetched and
 * baked by `npm run fetch-assets` — where it used to be coloured boxes standing
 * in for shelves and banners. At lamplight range the boxes read as flat panels
 * stuck to the wall, which made an authored room look less finished than the
 * corridor outside it.
 *
 * What is still drawn in code is what a model cannot do: the floor inlay that
 * names the room even when a carved corridor has opened one of its walls, and
 * the lamp that lights it. Both are thin or overhead, so neither can hide a
 * bear trap or a chest.
 *
 * Every model is optional, like every other asset here. A missing file leaves a
 * box of about its size in its place — the room keeps its shape and its lamp,
 * and the `[assets]` log says which file to drop in.
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

/** One piece of furniture, in metres from the room's centre. */
interface Piece {
  key: FurnitureKey;
  x: number;
  z: number;
  yaw?: number;
}

/**
 * Where each room's furniture stands.
 *
 * A room is three cells — twelve metres — so its walls are 6m from the centre.
 * Nothing is placed within 2m of that centre: the chest a room is built around
 * sits there, and the guard stands a cell behind it. Everything else hugs a
 * wall at 4.4-5m, which is also what keeps it clear of a doorway another
 * corridor may have carved through any side.
 */
const FURNISHING: Record<RoomKind, readonly Piece[]> = {
  // The figure faces the door across its own offering.
  chapel: [
    { key: 'statue', x: 0, z: -4.7 },
    { key: 'candlestick', x: -1.9, z: -2.7 },
    { key: 'candlestick', x: 1.9, z: -2.7 },
    { key: 'crate', x: -4.7, z: 4.5, yaw: 0.4 },
  ],
  // Shelving down both long walls, with the overflow stacked in the corners.
  store: [
    { key: 'shelf', x: -4.9, z: -3.3, yaw: Math.PI / 2 },
    { key: 'shelf', x: -4.9, z: 0, yaw: Math.PI / 2 },
    { key: 'shelf', x: -4.9, z: 3.3, yaw: Math.PI / 2 },
    { key: 'shelf', x: 4.9, z: -3.3, yaw: -Math.PI / 2 },
    { key: 'shelf', x: 4.9, z: 3.3, yaw: -Math.PI / 2 },
    { key: 'barrel', x: 4.4, z: -0.2 },
    { key: 'crate', x: 3.9, z: 4.6, yaw: -0.3 },
    { key: 'crate', x: -3.6, z: -4.7, yaw: 0.7 },
  ],
  // Somewhere a watch was actually kept: a table, seats, and stores to hand.
  guard: [
    { key: 'table', x: 3.2, z: 2.6, yaw: 0.35 },
    { key: 'stool', x: 1.9, z: 3.5, yaw: 1.1 },
    { key: 'stool', x: 4.3, z: 1.3, yaw: -0.6 },
    { key: 'barrel', x: -4.6, z: 4.3 },
    { key: 'barrel', x: -4.5, z: 2.6 },
    { key: 'crate', x: -4.5, z: -4.4, yaw: 0.2 },
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

/** Distinct floors and furnished interiors; nothing here obstructs the room. */
export function buildRooms(rooms: DungeonRoom[]): THREE.Group {
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
    for (const piece of FURNISHING[room.kind]) {
      const model = furnitureModel(piece.key);
      const x = cx + piece.x, z = cz + piece.z;
      if (model) {
        // Cloned per placement: one loaded model stands in every room that
        // wants it, and the clones share its geometry and materials.
        const copy = model.clone(true);
        copy.position.set(x, model.position.y, z);
        copy.rotation.y = piece.yaw ?? 0;
        root.add(copy);
        continue;
      }
      const s = STAND_IN[piece.key];
      box(x, s.h / 2, z, s.w, s.h, s.d, s.colour, piece.yaw ?? 0);
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
