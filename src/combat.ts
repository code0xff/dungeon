import { clipDuration, setAnim } from './assets';
import { sfxHit, sfxLunge, sfxShot, sfxSwing } from './audio';
import {
  ATTACK_CD, ATTACK_RANGE, CORPSE_LINGER, LUNGE_DMG, MUSKET_DMG, MUSKET_RANGE,
  SHOT_ALERT_RADIUS, SHOT_ALERT_TIME,
  SWORD_ARC, SWORD_CLEAVE, SWORD_DMG_WORN, SWORD_DUR_MAX, SWORD_WARN_AT, SWORD_WEAR,
} from './config';
import { flashLight, muzzleFlash, scene, smoke } from './scene';
import { state } from './state';
import type { Monster } from './types';
import { cancelLoot, flashHurt, endRun, showMsg, updateHUD } from './ui';
import { startReload } from './weapons';

/**
 * What one sword hit takes off, scaled by durability.
 *
 * Linear from a full 1 down to SWORD_DMG_WORN, so the wear is felt gradually
 * rather than at a cliff. Creature hp is written in fresh-sword swings — a
 * zombie is 4 — which makes this directly readable as "how many more swings".
 */
function swordDamage(): number {
  const wear = state.swordDur / SWORD_DUR_MAX;
  return SWORD_DMG_WORN + (1 - SWORD_DMG_WORN) * Math.max(0, Math.min(1, wear));
}

/** Unit vector for the camera's horizontal facing. */
function facing(): [fx: number, fz: number] {
  return [-Math.sin(state.yaw + Math.PI), -Math.cos(state.yaw + Math.PI)];
}

export function killMonster(m: Monster): void {
  m.hp = 0;
  state.runGold += m.type.reward;
  updateHUD();
  // With a death clip, play it out and leave the corpse a moment. Without one, remove at once.
  if (m.playback?.clips.death) {
    m.dead = true;
    m.attackT = 0;
    m.pendingHit = null;
    m.deadT = (clipDuration(m.playback, 'death') ?? 2.5) + CORPSE_LINGER;
    setAnim(m.playback, 'death', { loop: false, force: true, fade: 0.1 });
  } else {
    scene.remove(m.mesh);
  }
}

/**
 * Everything within `radius` learns where the player is and hunts them for
 * `seconds`, whatever their aggro range.
 *
 * Shared because a musket and a chest lid differ only in how far they carry —
 * see SHOT_ALERT_RADIUS against CHEST_ALERT_RADIUS. Returns how many heard it,
 * which is what the player is told.
 */
export function alertCreatures(radius: number, seconds: number): number {
  let heard = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (Math.hypot(m.mesh.position.x - state.pos.x, m.mesh.position.z - state.pos.z) < radius) {
      m.alert = seconds;
      m.repath = 0;
      heard++;
    }
  }
  return heard;
}

export function fireMusket(): void {
  if (!state.loaded) {
    if (state.ammo <= 0) showMsg('Out of ammo');
    else if (state.reloadT < 0) startReload();
    return;
  }
  state.loaded = false;
  state.ammo--;
  state.recoilT = 0;
  state.flashT = 0.09;
  muzzleFlash.visible = true;
  smoke.material.opacity = 0.55;
  smoke.scale.set(1, 1, 1);
  flashLight.position.copy(state.pos);
  flashLight.intensity = 3.5;
  sfxShot();

  // Hitscan: the single creature closest in angle to where the player is looking.
  const [fx, fz] = facing();
  let best: Monster | null = null;
  let bestDot = 0.985;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const dx = m.mesh.position.x - state.pos.x, dz = m.mesh.position.z - state.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > MUSKET_RANGE) continue;
    const dot = (dx * fx + dz * fz) / (d || 1);
    // Widen the cone for creatures that are close or large.
    const tol = 0.985 - (m.type.r / (d || 1)) * 0.6;
    if (dot > tol && dot > bestDot - (0.985 - tol)) {
      best = m;
      bestDot = dot;
    }
  }
  if (best) {
    best.hp -= MUSKET_DMG;
    best.hurtT = 0.25;
    sfxHit(false);
    if (best.hp <= 0) {
      showMsg(`${best.type.name} shot +${best.type.reward} G`);
      killMonster(best);
    }
  }

  // The report carries a long way.
  const alerted = alertCreatures(SHOT_ALERT_RADIUS, SHOT_ALERT_TIME);
  if (alerted > 1) showMsg(`The shot echoes... ${alerted} coming your way`);

  updateHUD();
  if (state.ammo > 0) startReload();
}

export function tryAttack(): void {
  if (state.gameOver) return;
  if (state.weapon === 'musket') {
    fireMusket();
    return;
  }
  if (state.atkTimer > 0) return;
  state.atkTimer = ATTACK_CD;
  state.swingT = 0;
  state.swingHit = false;
  // Spent here rather than at impact. The window is about how quickly the player
  // pressed after the dodge, and the blade does not land for another 0.2s.
  state.swingLunge = state.lungeT > 0;
  state.lungeT = 0;
  sfxSwing();
}

/**
 * Damage resolved at the moment the blade comes down. loop.ts calls this once mid-swing.
 * Landing the hit during the windup would divorce the animation from the impact.
 */
export function resolveSwing(): void {
  if (state.gameOver) return;

  // The nearest SWORD_CLEAVE creatures inside the arc, and no more. Cutting
  // everything in front made a crowd no harder than one creature, which is the
  // whole reason a horde never felt like one.
  const [fx, fz] = facing();
  const inArc: { m: Monster; d: number }[] = [];
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const dx = m.mesh.position.x - state.pos.x, dz = m.mesh.position.z - state.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > ATTACK_RANGE + m.type.r) continue;
    if ((dx * fx + dz * fz) / (d || 1) > SWORD_ARC) inArc.push({ m, d });
  }
  inArc.sort((a, b) => a.d - b.d);

  // A swing out of a forward dodge lands with the player's own momentum behind
  // it. The multiplier is charged to durability as well as paid out in damage,
  // so the aggressive opening wears the blade at the rate it kills.
  const lunge = state.swingLunge;
  const dmg = swordDamage() * (lunge ? LUNGE_DMG : 1);
  const wear = SWORD_WEAR * (lunge ? LUNGE_DMG : 1);
  if (lunge && inArc.length > 0) sfxLunge();
  for (const { m } of inArc.slice(0, SWORD_CLEAVE)) {
    m.hp -= dmg;
    m.hurtT = 0.18;
    // Charged per creature cut, so a cleave that catches two costs two.
    state.swordDur = Math.max(0, state.swordDur - wear);
    sfxHit(false);
    if (m.hp <= 0) {
      showMsg(`${m.type.name} killed +${m.type.reward} G`);
      killMonster(m);
    }
  }

  // Named once, the first time it happens. A bonus the player cannot see is a
  // bonus they will never repeat on purpose.
  if (lunge && inArc.length > 0 && !state.lungeShown) {
    state.lungeShown = true;
    showMsg(`Lunge — ${LUNGE_DMG}x damage, and ${LUNGE_DMG}x the wear`);
  }

  if (!state.swordWarned && state.swordDur <= SWORD_WARN_AT) {
    state.swordWarned = true;
    showMsg('The blade is going blunt');
  }
  updateHUD();
}

export function playerHurt(dmg: number): void {
  state.hp -= dmg;
  sfxHit(true);
  if (state.looting) {
    cancelLoot();
    showMsg('Looting interrupted!');
  }
  flashHurt();
  updateHUD();
  if (state.hp <= 0) endRun(false);
}
