import { initAudio } from './audio';
import { el, queryChild } from './dom';
import { canvasEl } from './scene';
import { state } from './state';
import { tryAttack } from './combat';
import { startLoot } from './loot';
import { atkBtn, lockHintEl, lootBtn, wpnBtn } from './ui';
import { setWeapon, toggleWeapon } from './weapons';

const SENS = 0.0022;
const PITCH_MAX = 0.7;
/** This fraction of the screen's left and right edges is the 'edge turn' zone. */
const EDGE_FRAC = 0.12;
/** Top speed of the edge turn, in rad/s. */
const EDGE_TURN = 1.6;

// ================= Keyboard =================
export const keys: Record<string, boolean> = {};

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    tryAttack();
  }
  if (e.code === 'KeyE') startLoot();
  // Keep Q working on a Korean keyboard layout, where it types ㅂ.
  if (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') toggleWeapon();
  if (e.code === 'Digit1') setWeapon('sword');
  if (e.code === 'Digit2' && state.hasMusket) setWeapon('musket');
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// ================= Mouse =================
// Moving the mouse turns the view with no click needed. A click requests pointer
// lock; once locked the cursor hides and the view turns without limit.
export const pointerLock = { locked: false, tried: false, failed: false };

let mouseX = -1;
let mouseInside = false;

const lockSupported = typeof canvasEl.requestPointerLock === 'function';

function requestLock(): void {
  if (!lockSupported || pointerLock.failed) return;
  try {
    // Some browsers return a Promise here, others return nothing at all.
    const r = canvasEl.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch(() => {
      pointerLock.failed = true;
      lockHintEl.style.display = 'none';
    });
  } catch {
    pointerLock.failed = true;
  }
}

document.addEventListener('pointerlockchange', () => {
  pointerLock.locked = document.pointerLockElement === canvasEl;
  lockHintEl.style.display = 'none';
});
document.addEventListener('pointerlockerror', () => {
  pointerLock.failed = true;
  lockHintEl.style.display = 'none';
});

canvasEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  if (pointerLock.locked) {
    tryAttack();
    return;
  }
  // The first click only asks for the lock.
  if (!pointerLock.tried && lockSupported) {
    pointerLock.tried = true;
    lockHintEl.style.display = 'none';
    requestLock();
    return;
  }
  // Where lock is unavailable, a click is an attack.
  tryAttack();
});

canvasEl.addEventListener('pointerenter', (e) => {
  if (e.pointerType !== 'touch') {
    mouseInside = true;
    mouseX = e.clientX;
  }
});
canvasEl.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch') mouseInside = false;
});

addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  mouseX = e.clientX;
  mouseInside = true;
  // Turn on mouse movement whether or not the pointer is locked; no click required.
  state.yaw -= e.movementX * SENS;
  state.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, state.pitch - e.movementY * SENS));
});

/** Unlocked, a cursor parked at the screen edge keeps turning that way. */
export function edgeTurn(dt: number): void {
  if (pointerLock.locked || !mouseInside || mouseX < 0) return;
  const edge = innerWidth * EDGE_FRAC;
  if (mouseX < edge) state.yaw += EDGE_TURN * (1 - mouseX / edge) * dt;
  else if (mouseX > innerWidth - edge) state.yaw -= EDGE_TURN * (1 - (innerWidth - mouseX) / edge) * dt;
}

// ================= Touch =================
const stick = el('moveStick');
const knob = queryChild(stick, '.knob');

/** Virtual stick input. x is strafe, y is forward/back with screen-down positive. */
export const moveVec = { x: 0, y: 0 };

let stickId: number | null = null;
let lookId: number | null = null;
let lookLastX = 0;

function updateStick(t: Touch): void {
  const r = stick.getBoundingClientRect();
  let dx = t.clientX - (r.left + r.width / 2);
  let dy = t.clientY - (r.top + r.height / 2);
  const max = r.width / 2;
  const len = Math.hypot(dx, dy);
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  moveVec.x = dx / max;
  moveVec.y = dy / max;
  knob.style.left = 28 + (dx / max) * 28 + '%';
  knob.style.top = 28 + (dy / max) * 28 + '%';
}

function resetStick(): void {
  stickId = null;
  moveVec.x = 0;
  moveVec.y = 0;
  knob.style.left = '28%';
  knob.style.top = '28%';
}

for (const [btn, action] of [[atkBtn, tryAttack], [lootBtn, startLoot], [wpnBtn, toggleWeapon]] as const) {
  btn.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      initAudio();
      action();
    },
    { passive: false },
  );
}

addEventListener(
  'touchstart',
  (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.target === atkBtn || t.target === lootBtn || t.target === wpnBtn) continue;
      // Left half of the screen is the move stick, right half drags the view.
      if (t.clientX < innerWidth / 2 && stickId === null) {
        stickId = t.identifier;
        updateStick(t);
      } else if (lookId === null) {
        lookId = t.identifier;
        lookLastX = t.clientX;
      }
    }
  },
  { passive: false },
);

addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) updateStick(t);
      else if (t.identifier === lookId) {
        state.yaw -= (t.clientX - lookLastX) * 0.006;
        lookLastX = t.clientX;
      }
    }
  },
  { passive: false },
);

addEventListener('touchend', (e) => {
  for (const t of Array.from(e.changedTouches)) {
    if (t.identifier === stickId) resetStick();
    if (t.identifier === lookId) lookId = null;
  }
});

// ================= Audio unlock =================
for (const ev of ['keydown', 'pointerdown', 'touchstart'] as const) {
  addEventListener(ev, initAudio);
}
