import { GRID, ROOM_COUNT } from './config';
import type { GridCell, Maze } from './types';

/**
 * Carves a maze by recursive backtracking, then stamps ROOM_COUNT open rooms over
 * it so the layout does not feel like nothing but corridors.
 * Returns maze[z][x] — 0 is floor, 1 is wall.
 */
export function generateDungeon(): Maze {
  const g: Maze = Array.from({ length: GRID }, () => Array<number>(GRID).fill(1));
  const stack: GridCell[] = [[1, 1]];
  g[1][1] = 0;
  const dirs: GridCell[] = [[0, 2], [0, -2], [2, 0], [-2, 0]];

  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    // [next cell x, z, the wall between x, z]
    const opts = dirs
      .map(([dx, dz]) => [cx + dx, cz + dz, cx + dx / 2, cz + dz / 2] as const)
      .filter(([nx, nz]) => nx > 0 && nz > 0 && nx < GRID - 1 && nz < GRID - 1 && g[nz][nx] === 1);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [nx, nz, wx, wz] = opts[(Math.random() * opts.length) | 0];
    g[wz][wx] = 0;
    g[nz][nx] = 0;
    stack.push([nx, nz]);
  }

  // Carve the rooms
  for (let i = 0; i < ROOM_COUNT; i++) {
    const w = 3 + 2 * ((Math.random() * 2) | 0), h = 3 + 2 * ((Math.random() * 2) | 0);
    const x0 = 1 + 2 * ((Math.random() * ((GRID - w - 2) / 2)) | 0);
    const z0 = 1 + 2 * ((Math.random() * ((GRID - h - 2) / 2)) | 0);
    for (let z = z0; z < z0 + h && z < GRID - 1; z++) {
      for (let x = x0; x < x0 + w && x < GRID - 1; x++) g[z][x] = 0;
    }
  }
  return g;
}

/**
 * Returns only the **first step** of the shortest path from (sx,sz) to (tx,tz).
 * A creature's target moves every frame, so holding the whole path buys nothing.
 */
export function findPath(maze: Maze, sx: number, sz: number, tx: number, tz: number): GridCell | null {
  if (sx === tx && sz === tz) return null;

  const key = (x: number, z: number) => x + z * GRID;
  const prev = new Map<number, GridCell>();
  const q: GridCell[] = [[sx, sz]];
  const seen = new Set<number>([key(sx, sz)]);

  while (q.length) {
    const [x, z] = q.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID || maze[nz][nx] === 1 || seen.has(key(nx, nz))) continue;
      seen.add(key(nx, nz));
      prev.set(key(nx, nz), [x, z]);
      if (nx === tx && nz === tz) {
        // Walk back from the target to the cell right after the start.
        let cur: GridCell = [nx, nz];
        for (;;) {
          const p = prev.get(key(cur[0], cur[1]));
          if (!p) return cur;
          if (p[0] === sx && p[1] === sz) return cur;
          cur = p;
        }
      }
      q.push([nx, nz]);
    }
  }
  return null;
}
