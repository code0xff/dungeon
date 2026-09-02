import { CELL, GRID } from './config';
import { context2d, el, firstChild } from './dom';
import { state } from './state';

// ---- 자주 쓰는 엘리먼트 ----
export const hpbarEl = el('hpbar');
export const goldEl = el('gold');
export const bankEl = el('bank');
export const itemsEl = el('items');
export const msgEl = el('msg');
export const vignetteEl = el('vignette');
export const objectiveEl = el('objective');
export const overlayEl = el('overlay');
export const promptEl = el('prompt');
export const lootBarEl = el('lootBar');
export const lootFillEl = firstChild(lootBarEl);
export const reloadBarEl = el('reloadBar');
export const reloadFillEl = firstChild(reloadBarEl);
export const crosshairEl = el('crosshair');
export const lockHintEl = el('lockHint');
export const lootBtn = el('lootBtn');
export const wpnBtn = el('wpnBtn');
export const atkBtn = el('atkBtn');
export const minimapEl = el<HTMLCanvasElement>('minimap');

const mctx = context2d(minimapEl);

// ================= HUD =================
export function updateHUD(): void {
  hpbarEl.style.width = Math.max(0, state.hp) + '%';
  goldEl.textContent = String(state.runGold);
  bankEl.textContent = `금고: ${state.bankGold} G`;

  const items: string[] = [];
  if (state.hasTorch) items.push('🔥 횃불');
  if (state.hasMap) items.push('🗺 지도');
  if (state.hasMusket) {
    const equipped = state.weapon === 'musket' ? '[장착] ' : '';
    const loadState = state.loaded ? '장전됨' : state.reloadT >= 0 ? '장전중' : '빈총';
    items.push(`🔫 ${equipped}${loadState} · 탄약 ${state.ammo}`);
  } else if (state.ammo > 0) {
    items.push(`탄약 ${state.ammo}`);
  }
  itemsEl.textContent = '장비: ' + (items.length ? items.join(' · ') : '없음');
}

// ================= 화면 중앙 메시지 =================
let msgTimer: ReturnType<typeof setTimeout> | null = null;

export function showMsg(text: string): void {
  msgEl.textContent = text;
  msgEl.style.whiteSpace = 'pre-line';
  msgEl.style.opacity = '1';
  if (msgTimer !== null) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    msgEl.style.opacity = '0';
  }, 1800);
}

/** 피격 시 붉은 비네트를 잠깐 켠다. */
export function flashHurt(): void {
  vignetteEl.classList.add('hurt');
  setTimeout(() => vignetteEl.classList.remove('hurt'), 140);
}

// ================= 미니맵 =================
export function drawMinimap(): void {
  const s = minimapEl.width / GRID;
  mctx.clearRect(0, 0, minimapEl.width, minimapEl.height);

  mctx.fillStyle = 'rgba(201,192,174,.22)';
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) if (state.maze[z][x] === 1) mctx.fillRect(x * s, z * s, s, s);
  }
  for (const c of state.chests) {
    mctx.fillStyle = c.state === 'closed' ? '#d4b25a' : 'rgba(212,178,90,.3)';
    mctx.fillRect((c.mesh.position.x / CELL) * s - 2, (c.mesh.position.z / CELL) * s - 2, 4, 4);
  }
  mctx.fillStyle = '#6a9fd8';
  mctx.fillRect(state.exitCell.x * s - 1, state.exitCell.z * s - 1, s + 2, s + 2);

  const px = (state.pos.x / CELL) * s, pz = (state.pos.z / CELL) * s;
  mctx.fillStyle = '#ff9a45';
  mctx.beginPath();
  mctx.arc(px, pz, 3, 0, Math.PI * 2);
  mctx.fill();
  mctx.strokeStyle = '#ff9a45';
  mctx.beginPath();
  mctx.moveTo(px, pz);
  mctx.lineTo(px + Math.sin(state.yaw) * 7, pz + Math.cos(state.yaw) * 7);
  mctx.stroke();
}

// ================= 판 종료 =================
export function endRun(extracted: boolean): void {
  state.gameOver = true;
  cancelLoot();
  if (document.pointerLockElement) document.exitPointerLock();
  lockHintEl.style.display = 'none';

  const title = el('ovTitle');
  const desc = el('ovDesc');
  if (extracted) {
    state.bankGold += state.runGold;
    title.textContent = '탈출';
    title.className = 'win';
    desc.textContent = `이번 판 ${state.runGold} G를 금고에 넣었다.`;
  } else {
    title.textContent = '사망';
    title.className = 'dead';
    desc.textContent = `이번 판 ${state.runGold} G는 던전에 남았다...`;
  }
  el('ovBank').textContent = `금고 잔액: ${state.bankGold} G`;
  overlayEl.style.display = 'flex';
  updateHUD();
}

/** 진행 중인 루팅을 취소하고 진행 바를 되돌린다. */
export function cancelLoot(): void {
  state.looting = null;
  lootBarEl.style.display = 'none';
  lootFillEl.style.width = '0%';
}
