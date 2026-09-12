import * as THREE from 'three';
import {
  ARCHITECTURE_BAYS, ARCHITECTURE_COLOURS, ARCHITECTURE_CREST,
  ARCHITECTURE_DEPTH, ARCHITECTURE_ROUGHNESS, ARCHITECTURE_SPACING, ARCHITECTURE_TOP,
  ARCHITECTURE_WIDTH, CELL, WALL_H,
} from './config';
import type { Maze } from './types';
import { wallTex } from './textures';

// One shared box and material; every rib and crest is an instance. Extra
// landmarks should not mean hundreds of extra submissions on a phone.
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ map: wallTex, roughness: ARCHITECTURE_ROUGHNESS });
const root = new THREE.Group();

/** Wall relief and overhead ribs only: the collision grid remains the floor plan. */
export function buildArchitecture(maze: Maze): THREE.Group {
  for (const child of root.children) {
    if (child instanceof THREE.InstancedMesh) child.dispose();
  }
  root.clear();
  const transforms: THREE.Matrix4[] = [];
  const colours: THREE.Color[] = [];
  const pose = new THREE.Object3D();
  const half = CELL / 2;
  let bays = 0;

  for (let z = 1; z < maze.length - 1; z++) {
    for (let x = 1; x < maze[z].length - 1; x++) {
      if (maze[z][x] !== 0 || (x + z) % ARCHITECTURE_SPACING !== 0 || bays >= ARCHITECTURE_BAYS) continue;
      // Purely geometric selection consumes no random draws: adding decoration
      // must not change the key, traps, or the co-op host's seeded dungeon.
      const wallX = maze[z][x - 1] === 1 && maze[z][x + 1] === 1;
      const wallZ = maze[z - 1][x] === 1 && maze[z + 1][x] === 1;
      if (!wallX && !wallZ) continue;
      const yaw = wallX ? 0 : Math.PI / 2;
      const colour = ARCHITECTURE_COLOURS[Math.floor(x / ARCHITECTURE_SPACING) % ARCHITECTURE_COLOURS.length];
      const add = (px: number, py: number, pz: number, w: number, h: number, d: number): void => {
        pose.position.set(x * CELL + px * Math.cos(yaw) + pz * Math.sin(yaw), py,
          z * CELL - px * Math.sin(yaw) + pz * Math.cos(yaw));
        pose.rotation.set(0, yaw, 0);
        pose.scale.set(w, h, d);
        pose.updateMatrix();
        transforms.push(pose.matrix.clone());
        colours.push(new THREE.Color(colour));
      };
      for (const side of [-1, 1]) {
        const edge = side * (half - ARCHITECTURE_DEPTH / 2);
        add(edge, WALL_H / 2, 0, ARCHITECTURE_DEPTH, WALL_H, ARCHITECTURE_WIDTH);
        // A recessed-looking crest breaks the upright silhouette, mounted high
        // enough that the chest wire and bear-trap jaws remain unobstructed.
        add(edge, ARCHITECTURE_CREST.y, 0, ARCHITECTURE_DEPTH,
          ARCHITECTURE_CREST.height, ARCHITECTURE_CREST.width);
      }
      add(0, (ARCHITECTURE_TOP + WALL_H) / 2, 0, CELL,
        WALL_H - ARCHITECTURE_TOP, ARCHITECTURE_WIDTH);
      bays++;
    }
  }
  if (transforms.length) {
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    transforms.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, colours[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
  }
  root.name = 'Corridor masonry';
  return root;
}
