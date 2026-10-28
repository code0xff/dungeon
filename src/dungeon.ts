// The .ts is not a stylistic choice and must not be tidied away: server/host.ts
// imports this file directly under `node --experimental-strip-types` to rebuild
// the maze, and Node's resolver will not find an extensionless specifier. vite
// resolves it either way, so `npm run build` passes and the host dies at
// startup — which is exactly how this was found.
import {
  ARENA_SIZE, BOSS_STAGES, LANDMARK_KINDS, LANDMARK_SIZE, MAZE_ASPECT, MAZE_CELLS_PEAK, MAZE_CELLS_START, REF_FLOOR_CELLS, ROOM_COUNT, SPAWN_PEAK_STAGE,
} from './config.ts';
import { random } from './rng.ts';
import type { Arena, CreatureKey, DungeonRoom, GridCell, Maze, PathWorkspace } from './types';

/** The creature guarding this level's portal, or null on an ordinary stage. */
export function bossFor(level: number): CreatureKey | null {
  return BOSS_STAGES[level] ?? null;
}

/**
 * Where a boss stage's arena is: the far corner, where the exit always is, so
 * the portal stands inside it and the guardian is standing in front of it.
 * Purely a function of the grid size, so nothing has to send it anywhere.
 */
export function arenaBounds(gw: number, gh: number): Arena {
  return { x0: gw - 1 - ARENA_SIZE, z0: gh - 1 - ARENA_SIZE, x1: gw - 2, z1: gh - 2 };
}

export function inArena(a: Arena, gx: number, gz: number): boolean {
  return gx >= a.x0 && gx <= a.x1 && gz >= a.z0 && gz <= a.z1;
}

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
  const k = Math.sqrt(MAZE_ASPECT + random() * (1 - MAZE_ASPECT));
  const long = Math.max(4, Math.round(cells / k)), short = Math.max(4, Math.round(cells * k));
  // Which way round it is stretched, so dungeons are not all wide or all tall.
  const [cw, ch] = random() < 0.5 ? [long, short] : [short, long];
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
export function generateDungeon(gw: number, gh: number, landmarks?: DungeonRoom[], arena = false): Maze {
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
    const [nx, nz, wx, wz] = opts[(random() * opts.length) | 0];
    g[wz][wx] = 0;
    g[nz][nx] = 0;
    stack.push([nx, nz]);
  }

  // Carve the rooms, in proportion to how much dungeon there is to carve them in.
  const rooms = Math.max(LANDMARK_KINDS.length, Math.round((ROOM_COUNT * ((gw - 1) / 2) * ((gh - 1) / 2) * 2) / REF_FLOOR_CELLS));
  // Opposite regions keep three landmarks distinct even in the smallest map.
  // The optional metadata must never control RNG draws: the host only needs
  // the maze, and must carve exactly what clients with room metadata carve.
  const offset = Math.floor(random() * LANDMARK_KINDS.length);
  const farX = gw - LANDMARK_SIZE - 1, farZ = gh - LANDMARK_SIZE - 1;
  const anchors: readonly GridCell[] = [[farX, 1], [1, farZ], [farX, farZ]];
  for (let i = 0; i < rooms; i++) {
    let w = 3 + 2 * ((random() * 2) | 0), h = 3 + 2 * ((random() * 2) | 0);
    let x0 = 1 + 2 * ((random() * ((gw - w - 2) / 2)) | 0);
    let z0 = 1 + 2 * ((random() * ((gh - h - 2) / 2)) | 0);
    if (i < anchors.length) {
      [x0, z0] = anchors[i];
      w = h = LANDMARK_SIZE;
      landmarks?.push({ kind: LANDMARK_KINDS[(i + offset) % LANDMARK_KINDS.length], x: x0, z: z0, size: LANDMARK_SIZE });
    }
    for (let z = z0; z < z0 + h && z < gh - 1; z++) {
      for (let x = x0; x < x0 + w && x < gw - 1; x++) g[z][x] = 0;
    }
  }
  if (arena) {
    const a = arenaBounds(gw, gh);
    carveArena(g, a);
    // The far-corner landmark was carved where the arena now is. Its room is
    // gone, so its metadata goes too: a boss stage has one landmark fewer.
    // After every draw, so the stream is the same with the arena as without.
    if (landmarks) {
      for (let i = landmarks.length - 1; i >= 0; i--) {
        const r = landmarks[i];
        if (r.x + r.size > a.x0 - 1 && r.z + r.size > a.z0 - 1) landmarks.splice(i, 1);
      }
    }
  }
  return g;
}

