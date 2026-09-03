import { CELL, GRID } from './config';
import { context2d, el, firstChild } from './dom';
import { bankRun, loseRun, progress } from './progress';
import { state } from './state';

// ---- Frequently used elements ----
export const hpbarEl = el('hpbar');
export const goldEl = el('gold');
export const bankEl = el('bank');
const stageEl = el('stage');
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
  bankEl.textContent = `Bank: ${progress.bankGold} G`;
  stageEl.textContent = `Stage ${progress.stage}`;

  const items: string[] = [];
  if (state.hasTorch) items.push('🔥 Torch');
  if (state.hasMap) items.push('🗺 Map');
  if (state.hasMusket) {
    const equipped = state.weapon === 'musket' ? '[equipped] ' : '';
    const loadState = state.loaded ? 'loaded' : state.reloadT >= 0 ? 'reloading' : 'empty';
    items.push(`🔫 ${equipped}${loadState} · ${state.ammo} ammo`);
  } else if (state.ammo > 0) {
    items.push(`${state.ammo} ammo`);
  }
  itemsEl.textContent = 'Gear: ' + (items.length ? items.join(' · ') : 'none');
}

// ================= Centre-screen message =================
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

/** Flash a red vignette when the player is hit. */
export function flashHurt(): void {
  vignetteEl.classList.add('hurt');
  setTimeout(() => vignetteEl.classList.remove('hurt'), 140);
}

// ================= Minimap =================
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

// ================= End of run =================
export function endRun(extracted: boolean): void {
  state.gameOver = true;
  cancelLoot();
  if (document.pointerLockElement) document.exitPointerLock();
  lockHintEl.style.display = 'none';

  const title = el('ovTitle');
  const desc = el('ovDesc');
  if (extracted) {
    // Captured before buildWorld() resets the run, which is why this runs here
    // and not when the player clicks through to the next stage.
    bankRun(state.runGold, { hasTorch: state.hasTorch, hasMap: state.hasMap, ammo: state.ammo });
    title.textContent = 'Extracted';
    title.className = 'win';
    desc.textContent = `Banked ${state.runGold} G. Your gear carries to stage ${progress.stage}.`;
  } else {
    const lost = [state.hasTorch && 'torch', state.hasMap && 'map', state.ammo > 0 && `${state.ammo} ammo`]
      .filter(Boolean).join(', ');
    loseRun();
    title.textContent = 'Killed';
    title.className = 'dead';
    desc.textContent = lost
      ? `Your ${state.runGold} G and your ${lost} stayed down there...`
      : `Your ${state.runGold} G stayed down there...`;
  }
  el('ovBank').textContent = `Bank balance: ${progress.bankGold} G`;
  overlayEl.style.display = 'flex';
  updateHUD();
}

/** Cancel looting in progress and reset the progress bar. */
export function cancelLoot(): void {
  state.looting = null;
  lootBarEl.style.display = 'none';
  lootFillEl.style.width = '0%';
}
