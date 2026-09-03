import { clipDuration, setAnim } from './assets';
import { sfxHit, sfxShot, sfxSwing } from './audio';
import {
  ATTACK_CD, ATTACK_RANGE, CORPSE_LINGER, MUSKET_DMG, MUSKET_RANGE, SHOT_ALERT_RADIUS,
  SWORD_ARC, SWORD_CLEAVE,
} from './config';
import { flashLight, muzzleFlash, scene, smoke } from './scene';
import { state } from './state';
import type { Monster } from './types';
import { cancelLoot, flashHurt, endRun, showMsg, updateHUD } from './ui';
import { startReload } from './weapons';

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

  // The report: every creature in radius learns where the player is.
  let alerted = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (Math.hypot(m.mesh.position.x - state.pos.x, m.mesh.position.z - state.pos.z) < SHOT_ALERT_RADIUS) {
      m.alert = 10;
      m.repath = 0;
      alerted++;
    }
  }
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

  for (const { m } of inArc.slice(0, SWORD_CLEAVE)) {
    m.hp--;
    m.hurtT = 0.18;
    sfxHit(false);
    if (m.hp <= 0) {
      showMsg(`${m.type.name} killed +${m.type.reward} G`);
      killMonster(m);
    }
  }
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
