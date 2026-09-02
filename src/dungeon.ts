import { GRID } from './config';
import type { GridCell, Maze } from './types';

/**
 * 재귀적 백트래킹으로 미로를 판 뒤, 넓은 방 6개를 덮어써서 개방감을 준다.
 * 반환값은 maze[z][x] — 0이 통로, 1이 벽.
 */
export function generateDungeon(): Maze {
  const g: Maze = Array.from({ length: GRID }, () => Array<number>(GRID).fill(1));
  const stack: GridCell[] = [[1, 1]];
  g[1][1] = 0;
  const dirs: GridCell[] = [[0, 2], [0, -2], [2, 0], [-2, 0]];

  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    // [다음 칸 x, z, 사이 벽 x, z]
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

  // 방 파내기
  for (let i = 0; i < 6; i++) {
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
 * (sx,sz)에서 (tx,tz)로 가는 최단 경로의 **첫 걸음**만 돌려준다.
 * 크리처는 매 프레임 목표가 움직이므로 전체 경로를 들고 있을 필요가 없다.
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
        // 목표에서 출발점 바로 다음 칸까지 거꾸로 따라 올라간다.
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
