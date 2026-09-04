import { initAudio, isMuted, setMuted, sfxDash } from './audio';
import { DASH_CD, GUIDE_KEY, LANTERN_KEY, POTION_KEY, SOUND_KEY } from './config';
import { el, queryChild } from './dom';
import { canvasEl } from './scene';
import { state } from './state';
import { tryAttack } from './combat';
import { closeGuide, isGuideOpen, toggleGuide } from './guide';
import { startLoot, useLantern, usePotion } from './loot';
import {
  atkBtn, dashBtn, guideBtn, guideCloseBtn, lampBtn, lockHintEl, lootBtn, potBtn, showMsg,
  soundBtn, wpnBtn,
} from './ui';
import { setWeapon, toggleWeapon } from './weapons';

const SENS = 0.0022;
const PITCH_MAX = 0.7;
/** This fraction of the screen's left and right edges is the 'edge turn' zone. */
const EDGE_FRAC = 0.12;
/** Top speed of the edge turn, in rad/s. */
const EDGE_TURN = 1.6;

// ================= Keyboard =================
export const keys: Record<string, boolean> = {};

/**
 * The move input this frame, as forward and strafe in -1..1, keyboard and
 * virtual stick summed. Lives here rather than in the frame loop because both
 * the loop and the dodge below need it, and the raw inputs are here.
 */
export function moveInput(): { f: number; s: number } {
  let f = 0, s = 0;
  if (keys['KeyW'] || keys['ArrowUp']) f += 1;
  if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
  if (keys['KeyA']) s -= 1;
  if (keys['KeyD']) s += 1;
  f += -moveVec.y;
  s += moveVec.x;
  return { f, s };
}

/**
 * Starts a dodge in whatever direction the player is already holding, or
 * straight ahead when they are standing still.
 *
 * The direction is locked in here rather than read every frame, so turning the
 * mouse mid-dodge does not curve it. A dodge that steers is just fast walking.
 * All this does is set state; updatePlayer() moves the player, which is what
 * keeps the dodge inside the same wall checks as walking.
 */
export function tryDash(): void {
  if (state.gameOver || state.dashT >= 0 || state.dashCd > 0) return;

  const { f, s } = moveInput();
  const len = Math.hypot(f, s);
  const [nf, ns] = len > 0.01 ? [f / len, s / len] : [1, 0];
  state.dashX = Math.sin(state.yaw) * nf - Math.cos(state.yaw) * ns;
  state.dashZ = Math.cos(state.yaw) * nf + Math.sin(state.yaw) * ns;
  state.dashSide = Math.abs(ns) > 0.2 ? Math.sign(ns) : 0;
  state.dashT = 0;
  state.dashCd = DASH_CD;
  sfxDash();
}

