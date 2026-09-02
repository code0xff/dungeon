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
/** 화면 좌우 이 비율만큼이 '가장자리 회전' 영역 */
const EDGE_FRAC = 0.12;
/** 가장자리 회전 최대 속도(rad/s) */
const EDGE_TURN = 1.6;

// ================= 키보드 =================
export const keys: Record<string, boolean> = {};

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    tryAttack();
  }
  if (e.code === 'KeyE') startLoot();
  // 한글 자판(ㅂ)에서도 Q가 먹게 한다.
  if (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') toggleWeapon();
  if (e.code === 'Digit1') setWeapon('sword');
  if (e.code === 'Digit2' && state.hasMusket) setWeapon('musket');
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// ================= 마우스 =================
// 클릭 없이 이동만으로 시선을 조작한다. 클릭하면 포인터 락을 시도하고,
// 락이 되면 커서가 숨겨지고 무제한으로 돌릴 수 있다.
export const pointerLock = { locked: false, tried: false, failed: false };

let mouseX = -1;
let mouseInside = false;

const lockSupported = typeof canvasEl.requestPointerLock === 'function';

function requestLock(): void {
  if (!lockSupported || pointerLock.failed) return;
  try {
    // 브라우저에 따라 Promise를 돌려주기도 하고 아무것도 안 돌려주기도 한다.
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
  // 첫 클릭은 잠금 시도에만 쓴다.
  if (!pointerLock.tried && lockSupported) {
    pointerLock.tried = true;
    lockHintEl.style.display = 'none';
    requestLock();
    return;
  }
  // 잠금이 안 되는 환경: 클릭 = 공격
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
  // 잠김 여부와 무관하게 이동량으로 회전한다 (클릭 불필요).
  state.yaw -= e.movementX * SENS;
  state.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, state.pitch - e.movementY * SENS));
});

/** 잠금이 안 된 상태에서 커서가 화면 가장자리에 있으면 그쪽으로 계속 돈다. */
export function edgeTurn(dt: number): void {
  if (pointerLock.locked || !mouseInside || mouseX < 0) return;
  const edge = innerWidth * EDGE_FRAC;
  if (mouseX < edge) state.yaw += EDGE_TURN * (1 - mouseX / edge) * dt;
  else if (mouseX > innerWidth - edge) state.yaw -= EDGE_TURN * (1 - (innerWidth - mouseX) / edge) * dt;
}

// ================= 터치 =================
const stick = el('moveStick');
const knob = queryChild(stick, '.knob');

/** 가상 스틱 입력. x=좌우, y=앞뒤(화면 아래가 +) */
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
      // 화면 왼쪽 절반은 이동 스틱, 오른쪽은 시선 드래그.
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

// ================= 오디오 잠금 해제 =================
for (const ev of ['keydown', 'pointerdown', 'touchstart'] as const) {
  addEventListener(ev, initAudio);
}
