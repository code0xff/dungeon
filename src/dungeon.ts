import {
  MAZE_ASPECT, MAZE_CELLS_PEAK, MAZE_CELLS_START, REF_FLOOR_CELLS, ROOM_COUNT, SPAWN_PEAK_STAGE,
} from './config';
import type { GridCell, Maze } from './types';

/**
 * Grid dimensions for a stage, walls included, so both come out odd.
 *
 * The size ramps from MAZE_CELLS_START to MAZE_CELLS_PEAK and then flattens,
 * on the same schedule as the spawn curve — a stage past the peak is harder
 * because of what is in it, not because the walk got longer again.
 *
 * The stretch is area-preserving: one axis is divided by sqrt(aspect) and the
 * other multiplied, so a long thin dungeon carries the same amount of content
 * as a square one and lands at the same point on the difficulty curve. Doing it
 * the obvious way — shortening one side — would have made every non-square
 * dungeon quietly easier than the number says.
 */
export function dungeonSize(stage: number): { gw: number; gh: number } {
  const t = Math.min(Math.max(stage, 1), SPAWN_PEAK_STAGE);
  const cells = MAZE_CELLS_START
    + (MAZE_CELLS_PEAK - MAZE_CELLS_START) * ((t - 1) / (SPAWN_PEAK_STAGE - 1));
  const k = Math.sqrt(MAZE_ASPECT + Math.random() * (1 - MAZE_ASPECT));
  const long = Math.max(4, Math.round(cells / k)), short = Math.max(4, Math.round(cells * k));
  // Which way round it is stretched, so dungeons are not all wide or all tall.
  const [cw, ch] = Math.random() < 0.5 ? [long, short] : [short, long];
  return { gw: cw * 2 + 1, gh: ch * 2 + 1 };
}

/**
 * Carves a maze by recursive backtracking, then stamps open rooms over it so the
 * layout does not feel like nothing but corridors.
 *
 * The room count is scaled by area rather than fixed: 11 rooms is generous in a
 * 15-cell dungeon and would be most of a 9-cell one, which would leave stage 1
 * an open field with no corridors to be cornered in.
 *
 * Returns maze[z][x] — 0 is floor, 1 is wall.
 */
export function generateDungeon(gw: number, gh: number): Maze {
  const g: Maze = Array.from({ length: gh }, () => Array<number>(gw).fill(1));
  const stack: GridCell[] = [[1, 1]];
  g[1][1] = 0;
  const dirs: GridCell[] = [[0, 2], [0, -2], [2, 0], [-2, 0]];

  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    // [next cell x, z, the wall between x, z]
    const opts = dirs
      .map(([dx, dz]) => [cx + dx, cz + dz, cx + dx / 2, cz + dz / 2] as const)
      .filter(([nx, nz]) => nx > 0 && nz > 0 && nx < gw - 1 && nz < gh - 1 && g[nz][nx] === 1);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [nx, nz, wx, wz] = opts[(Math.random() * opts.length) | 0];
    g[wz][wx] = 0;
    g[nz][nx] = 0;
    stack.push([nx, nz]);
  }

  // Carve the rooms, in proportion to how much dungeon there is to carve them in.
  const rooms = Math.max(2, Math.round((ROOM_COUNT * ((gw - 1) / 2) * ((gh - 1) / 2) * 2) / REF_FLOOR_CELLS));
  for (let i = 0; i < rooms; i++) {
    const w = 3 + 2 * ((Math.random() * 2) | 0), h = 3 + 2 * ((Math.random() * 2) | 0);
    const x0 = 1 + 2 * ((Math.random() * ((gw - w - 2) / 2)) | 0);
    const z0 = 1 + 2 * ((Math.random() * ((gh - h - 2) / 2)) | 0);
    for (let z = z0; z < z0 + h && z < gh - 1; z++) {
      for (let x = x0; x < x0 + w && x < gw - 1; x++) g[z][x] = 0;
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

  const gw = maze[0].length, gh = maze.length;
  const key = (x: number, z: number) => x + z * gw;
  const prev = new Map<number, GridCell>();
  const q: GridCell[] = [[sx, sz]];
  const seen = new Set<number>([key(sx, sz)]);

  while (q.length) {
    const [x, z] = q.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= gw || nz >= gh || maze[nz][nx] === 1 || seen.has(key(nx, nz))) continue;
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
