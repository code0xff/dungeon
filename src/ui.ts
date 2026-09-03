import { CELL, GRID, LANTERN_KEY, POTION_KEY, SPAWN_PEAK_STAGE } from './config';
import { context2d, el, firstChild, queryChild } from './dom';
import { bankRun, loseRun, progress } from './progress';
import { state } from './state';

// ---- Frequently used elements ----
export const hpbarEl = el('hpbar');
export const goldEl = el('gold');
export const bankEl = el('bank');
const stageEl = el('stage');
export const itemsEl = el('items');
const slotsEl = el('slots');
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
export const potBtn = el('potBtn');
export const lampBtn = el('lampBtn');
export const dashBtn = el('dashBtn');
export const atkBtn = el('atkBtn');
export const minimapEl = el<HTMLCanvasElement>('minimap');

const potCount = queryChild(potBtn, '.count');
const lampCount = queryChild(lampBtn, '.count');

const mctx = context2d(minimapEl);

// ================= HUD =================
export function updateHUD(): void {
  hpbarEl.style.width = Math.max(0, state.hp) + '%';
  goldEl.textContent = String(state.runGold);
  bankEl.textContent = `Bank: ${progress.bankGold} G`;
  stageEl.textContent = `Stage ${progress.stage}`;

  const items: string[] = [];
  if (state.lanternT > 0) {
    const s = Math.ceil(state.lanternT);
    items.push(`Lantern ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }
  if (state.hasMap) items.push('Map');
  if (state.hasKey) items.push('Key');
  if (state.weapon === 'musket') {
    // The load state only means anything for the weapon actually in hand.
    items.push(state.loaded ? 'Musket loaded' : state.reloadT >= 0 ? 'Musket reloading' : 'Musket empty');
  } else {
    items.push('Sword');
  }
  if (state.hasMusket || state.ammo > 0) items.push(`${state.ammo} ammo`);
  itemsEl.textContent = items.length ? items.join('   ·   ') : 'No gear';

  // The pack. Empty slots stay listed so the key that spends them is learnable
  // before there is anything to spend.
  slotsEl.replaceChildren(
    slot(POTION_KEY, 'Potion', state.potions),
    slot(LANTERN_KEY, 'Lantern', state.lanterns),
  );
  dashBtn.classList.add('show');
  potBtn.classList.toggle('show', state.potions > 0);
  lampBtn.classList.toggle('show', state.lanterns > 0);
  potCount.textContent = String(state.potions);
  lampCount.textContent = String(state.lanterns);
}

/** One consumable slot: its key, its name and how many are left. */
function slot(key: string, name: string, count: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = count > 0 ? 'slot' : 'slot empty';
  const k = document.createElement('b');
  k.textContent = key;
  wrap.append(k, document.createTextNode(`${name} ${count}`));
  return wrap;
}

// ================= Centre-screen message =================
let msgTimer: ReturnType<typeof setTimeout> | null = null;

export function showMsg(text: string): void {
  // The gold line comes first and gets the accent; the rest is the pickup detail.
  // Only the wrapper is markup — the text itself goes in as a text node, so a
  // message can never inject anything.
  const [head, ...rest] = text.split('\n');
  msgEl.replaceChildren();
  if (head !== undefined) {
    const lead = document.createElement('span');
    if (/^[+-]/.test(head)) lead.className = 'gold';
    lead.textContent = head;
    msgEl.append(lead);
  }
  if (rest.length) msgEl.append(document.createTextNode('\n' + rest.join('\n')));
  msgEl.classList.add('show');
  if (msgTimer !== null) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    msgEl.classList.remove('show');
  }, 2200);
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
  // Whatever ends the run first is what happened. Without this, dying on the
  // extraction portal counted as both: updateMonsters() kills the player and
  // calls endRun(false), and then the portal check a few lines further down the
  // *same* frame calls endRun(true) — because `if (!state.gameOver)` was
  // evaluated before the death, and setting the flag inside the block does not
  // stop the rest of the block. The player was shown "Killed", lost the run,
  // and was then banked and advanced a stage anyway.
  //
  // Creatures also land more than one hit per frame, so this guards the double
  // loseRun() that came with that.
  if (state.gameOver) return;
  state.gameOver = true;
  cancelLoot();
  if (document.pointerLockElement) document.exitPointerLock();
  lockHintEl.style.display = 'none';

  const title = el('ovTitle');
  const desc = el('ovDesc');
  if (extracted) {
    // Captured before buildWorld() resets the run, which is why this runs here
    // and not when the player clicks through to the next stage.
    bankRun(state.runGold, {
      hp: state.hp, lanternT: state.lanternT, ammo: state.ammo,
      potions: state.potions, lanterns: state.lanterns,
    });
    title.textContent = 'Extracted';
    title.className = 'win';
    // Told, because the stage number is otherwise just a label — the player has
    // no way to know the dungeon fills up until something has already found them.
    const deeper = progress.stage <= SPAWN_PEAK_STAGE ? ' It will be busier down there.' : '';
    desc.textContent =
      `Banked ${state.runGold} G. Your gear carries to stage ${progress.stage}.${deeper}`;
  } else {
    const lost = [state.lanternT > 0 && 'lantern', state.ammo > 0 && `${state.ammo} ammo`]
      .filter(Boolean).join(' and ');
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
