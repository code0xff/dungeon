import * as THREE from 'three';
import {
  ARENA_LIGHT, ATTACK_IMPACT, BOSS_CHARGE, BOSS_COMBO, BOSS_DMG, BOSS_HIT_WEIGHT, BOSS_HP, BOSS_REGEN, BOSS_REWARD,
  BOSS_SCALE, BOSS_SLAM, CELL, CREATURE_HIT_WEIGHT, FALLBACK_ATTACK_TIME, TURN_RATE, WALL_H,
} from './config';
import { clipDuration, setAnim } from './assets';
import { shockwave } from './fx';
import { GUARDIAN_EPITAPH } from './lore';
import { ironMat } from './creatures';
import { el, firstChild, queryChild } from './dom';
import { inArena } from './dungeon';
import { sfxCreature } from './audio';
import { setPortalOpen } from './scene';
import { state } from './state';
import { showMsg } from './ui';
import { collides } from './world';
import type { CreatureType, Monster } from './types';

// The guardian of a boss level: the creature that holds the key, in the arena
// that holds the portal.
//
// A boss is an ordinary creature with three differences, and only three, so
// that everything else — co-op sync, hits, parries, the death animation — is
// the code every other creature already runs through:
//
//   it is bigger and heavier   bossType(), and hitWeight() for how blows move it
//   it keeps to its arena      leashed: nobody inside, it walks home and heals
//   it has a move of its own   the orc's charge and the colossus's slam here;
//                              the knight's combination in startAttack(),
//                              where every swing begins
//
// Everything here runs on the creature authority only, except the bar and the
// key, which every client derives from the hp the authority reports.

const bar = el('bossBar');
const barName = queryChild(bar, '.name');
const barFill = firstChild(queryChild(bar, '.track'));

/** A boss is its field creature multiplied. See BOSS_HP and BOSS_SCALE. */
export function bossType(t: CreatureType): CreatureType {
  return {
    ...t,
    hp: t.hp * BOSS_HP,
    dmg: t.dmg * BOSS_DMG,
    reward: Math.round(t.reward * BOSS_REWARD),
    reach: t.reach * BOSS_SCALE,
    r: t.r * BOSS_SCALE,
    clearance: t.clearance * BOSS_SCALE,
  };
}

/** How far a blow moves a creature: CREATURE_HIT_WEIGHT, much less for a boss. */
export function hitWeight(m: Monster): number {
  return CREATURE_HIT_WEIGHT[m.key] * (m.boss ? BOSS_HIT_WEIGHT : 1);
}

/** Whether a world position is on the arena floor. False on a level with none. */
export function inArenaAt(wx: number, wz: number): boolean {
  return state.arena !== null && inArena(state.arena, Math.round(wx / CELL), Math.round(wz / CELL));
}

/** The middle of the arena in world units: where the guardian stands and returns to. */
function post(): { x: number; z: number } {
  // Non-null: only called for a boss, and a boss exists only on an arena level.
  const a = state.arena!;
  return { x: ((a.x0 + a.x1) / 2) * CELL, z: ((a.z0 + a.z1) / 2) * CELL };
}

/**
 * The candle ring hung over the arena, with its light. Returned for the
 * caller to add and later take away with the rest of the dungeon's props.
 */
export function buildArenaLight(): THREE.Group {
  const g = new THREE.Group();
  const { x, z } = post();
  g.position.set(x, WALL_H - ARENA_LIGHT.hang, z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 6, 24), ironMat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb070 });
  const flameGeo = new THREE.ConeGeometry(0.035, 0.12, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7);
    g.add(f);
  }
  // Chains up into the dark, so it hangs from something.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, ARENA_LIGHT.hang * 2, 4), ironMat);
    chain.position.set(Math.cos(a) * 0.35, ARENA_LIGHT.hang, Math.sin(a) * 0.35);
    chain.rotation.z = Math.cos(a) * 0.5;
    chain.rotation.x = -Math.sin(a) * 0.5;
    g.add(chain);
  }
  const light = new THREE.PointLight(ARENA_LIGHT.colour, ARENA_LIGHT.intensity, ARENA_LIGHT.distance, ARENA_LIGHT.decay);
  light.position.y = -0.3;
  g.add(light);
  return g;
}

