import { clipDuration, setAnim } from './assets';
import { sfxHit, sfxLunge, sfxShot, sfxSwing, sfxTrap } from './audio';
import {
  ATTACK_CD, ATTACK_RANGE, CORPSE_LINGER, LUNGE_DMG, MUSKET_DMG, MUSKET_RANGE, REWARD_SPREAD,
  TRAP_ALERT_RADIUS, TRAP_ALERT_TIME, TRAP_DMG,
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

/**
 * Banks a kill and returns what it actually paid.
 *
 * Returned rather than read back off the type, because the payout is rolled per
 * kill — a caller that formatted `m.type.reward` into the message would show a
 * different number from the one the HUD just added.
 */
export function killMonster(m: Monster): number {
  m.hp = 0;
  const spread = m.type.reward * REWARD_SPREAD;
  const gold = Math.max(1, Math.round(m.type.reward - spread + Math.random() * spread * 2));
  state.runGold += gold;
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
  return gold;
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
    if (best.hp <= 0) showMsg(`${best.type.name} shot +${killMonster(best)} G`);
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
    if (m.hp <= 0) showMsg(`${m.type.name} killed +${killMonster(m)} G`);
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

/**
 * One spring, shared by the floor traps and the trapped chests, because they are
 * the same event: a noise the player did not choose to make.
 *
 * The damage is charged through playerHurt() like any other, so a trap can be
 * what kills you and the death screen says so honestly.
 *
 * Returns the line rather than showing it. A trapped chest is already about to
 * show what was inside, and the first version had that overwrite the trap line
 * a few milliseconds later — swallowing the only message that mattered. A caller
 * with something to say folds this into it; one with nothing shows it as is.
 */
export function springTrap(): string {
  sfxTrap();
  const heard = alertCreatures(TRAP_ALERT_RADIUS, TRAP_ALERT_TIME);
  playerHurt(TRAP_DMG);
  // Said in terms of who heard it, because the damage is not the news. A player
  // reading this as "-10 HP" has misunderstood what it cost them.
  return heard > 0 ? `The trap springs — ${heard} heard it` : 'The trap springs';
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
