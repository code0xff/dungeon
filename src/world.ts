import * as THREE from 'three';
import { floorPBR, spawnCreature, wallPBR } from './assets';
import {
  CELL, CHEST_COUNT, EYE_H, FOG_BASE, GRID, PLAYER_R, SCALE_VARIANCE, SPAWN,
  SPEED_VARIANCE, TYPES, WALL_H,
} from './config';
import { generateDungeon } from './dungeon';
import { createChest, makeSconce, rollProp } from './props';
import { clipDuration, setAnim } from './assets';
import { fog, handTorch, portal, portalCore, portalLight, scene, torch, world } from './scene';
import { state } from './state';
import { ceilTex, floorTex, wallTex } from './textures';
import type { GridCell, ItemKind, Monster } from './types';
import { cancelLoot, minimapEl, objectiveEl, overlayEl, updateHUD, wpnBtn } from './ui';
import { pointerLock } from './input';
import { lockHintEl } from './ui';
import { setWeapon } from './weapons';

/**
 * 원 하나(반지름 r)가 벽 칸과 겹치는지. 주변 3x3 칸만 본다.
 * x축과 z축을 따로 판정하면 벽을 따라 미끄러진다.
 */
export function collides(wx: number, wz: number, r = PLAYER_R): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = Math.round(wx / CELL) + dx, gz = Math.round(wz / CELL) + dz;
      if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID || state.maze[gz][gx] !== 1) continue;
      const cx = gx * CELL, cz = gz * CELL, half = CELL / 2;
      const nx = Math.max(cx - half, Math.min(wx, cx + half));
      const nz = Math.max(cz - half, Math.min(wz, cz + half));
      if ((wx - nx) ** 2 + (wz - nz) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** [min, max] 범위의 난수. */
function rand([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

/** 시작 지점(1,1)에서 minDist 이상 떨어진 통로 칸. 못 찾으면 반대편 구석. */
function randomFloorCell(minDist: number): GridCell {
  for (let t = 0; t < 400; t++) {
    const x = 1 + ((Math.random() * (GRID - 2)) | 0);
    const z = 1 + ((Math.random() * (GRID - 2)) | 0);
    if (state.maze[z][x] !== 0 || Math.hypot(x - 1, z - 1) < minDist) continue;
    return [x, z];
  }
  return [GRID - 2, GRID - 2];
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
  state.monsters = [];
  state.chests = [];
  state.props = [];
  state.sconces = [];
}

function buildGeometry(): void {
  // ---- 벽: 인스턴스 메시 한 덩어리 ----
  const wallCells: GridCell[] = [];
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) if (state.maze[z][x] === 1) wallCells.push([x, z]);
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
    // 높이와 밝기를 조금씩 흩어 타일 티를 지운다.
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

  // ---- 바닥 / 천장 ----
  const size = GRID * CELL, cx = ((GRID - 1) * CELL) / 2;
  const floorMaps = floorPBR();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial(
      floorMaps ? { ...floorMaps, roughness: 0.9, metalness: 0.05 } : { map: floorTex, roughness: 0.85, metalness: 0.1 },
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cx);
  scene.add(floor);
  world.floor = floor;

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, WALL_H, cx);
  scene.add(ceil);
  world.ceil = ceil;
}

function spawnMonsters(): void {
  for (const key of SPAWN) {
    const t = TYPES[key];
    const [gx, gz] = randomFloorCell(6);
    const sp = spawnCreature(key);
    sp.mesh.position.set(gx * CELL, 0, gz * CELL);
    // 개체마다 크기를 살짝 흩어 복제 인간처럼 보이지 않게 한다.
    const scale = rand(SCALE_VARIANCE);
    sp.mesh.scale.setScalar(scale);
    // 대기 모션도 서로 다른 지점에서 시작시킨다 — 안 그러면 무리가 한 몸처럼 숨쉰다.
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
      speedMul: rand(SPEED_VARIANCE),
      anim: Math.random() * 6,
      bobSeed: Math.random() * 10,
      groanT: t.groan[0] + Math.random() * (t.groan[1] - t.groan[0]),
      dead: false,
      deadT: 0,
    };
    state.monsters.push(m);
  }
}

function spawnChests(): void {
  // 횃불·지도 각 1개는 반드시 나온다. 나머지는 탄약 2 · 물약 2.
  const items: ItemKind[] = ['torch', 'map', 'ammo', 'ammo', 'potion', 'potion'];
  for (let i = 0; i < CHEST_COUNT; i++) {
    const [gx, gz] = randomFloorCell(4);
    const c = createChest(20 + ((Math.random() * 60) | 0));
    c.mesh.position.set(gx * CELL + (Math.random() - 0.5) * 1.2, 0, gz * CELL + (Math.random() - 0.5) * 1.2);
    c.mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(c.mesh);
    state.chests.push({ ...c, item: null });
  }
  const order = state.chests.map((_, i) => i).sort(() => Math.random() - 0.5);
  items.forEach((it, i) => {
    state.chests[order[i]].item = it;
  });
}

function scatterProps(): void {
  for (let z = 1; z < GRID - 1; z++) {
    for (let x = 1; x < GRID - 1; x++) {
      // 시작 칸과 탈출 칸은 비워 둔다.
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
    const x = 1 + ((Math.random() * (GRID - 2)) | 0);
    const z = 1 + ((Math.random() * (GRID - 2)) | 0);
    if (state.maze[z][x] !== 0 || Math.hypot(x - 1, z - 1) < 3) continue;
    // 붙일 벽이 있는 칸만 고른다.
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

/** 던전을 새로 만들고 한 판을 초기화한다. 재시작도 이걸 부른다. */
export function buildWorld(): void {
  clearWorld();

  state.maze = generateDungeon();
  state.exitCell = { x: GRID - 2, z: GRID - 2 };
  state.maze[state.exitCell.z][state.exitCell.x] = 0;

  buildGeometry();

  portal.position.set(state.exitCell.x * CELL, 1.5, state.exitCell.z * CELL);
  portalCore.position.copy(portal.position);
  portalLight.position.set(state.exitCell.x * CELL, 1.8, state.exitCell.z * CELL);

  spawnMonsters();
  spawnChests();
  scatterProps();
  placeSconces();

  // ---- 플레이어 / 아이템 초기화 ----
  state.pos.set(CELL, EYE_H, CELL);
  state.yaw = Math.PI * 0.25;
  state.pitch = 0;
  lockHintEl.style.display = pointerLock.locked || pointerLock.tried ? 'none' : 'flex';

  state.hp = 100;
  state.runGold = 0;
  state.gameOver = false;
  state.atkTimer = 0;
  state.swingT = -1;
  state.swingHit = false;
  state.hasTorch = false;
  state.hasMap = false;
  handTorch.visible = false;

  // 검이 기본 무기. 머스킷은 Q로 전환 (장전 1발 + 예비 2발 소지).
  state.hasMusket = true;
  state.ammo = 2;
  state.loaded = true;
  state.reloadT = -1;
  state.recoilT = -1;
  wpnBtn.classList.add('show');
  setWeapon('sword');

  torch.distance = 11;
  state.torchBase = 1.75;
  fog.density = FOG_BASE;

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