/**
 * Opens the arena and walls it off, leaving it a room with a few ways in.
 *
 * Draws nothing from the RNG, so a boss stage's maze outside the arena is the
 * one the same seed carves on any stage, and the host can rebuild it with the
 * same call.
 *
 * The ring cuts the maze, and the maze is a tree, so cutting it can strand a
 * branch that only ever connected through the corner. Two gates are opened in
 * the middle of the two inner sides; then, wherever the ring is all that
 * separates floor the start reaches from floor it does not, it gets another
 * gate. That covers both ways round: a stranded branch outside, and the arena
 * itself when the gates happen to open onto a stranded branch — which is why
 * the test is "the two sides disagree", not "the outside is unreached".
 * Without it a seed now and then sealed the key's chest, a player, or the
 * portal out of the dungeon.
 */
function carveArena(g: Maze, a: Arena): void {
  const rx = a.x0 - 1, rz = a.z0 - 1;
  for (let z = a.z0; z <= a.z1; z++) for (let x = a.x0; x <= a.x1; x++) g[z][x] = 0;
  for (let z = rz; z <= a.z1; z++) g[z][rx] = 1;
  for (let x = rx; x <= a.x1; x++) g[rz][x] = 1;
  const mid = (ARENA_SIZE - 1) / 2;
  g[a.z0 + mid][rx] = 0;
  g[rz][a.x0 + mid] = 0;
  // Each pass opens one wall cell and re-floods, so it ends: there are only
  // 2 * ARENA_SIZE ring cells to open.
  for (;;) {
    const reached = flood(g);
    const split = (ox: number, oz: number, rx2: number, rz2: number, ix: number, iz: number): boolean =>
      g[rz2][rx2] === 1 && g[oz][ox] === 0 && reached[oz][ox] !== reached[iz][ix];
    let opened = false;
    for (let z = a.z0; z <= a.z1 && !opened; z++) {
      if (split(rx - 1, z, rx, z, a.x0, z)) { g[z][rx] = 0; opened = true; }
    }
    for (let x = a.x0; x <= a.x1 && !opened; x++) {
      if (split(x, rz - 1, x, rz, x, a.z0)) { g[rz][x] = 0; opened = true; }
    }
    if (!opened) return;
  }
}

/** Every floor cell reachable from the start. */
function flood(g: Maze): boolean[][] {
  const seen = g.map((row) => row.map(() => false));
  const stack: GridCell[] = [[1, 1]];
  seen[1][1] = true;
  while (stack.length) {
    // Non-null: the loop condition is that the stack is not empty.
    const [x, z] = stack.pop()!;
    for (const [dx, dz] of pathDirections) {
      const nx = x + dx, nz = z + dz;
      if (g[nz]?.[nx] !== 0 || seen[nz][nx]) continue;
      seen[nz][nx] = true;
      stack.push([nx, nz]);
    }
  }
  return seen;
}

const pathWorkspaces = new WeakMap<Maze, PathWorkspace>();
const pathDirections: readonly GridCell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Returns only the **first step** of the shortest path from (sx,sz) to (tx,tz).
 * A creature's target moves every frame, so holding the whole path buys nothing.
 */
export function findPath(maze: Maze, sx: number, sz: number, tx: number, tz: number): GridCell | null {
  if (sx === tx && sz === tz) return null;

  const gw = maze[0].length, gh = maze.length;
  let work = pathWorkspaces.get(maze);
  if (!work || work.queue.length !== gw * gh) {
    work = { queue: new Int32Array(gw * gh), first: new Int32Array(gw * gh), seen: new Uint8Array(gw * gh) };
    pathWorkspaces.set(maze, work);
  }
  // Reuse numeric storage instead of allocating tuples, Map and Set entries
  // per visited cell. Visits reset for moving targets and edited maps; weak
  // keys let an abandoned dungeon release its buffers.
  const { queue, first, seen } = work;
  seen.fill(0);
  const start = sx + sz * gw;
  queue[0] = start;
  seen[start] = 1;
  let head = 0, tail = 1;
  while (head < tail) {
    const cell = queue[head++];
    const x = cell % gw, z = Math.floor(cell / gw);
    for (const [dx, dz] of pathDirections) {
      const nx = x + dx, nz = z + dz;
      const next = nx + nz * gw;
      if (nx < 0 || nz < 0 || nx >= gw || nz >= gh || maze[nz][nx] === 1 || seen[next]) continue;
      seen[next] = 1;
      // Propagate the first step. FIFO and neighbour order match the original
      // BFS, including which of two equally short paths a creature chooses.
      first[next] = cell === start ? next : first[cell];
      if (nx === tx && nz === tz) {
        return [first[next] % gw, Math.floor(first[next] / gw)];
      }
      queue[tail++] = next;
    }
  }
  return null;
}