addEventListener('keydown', (e) => {
  // With the guide open only the keys that can close it or change the sound do
  // anything — otherwise Space would swing the sword at a paused dungeon.
  if (isGuideOpen()) {
    if (e.code === `Key${GUIDE_KEY}` || e.code === 'Escape') closeGuide();
    if (e.code === `Key${SOUND_KEY}`) toggleSound();
    return;
  }

  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    tryAttack();
  }
  if (e.code === 'KeyE') startLoot();
  if (e.code === `Key${GUIDE_KEY}`) toggleGuide();
  if (e.code === `Key${SOUND_KEY}`) toggleSound();
  // Shift, not a direction key of its own: the dodge goes where you are already
  // going, so it adds a finger rather than a decision.
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
  // Keep Q working on a Korean keyboard layout, where it types ㅂ.
  if (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') toggleWeapon();
  if (e.code === 'Digit1') setWeapon('sword');
  if (e.code === 'Digit2' && state.hasMusket) setWeapon('musket');
  // Matched on e.key as well as e.code so the digits still work on a numpad.
  if (e.code === `Digit${POTION_KEY}` || e.key === POTION_KEY) usePotion();
  if (e.code === `Digit${LANTERN_KEY}` || e.key === LANTERN_KEY) useLantern();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// ================= Mouse =================
// Moving the mouse turns the view with no click needed. A click requests pointer
// lock; once locked the cursor hides and the view turns without limit.
export const pointerLock = { locked: false, tried: false, failed: false };

/**
 * Whether the lock has ever been granted. Not the same as `tried`: it is what
 * separates "this browser will not do pointer lock" from "the browser refused
 * this one request", and the two want opposite handling.
 */
let everLocked = false;

let mouseX = -1;
let mouseInside = false;

const lockSupported = typeof canvasEl.requestPointerLock === 'function';

function requestLock(): void {
  if (!lockSupported || pointerLock.failed) return;
  try {
    // Some browsers return a Promise here, others return nothing at all.
    const r = canvasEl.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch(() => {
      // Same reasoning as the pointerlockerror handler below.
      if (!everLocked) pointerLock.failed = true;
      lockHintEl.style.display = 'none';
    });
  } catch {
    pointerLock.failed = true;
  }
}

document.addEventListener('pointerlockchange', () => {
  const was = pointerLock.locked;
  pointerLock.locked = document.pointerLockElement === canvasEl;
  lockHintEl.style.display = 'none';
  if (pointerLock.locked) {
    everLocked = true;
  } else if (was && !state.gameOver) {
    // Esc is easy to hit by accident, and the game carries on underneath with a
    // loose cursor. Say how to get back rather than leaving the player to guess.
    showMsg('Cursor released — click to lock it again');
  }
});
document.addEventListener('pointerlockerror', () => {
  // Chrome refuses a re-lock for about a second after the user pressed Esc, and
  // that refusal arrives here. Only give up on pointer lock if it has never
  // worked — otherwise one stray Esc would disable it for the rest of the run.
  if (!everLocked) pointerLock.failed = true;
  lockHintEl.style.display = 'none';
});

canvasEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  if (pointerLock.locked) {
    tryAttack();
    return;
  }
  // Unlocked, a click always asks for the lock back — not just the first one.
  // This used to run only while `tried` was false, so after Esc released the
  // lock every later click fell through to the attack below and the cursor
  // stayed loose for the rest of the run.
  if (lockSupported && !pointerLock.failed) {
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

const touchButtons = [
  [atkBtn, tryAttack], [lootBtn, startLoot], [wpnBtn, toggleWeapon],
  [potBtn, usePotion], [lampBtn, useLantern], [dashBtn, tryDash],
] as const;

for (const [btn, action] of touchButtons) {
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

/**
 * Whether touch belongs to the game rather than to the end-of-run overlay.
 *
 * The overlay is a scrollable panel, and the handlers below both preventDefault
 * and steal the touch for looking — so without this the shop cannot be scrolled
 * on a phone at all, however it is styled.
 */
function touchIsForGame(): boolean {
  return !state.gameOver && !state.paused;
}

/** Flips the sound and keeps the button showing which way it is. */
export function toggleSound(): void {
  setMuted(!isMuted());
  soundBtn.classList.toggle('muted', isMuted());
  showMsg(isMuted() ? 'Sound off' : 'Sound on');
}

soundBtn.classList.toggle('muted', isMuted());
for (const [btn, action] of [
  [guideBtn, toggleGuide], [soundBtn, toggleSound], [guideCloseBtn, closeGuide],
] as const) {
  // pointerdown rather than click so a phone does not wait for the tap delay,
  // and stopPropagation so it never reaches the canvas as an attack.
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    action();
  });
}

addEventListener(
  'touchstart',
  (e) => {
    if (!touchIsForGame()) return;
    for (const t of Array.from(e.changedTouches)) {
      if (touchButtons.some(([btn]) => t.target === btn)) continue;
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
    if (!touchIsForGame()) return;
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
  if (!touchIsForGame()) {
    // The run ended mid-drag; drop any stick or look the fingers still hold.
    resetStick();
    lookId = null;
    return;
  }
  for (const t of Array.from(e.changedTouches)) {
    if (t.identifier === stickId) resetStick();
    if (t.identifier === lookId) lookId = null;
  }
});

// ================= Audio unlock =================
for (const ev of ['keydown', 'pointerdown', 'touchstart'] as const) {
  addEventListener(ev, initAudio);
}
