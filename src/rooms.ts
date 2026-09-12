import * as THREE from 'three';
import { CELL, LANDMARK_INFO, ROOM_DETAIL as D, ROOM_INLAY_HEIGHT, ROOM_LAMP, ROOM_RELIEF_DEPTH, WALL_H } from './config';
import type { Chest, DungeonRoom, Maze, Monster } from './types';

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

/** Distinct silhouettes and floor markings, with all raised furniture on real walls. */
export function buildRooms(maze: Maze, rooms: DungeonRoom[]): THREE.Group {
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
    // Floor inlays make a room legible even when another carved room has
    // opened one of its walls. Thin geometry cannot conceal a bear trap.
    if (room.kind === 'chapel') {
      box(cx, ROOM_INLAY_HEIGHT / 2, cz, D.aisleWidth, ROOM_INLAY_HEIGHT, span, theme.colour);
      for (const side of [-1, 1]) box(cx + side * D.aisleWidth / 2, ROOM_INLAY_HEIGHT,
        cz, D.shelfBar, ROOM_INLAY_HEIGHT, span, D.trimColour);
    } else if (room.kind === 'guard') {
      box(cx, ROOM_INLAY_HEIGHT / 2, cz, span, ROOM_INLAY_HEIGHT, D.aisleWidth, theme.colour);
      box(cx, ROOM_INLAY_HEIGHT, cz, D.aisleWidth, ROOM_INLAY_HEIGHT, span, theme.colour);
    } else {
      for (let i = 0; i < room.size; i++) {
        box((room.x + i) * CELL, (D.beamBottom + WALL_H) / 2, cz,
          D.beamWidth, WALL_H - D.beamBottom, span, D.woodColour);
      }
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const yaw = dx === 0 ? 0 : Math.PI / 2;
      for (let i = 0; i < room.size; i++) {
        const gx = dx === 0 ? room.x + i : dx > 0 ? room.x + room.size - 1 : room.x;
        const gz = dz === 0 ? room.z + i : dz > 0 ? room.z + room.size - 1 : room.z;
        if (maze[gz + dz]?.[gx + dx] !== 1) continue;
        const wx = gx * CELL + dx * (CELL / 2 - ROOM_RELIEF_DEPTH / 2);
        const wz = gz * CELL + dz * (CELL / 2 - ROOM_RELIEF_DEPTH / 2);
        const wallBox = (side: number, y: number, w: number, h: number, colour: number): void => {
          box(wx + side * Math.cos(yaw), y, wz - side * Math.sin(yaw), w, h, ROOM_RELIEF_DEPTH, colour, yaw);
        };
        if (room.kind === 'store') {
          for (const side of [-1, 1]) wallBox(side * D.wallWidth / 2, D.shelfHeight / 2,
            D.shelfBar, D.shelfHeight, D.woodColour);
          for (let level = 1; level <= D.shelfLevels; level++) {
            wallBox(0, level * D.shelfHeight / D.shelfLevels, D.wallWidth, D.shelfBar, D.woodColour);
            // Shallow crates sit within the shelf's footprint, not in a walkable aisle.
            wallBox(0, (level - 0.5) * D.shelfHeight / D.shelfLevels,
              D.bannerWidth, D.shelfHeight / D.shelfLevels - D.shelfBar, theme.colour);
          }
        } else if (room.kind === 'chapel') {
          for (const side of [-1, 1]) wallBox(side * D.wallWidth / 2, WALL_H / 2,
            D.beamWidth, WALL_H, D.stoneColour);
          wallBox(0, D.bannerY, D.crestWidth, D.crestHeight, D.trimColour);
          wallBox(0, D.bannerY, D.crestCross, D.crestWidth, D.trimColour);
        } else {
          wallBox(0, D.bannerY, D.bannerWidth, D.bannerHeight, theme.colour);
          for (const side of [-1, 1]) wallBox(side * D.wallWidth / 2,
            D.bannerY, D.shelfBar, D.bannerHeight, D.ironColour);
          wallBox(0, D.bannerY + D.bannerHeight / 2, D.wallWidth, D.shelfBar, D.ironColour);
        }
      }
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