/** Turns an angle toward a target by at most maxStep, the short way round. */
function turnToward(current: number, target: number, maxStep: number): number {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

/** Moves a creature toward a point per axis, as everything else does. Returns metres covered. */
function stepToward(m: Monster, tx: number, tz: number, step: number): number {
  const p = m.mesh.position;
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const k = Math.min(step, d) / d;
  const fromX = p.x, fromZ = p.z;
  if (!collides(p.x + dx * k, p.z, m.type.clearance)) p.x += dx * k;
  if (!collides(p.x, p.z + dz * k, m.type.clearance)) p.z += dz * k;
  return Math.hypot(p.x - fromX, p.z - fromZ);
}

/**
 * The guardian's own pass, run before the ordinary chase.
 *
 * Returns the metres it moved when it has handled this frame itself, or -1 to
 * let the ordinary chase-and-swing run — which is most of the fight. `strike`
 * lands a blow on the target, however the caller resolves that; `through`
 * says no shield takes it.
 */
export function bossStep(
  m: Monster, dt: number, tgt: { x: number; z: number; dist: number }, attacking: boolean,
  strike: (dmg: number, through: boolean) => void,
): number {
  const t = m.type;
  m.chargeCd = Math.max(0, m.chargeCd - dt);

  // ---- Leashed ----
  // Nobody on its floor: it goes home and mends. Judged by the target, the
  // nearest player — one standing in the doorway is not in the fight.
  if (!inArenaAt(tgt.x, tgt.z)) {
    m.chargePhase = 0;
    m.hp = Math.min(t.hp, m.hp + t.hp * BOSS_REGEN * dt);
    const home = post();
    const moved = stepToward(m, home.x, home.z, t.speed * m.speedMul * dt);
    if (moved > 0) m.mesh.rotation.y = turnToward(m.mesh.rotation.y, Math.atan2(home.x - m.mesh.position.x, home.z - m.mesh.position.z), TURN_RATE * dt);
    m.moving = moved > 1e-6;
    return moved;
  }

  if (m.key === 'colossus') return slamStep(m, dt, tgt, attacking, strike);
  if (m.key !== 'orc') return -1;

  // ---- The orc's charge ----
  const dx = tgt.x - m.mesh.position.x, dz = tgt.z - m.mesh.position.z;
  if (m.chargePhase === 0) {
    const [near, far] = BOSS_CHARGE.range;
    if (attacking || m.flinchT > 0 || m.chargeCd > 0 || tgt.dist < near || tgt.dist > far) return -1;
    m.chargePhase = 1;
    m.chargeT = BOSS_CHARGE.windup;
    // The tell is heard as well as seen: a creature that stops dead and stares
    // in a dark room is easy to miss, a bellow is not.
    sfxCreature(t.voice * 0.8, 1, 0, m.mesh.position);
  }
  if (m.chargePhase === 1) {
    m.mesh.rotation.y = turnToward(m.mesh.rotation.y, Math.atan2(dx, dz), TURN_RATE * 1.5 * dt);
    m.chargeT -= dt;
    m.moving = false;
    if (m.chargeT > 0) return 0;
    // Committed: from here it runs at where the target stands now and does
    // not turn again. That is the whole of the counterplay.
    const d = Math.hypot(dx, dz) || 1;
    m.chargeX = dx / d;
    m.chargeZ = dz / d;
    m.chargePhase = 2;
    m.chargeT = BOSS_CHARGE.time;
  }
  m.chargeT -= dt;
  const step = t.speed * BOSS_CHARGE.speed * dt;
  const p = m.mesh.position;
  const moved = stepToward(m, p.x + m.chargeX * step, p.z + m.chargeZ * step, step);
  m.mesh.rotation.y = Math.atan2(m.chargeX, m.chargeZ);
  m.moving = moved > 1e-6;
  const hit = tgt.dist < t.reach * 0.8;
  // A wall stops it: anything under a third of a stride means it ran into one.
  if (hit || moved < step * 0.3 || m.chargeT <= 0) {
    if (hit) strike(t.dmg * BOSS_CHARGE.dmg, false);
    m.chargePhase = 0;
    m.chargeCd = BOSS_CHARGE.cd;
    // Not straight into a swing off the end of a run.
    m.atkCd = Math.max(m.atkCd, 0.6);
  }
  return moved;
}

/**
 * The colossus's slam: planted, rearing on its own attack clip slowed to last
 * the windup, then the floor. Returns as bossStep() does.
 *
 * The clip is what tells it, so `attackT` is set for the whole of it — that is
 * what keeps animLoaded() from cutting back to idle half way up.
 */
function slamStep(
  m: Monster, dt: number, tgt: { x: number; z: number; dist: number }, attacking: boolean,
  strike: (dmg: number, through: boolean) => void,
): number {
  const t = m.type;
  if (m.chargePhase === 0) {
    if (attacking || m.flinchT > 0 || m.chargeCd > 0 || tgt.dist > BOSS_SLAM.range) return -1;
    m.chargePhase = 1;
    m.chargeT = BOSS_SLAM.windup;
    const clip = (m.playback ? clipDuration(m.playback, 'attack') : null) ?? FALLBACK_ATTACK_TIME;
    // Slowed so the blow in the clip lands as the windup ends.
    const speed = (clip * ATTACK_IMPACT) / BOSS_SLAM.windup;
    m.attackT = clip / speed;
    m.pendingHit = null;
    m.swingSeq++;
    if (m.playback) setAnim(m.playback, 'attack', { loop: false, force: true, fade: 0.08, speed });
    sfxCreature(t.voice * 0.7, 1, 0, m.mesh.position);
  }
  m.moving = false;
  m.chargeT -= dt;
  if (m.chargeT > 0) {
    // It turns while it rears, slowly: it is aiming at where you are, and the
    // radius is wide enough that being behind it is not enough.
    const dx = tgt.x - m.mesh.position.x, dz = tgt.z - m.mesh.position.z;
    m.mesh.rotation.y = turnToward(m.mesh.rotation.y, Math.atan2(dx, dz), TURN_RATE * 0.4 * dt);
    return 0;
  }
  m.chargePhase = 0;
  m.chargeCd = BOSS_SLAM.cd;
  m.atkCd = Math.max(m.atkCd, 0.8);
  shockwave(m.mesh.position.x, m.mesh.position.z, BOSS_SLAM.radius, 0xe8d8b0);
  if (tgt.dist < BOSS_SLAM.radius) strike(t.dmg * BOSS_SLAM.dmg, true);
  return 0;
}

/**
 * The Black Knight's combination, applied as a swing begins: short gaps
 * between blows, then a long rest. Returns the cooldown to use instead of the
 * ordinary one, or null for any other creature.
 */
export function comboCooldown(m: Monster, swing: number): number | null {
  if (!m.boss || m.key !== 'blackknight') return null;
  if (m.comboLeft <= 0) m.comboLeft = BOSS_COMBO.swings;
  m.comboLeft--;
  return swing + (m.comboLeft > 0 ? BOSS_COMBO.gap : BOSS_COMBO.rest);
}

/**
 * The bar, and the key when the guardian falls. Every frame, on every client:
 * both follow from the hp the authority reports, so neither needs a message.
 */
export function updateBoss(): void {
  const b = state.boss;
  if (!b) {
    bar.classList.remove('show');
    return;
  }
  if (b.hp <= 0 && !state.bossDown) {
    state.bossDown = true;
    // The key is the party's, like the chest key it replaces: one portal.
    state.hasKey = true;
    setPortalOpen(true);
    const epitaph = GUARDIAN_EPITAPH[b.key];
    showMsg(`The ${b.type.name} falls — it carried the key.\n${epitaph ?? 'The portal is open'}`);
  }
  const show = b.hp > 0 && inArenaAt(state.pos.x, state.pos.z);
  bar.classList.toggle('show', show);
  if (!show) return;
  barName.textContent = b.type.name;
  barFill.style.width = `${Math.max(0, b.hp / b.type.hp) * 100}%`;
}
