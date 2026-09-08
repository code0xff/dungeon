import { clipDuration, setAnim } from './assets';
import { sfxHit, sfxLunge, sfxParry, sfxShot, sfxSwing, sfxTrap } from './audio';
import {
  ATTACK_BUFFER, ATTACK_CD, ATTACK_RANGE, CORPSE_LINGER, GUARD_ARC, GUARD_LEAK, GUARD_LEAK_HEAVY,
  BLOCK_ARC, LUNGE_DMG, LUNGE_WINDOW, MUSKET_DMG, MUSKET_RANGE,
  LUNGE_HIT_LIGHT, LUNGE_HIT_TIME, REWARD_SPREAD, STAGGER_PUSH, STAGGER_TIME,
  TRAP_ALERT_RADIUS, TRAP_ALERT_TIME, TRAP_DMG,
  SHOT_ALERT_RADIUS, SHOT_ALERT_TIME,
  SWORD_ARC, SWORD_CLEAVE, SWORD_DMG_WORN, SWORD_DUR_MAX, SWORD_WARN_AT, SWORD_WEAR, TYPES,
} from './config';
import { flashLight, muzzleFlash, scene, smoke } from './scene';
import { isAuthority } from './net/client';
import { announceKill, reportHit } from './net/mobsync';
import { tellShot } from './net/worldsync';
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
export function killMonster(m: Monster, opts: { pay?: boolean; gold?: number } = {}): number {
  m.hp = 0;
  // A creature killed mid-stagger would otherwise keep its lean through the
  // whole death animation, since the stagger block returns early for the dead.
  m.staggerT = 0;
  m.mesh.rotation.x = 0;
  // The roll can be handed in rather than made here. In co-op the creature dies
  // on the authority's machine and the amount travels with the announcement, so
  // rolling again on each client would pay four different sums for one kill.
  const spread = m.type.reward * REWARD_SPREAD;
  const gold = opts.gold ?? Math.max(1, Math.round(m.type.reward - spread + Math.random() * spread * 2));
  // And paying is optional, because a kill is not always yours: the authority
  // resolves everyone's hits, and the gold belongs to whoever swung.
  if (opts.pay !== false) {
    state.runGold += gold;
    updateHUD();
  }
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
export function alertCreatures(
  radius: number,
  seconds: number,
  // Where the noise was made. Defaults to the player because almost every noise
  // in the game is one they made — but a co-op ally springing a trap across the
  // dungeon is a real noise in a real place, and charging it to the listener's
  // own position would wake the creatures standing next to the wrong person.
  x = state.pos.x,
  z = state.pos.z,
): number {
  let heard = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (Math.hypot(m.mesh.position.x - x, m.mesh.position.z - z) < radius) {
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
  // The impact and the muzzle flash drive one light between them. Swapping to
  // the musket mid-impact and firing left it lit at the wrong place, so the shot
  // simply ends the impact rather than queueing behind it.
  state.lungeHitT = 0;
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
    // As in resolveSwing(): a creature this client is not being told about is
    // still in the array at a stale position, and must not be shootable there.
    if (m.hp <= 0 || !m.mesh.visible) continue;
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
    best.hurtT = 0.25;
    const shielded = shieldedFraction(best, state.pos.x, state.pos.z);
    sfxHit(shielded > 0);
    if (shielded > 0) showMsg('The shield takes the ball');
    // The flash and the sound are drawn regardless — a shot that looked like it
    // missed while the ball was in flight to the authority would feel broken.
    // The hp is not: whether it died is not this client's to decide unless it
    // is the one simulating.
    if (isAuthority()) {
      best.hp -= MUSKET_DMG * (1 - shielded);
      if (best.hp <= 0) {
        const g = killMonster(best);
        announceKill(state.monsters.indexOf(best), g);
        showMsg(`${best.type.name} shot +${g} G`);
      }
    } else {
      reportHit(state.monsters.indexOf(best), MUSKET_DMG);
    }
  }

  // The report carries a long way — and it has to carry to the party's
  // creatures, not just this client's copies of them. Without this a follower
  // could fire all day and nothing would come looking, because the only client
  // whose creatures decide anything never heard it.
  tellShot();
  const alerted = alertCreatures(SHOT_ALERT_RADIUS, SHOT_ALERT_TIME);
  if (alerted > 1) showMsg(`The shot echoes... ${alerted} coming your way`);

  updateHUD();
  if (state.ammo > 0) startReload();
}

/** Begins a swing. The cooldown is the caller's problem. */
function startSwing(lunge: boolean): void {
  state.atkTimer = ATTACK_CD;
  state.swingT = 0;
  state.swingHit = false;
  state.swingLunge = lunge;
  state.lungeT = 0;
  state.atkQueue = 0;
  sfxSwing();
}

export function tryAttack(): void {
  if (state.gameOver) return;
  // Both hands are busy behind a shield. This is the other half of what the
  // guard costs — a parry drops it for you precisely so the counter can land.
  if (state.guarding) return;
  if (state.weapon === 'musket') {
    fireMusket();
    return;
  }
  // Whether this press counts as a lunge is decided *here*, at the press, and
  // carried through the queue if the swing has to wait. The window has always
  // been about how quickly the player reacted, not about when the engine got
  // round to swinging — and the buffer only means anything if it preserves that.
  const lunge = state.lungeT > 0;
  if (state.atkTimer > 0) {
    // Remembered rather than discarded. A press that vanishes with no sound and
    // no animation is indistinguishable from a broken key.
    state.atkQueue = ATTACK_BUFFER;
    state.queueLunge = lunge;
    return;
  }
  startSwing(lunge);
}

/** Fires the buffered swing. loop.ts calls this the frame the cooldown clears. */
export function releaseQueuedAttack(): void {
  // Guarding is checked here as well as in tryAttack(). A press buffered before
  // the shield came up would otherwise swing out from behind it the moment the
  // cooldown cleared, which is the one thing the guard is supposed to stop.
  if (state.gameOver || state.guarding || state.atkQueue <= 0 || state.weapon !== 'sword') {
    state.atkQueue = 0;
    return;
  }
  // Either half can make it a lunge: the press may have been inside the window,
  // or the window may still be open now.
  startSwing(state.queueLunge || state.lungeT > 0);
}

/**
 * Damage resolved at the moment the blade comes down. loop.ts calls this once mid-swing.
 * Landing the hit during the windup would divorce the animation from the impact.
 */
/**
 * How much of a hit a creature's shield takes, given where the hit came from.
 *
 * Only the Black Knight has one. It covers BLOCK_ARC in front of the creature's
 * facing, and it is down while the creature is staggered or mid-swing — those
 * two are the whole fight: a parry gives both at once, and the opening it
 * leaves is what the lunge is for.
 *
 * Facing is (sin ry, cos ry) because turnToward() aims rotation.y with
 * atan2(dx, dz) toward its target, so that vector points where the creature
 * is looking.
 */
export function shieldedFraction(m: Monster, fromX: number, fromZ: number): number {
  const block = m.type.block ?? 0;
  if (block <= 0 || m.staggerT > 0 || m.attackT > 0) return 0;
  const fx = Math.sin(m.mesh.rotation.y), fz = Math.cos(m.mesh.rotation.y);
  const dx = fromX - m.mesh.position.x, dz = fromZ - m.mesh.position.z;
  const d = Math.hypot(dx, dz) || 1;
  return (dx * fx + dz * fz) / d > BLOCK_ARC ? block : 0;
}

export function resolveSwing(): void {
  if (state.gameOver) return;

  // The nearest SWORD_CLEAVE creatures inside the arc, and no more. Cutting
  // everything in front made a crowd no harder than one creature, which is the
  // whole reason a horde never felt like one.
  const [fx, fz] = facing();
  const inArc: { m: Monster; d: number }[] = [];
  for (const m of state.monsters) {
    // Invisible means "not being reported to this client": in co-op a creature
    // outside the interest radius keeps its last known position in the array,
    // and without this a swing at where a zombie used to stand would report a
    // hit that the authority applies by index, from across the dungeon.
    //
    // Safe in solo, where visibility is CREATURE_DRAW_DISTANCE at 30m and the
    // longest weapon reaches 26.
    if (m.hp <= 0 || !m.mesh.visible) continue;
    const dx = m.mesh.position.x - state.pos.x, dz = m.mesh.position.z - state.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > ATTACK_RANGE + m.type.r) continue;
    if ((dx * fx + dz * fz) / (d || 1) > SWORD_ARC) inArc.push({ m, d });
  }
  inArc.sort((a, b) => a.d - b.d);

  // A swing out of a forward dodge lands with the player's own momentum behind
  // it. Wear is deliberately *not* scaled with the multiplier: see LUNGE_DMG.
  const lunge = state.swingLunge;
  const dmg = swordDamage() * (lunge ? LUNGE_DMG : 1);
  const landed = lunge && inArc.length > 0;
  if (landed) {
    sfxLunge();
    state.lungeHitT = LUNGE_HIT_TIME;
    // Thrown at the creature rather than at the player, so the light rakes
    // across whatever was hit instead of washing the whole corridor evenly.
    const hit = inArc[0].m.mesh.position;
    flashLight.position.set(hit.x, state.pos.y * 0.7, hit.z);
    flashLight.intensity = LUNGE_HIT_LIGHT;
  }
  // Collected and shown once at the end rather than called as they happen.
  // showMsg replaces, so a swing that killed two creatures only ever reported
  // the second — and the first lunge of a run silently ate its own kill line,
  // because the explanation below fired a frame's worth of logic later.
  const lines: string[] = [];
  for (const { m } of inArc.slice(0, SWORD_CLEAVE)) {
    m.hurtT = 0.18;
    // Charged per creature cut, so a cleave that catches two costs two. Charged
    // whoever is simulating, because the blade was swung either way.
    state.swordDur = Math.max(0, state.swordDur - SWORD_WEAR);
    // A shielded hit sounds like one — the low thud, not the cut — and says so
    // once, because a player who does not know why the knight will not die
    // has no way to find out the shield is the reason.
    const shielded = shieldedFraction(m, state.pos.x, state.pos.z);
    sfxHit(shielded > 0);
    if (shielded > 0 && !lines.includes('The shield takes it')) lines.push('The shield takes it');
    if (isAuthority()) {
      m.hp -= dmg * (1 - shielded);
      if (m.hp <= 0) {
        const g = killMonster(m);
        announceKill(state.monsters.indexOf(m), g);
        lines.push(`${m.type.name} killed +${g} G`);
      }
    } else {
      // Reported, not applied. The hit feedback above is already on screen; the
      // hp comes back in the next snapshot and the kill in its own message, so
      // a creature the authority disagrees about never dies twice or pays twice.
      // The authority applies the shield itself, from the reporter's pose.
      reportHit(state.monsters.indexOf(m), dmg);
    }
  }

  // The lunge deliberately says nothing here. It used to name the multiplier the
  // first time it landed, but the message card is sized for a phone: a two-line
  // explanation covered most of the screen at the exact moment the player needed
  // to see what they had just hit. The blade lighting up is the cue, the kill is
  // the confirmation, and the guide carries the number.

  if (!state.swordWarned && state.swordDur <= SWORD_WARN_AT) {
    state.swordWarned = true;
    lines.push('The blade is going blunt');
  }
  if (lines.length) showMsg(lines.join('\n'));
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

/**
 * Damage to the player, optionally from a known attacker.
 *
 * `from` is what makes the shield mean anything: a guard covers GUARD_ARC in
 * front and nothing behind, so the blow has to know where it came from. Traps
 * pass nothing and are therefore unblockable, which is right — a bear trap goes
 * off under your feet, not into your shield.
 *
 * Returns how the hit resolved, so the caller can react to a parry.
 */
export function playerHurt(dmg: number, from?: Monster): 'hit' | 'blocked' | 'parried' {
  // updateMonsters() can end the run part way through a frame, and updateTraps()
  // still runs after it — so a trap could fire on a corpse, wake the dungeon and
  // put its message over the death screen.
  if (state.gameOver) return 'hit';
  let outcome: 'hit' | 'blocked' | 'parried' = 'hit';
  if (from && state.guarding) {
    const dx = from.mesh.position.x - state.pos.x, dz = from.mesh.position.z - state.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const [fx, fz] = facing();
    if ((dx * fx + dz * fz) / d > GUARD_ARC) {
      // Timed on the press, not the hold: a shield held up forever is safe and
      // worthless, and the reward has to cost a moment of judgement.
      if (state.parryT > 0) {
        outcome = 'parried';
        dmg = 0;
        staggerCreature(from, dx / d, dz / d);
        // Reuses the lunge window whole — glow, impact light, camera kick, the
        // 5.52x hit and the one-time explanation. A parry is the defensive route
        // to the same opening the forward dodge already opens, so it teaches the
        // player nothing new to read.
        state.lungeT = LUNGE_WINDOW;
        // Cleared along with whatever input is still held, so the counter can
        // actually be swung — a held key that still counted would put the shield
        // straight back up.
        state.guarding = false;
        state.guardHeld = 0;
        state.parryT = 0;
        sfxParry();
        // Named once, the first time it lands. The blade lighting up is the same
        // signal the dodge already teaches, so this only has to say what opened it.
        if (!state.parryShown) {
          state.parryShown = true;
          showMsg('Parried — strike now, while the blade is lit');
        }
      } else {
        outcome = 'blocked';
        // A brute swings for nearly a third of MAX_HP. Stopping that dead would
        // make the shield the answer to the one creature meant to be frightening.
        // Off the base type, not the stage's: past FINAL_STAGE every creature
        // grows, and a zombie that has grown to 9 hp is still a zombie.
        dmg *= TYPES[from.key].hp >= 9 ? GUARD_LEAK_HEAVY : GUARD_LEAK;
      }
    }
  }
  if (dmg <= 0 && outcome !== 'hit') {
    if (outcome === 'blocked') sfxHit(true);
    updateHUD();
    return outcome;
  }
  state.hp -= dmg;
  sfxHit(true);
  if (state.looting) {
    cancelLoot();
    showMsg('Looting interrupted!');
  }
  flashHurt();
  updateHUD();
  if (state.hp <= 0) endRun(false);
  return outcome;
}

/**
 * Rocks a creature back out of its swing.
 *
 * There is no stagger clip — the creatures ship idle, walk, attack and death and
 * nothing else — so this is built from the root transform instead: the attack is
 * cut, the body leans away along its own facing, and it is pushed back over the
 * same window. loop.ts drives the lean and the push; this only sets it up.
 */
export function staggerCreature(m: Monster, awayX: number, awayZ: number): void {
  m.staggerT = STAGGER_TIME;
  m.staggerX = awayX;
  m.staggerZ = awayZ;
  m.attackT = 0;
  m.pendingHit = null;
  // Cannot immediately swing again on recovering, or the stagger buys nothing.
  m.atkCd = Math.max(m.atkCd, STAGGER_TIME + m.type.atkCd * 0.5);
  m.hurtT = 0.18;
  // With a stagger clip the body acts it out; without one it snaps to idle and
  // the frame loop leans the whole mesh back (STAGGER_LEAN), which is the
  // fallback every creature had until the clips arrived.
  if (m.playback) {
    setAnim(m.playback, m.playback.clips.stagger ? 'stagger' : 'idle', { loop: false, force: true, fade: 0.06 });
  }
}

/** How far a staggered creature has been pushed by now, as a fraction of STAGGER_PUSH. */
export const staggerPush = (m: Monster, dt: number): number =>
  (STAGGER_PUSH / STAGGER_TIME) * dt * (m.staggerT / STAGGER_TIME) * 2;
