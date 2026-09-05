import * as THREE from 'three';
import { clipDuration, flashLoadedMesh, setAnim } from './assets';
import { audioReady, lastBeat, setLastBeat, sfxCreature, sfxHeartbeat, sfxReloadStep } from './audio';
import {
  ATTACK_IMPACT, ATTACK_IMPACT_REACH, CELL, CHEST_LID_OPEN, CREATURE_DRAW_DISTANCE,
  DASH_ROLL, DASH_SPEED, DASH_TIME, EYE_H, GROUND_SPEED_SMOOTH,
  FALLBACK_ATTACK_TIME, GEAR_BOB, GEAR_BOB_ROLL, LAMP_SWAY, LAMP_SWAY_LAG,
  CREATURE_PUSH, GUARD_RAISE, GUARD_SLOW, LANTERN_WARN, LOOT_TIME, MUSKET_RELOAD, PLAYER_R,
  PORTAL_RADIUS, POTION_DRINK, STAGGER_LEAN, STAGGER_TIME,
  SPEED,
  TRAP_RADIUS,
  STRIDE_RATE,
  SWAY_DAMP, TYPES,
  LUNGE_HIT_GLOW, LUNGE_HIT_KICK, LUNGE_HIT_LIGHT, LUNGE_HIT_TIME, LUNGE_WINDOW, SWING_IMPACT,
  SWING_SPEED, SWING_WINDUP, TURN_RATE, WALK_CLIP_SPEED, WALK_TIMESCALE_RANGE, WALL_H,
} from './config';
import { playerHurt, releaseQueuedAttack, resolveSwing, springTrap, staggerPush } from './combat';
import { findPath } from './dungeon';
import { edgeTurn, keys, moveInput } from './input';
import { finishDrink, openChest } from './loot';
import { setTrapJaws } from './props';
import {
  DUST, camera, dustGeo, flashLight, gearBob, handShield, MUSKET_REST, musket,
  SHIELD_GUARD, SHIELD_REST,
  muzzleFlash, portal, portalCore, renderFrame, scene, setBladeGlow, setLampLit, SMOKE_REST_Y,
  smoke, sword, SWORD_REST, playerLight,
} from './scene';
import { state } from './state';
import { collides } from './world';
import type { CreatureRig, Monster, MonsterPlayback } from './types';
import {
  atkBtn, cancelLoot, drawMinimap, drinkFillEl, endRun, lootBtn, lootFillEl,
  promptEl, reloadBarEl, reloadFillEl, showMsg, updateHUD,
} from './ui';

// ================= Creature animation =================
/** External models: pick the clip that fits the situation and advance the mixer. */
function animLoaded(m: Monster, pb: MonsterPlayback, dt: number): void {
  const flash = m.hurtT > 0;
  if (flash) m.hurtT -= dt;
  flashLoadedMesh(m.mesh, flash);

  if (m.attackT > 0) {
    // startAttack already began the attack clip. Leave it alone until it finishes.
  } else if (m.moving) {
    setAnim(pb, 'walk');
    // Match playback rate to actual ground speed so the feet stop sliding.
    if (pb.action) {
      const [lo, hi] = WALK_TIMESCALE_RANGE;
      const scale = m.groundSpeed / (pb.walkClipSpeed ?? WALK_CLIP_SPEED);
      pb.action.timeScale = Math.max(lo, Math.min(hi, scale));
    }
  } else {
    setAnim(pb, 'idle');
  }

  m.moving = false;
  pb.mixer.update(dt);
}

/** Fallback box model: swing the limbs on a sine wave. */
function animProcedural(m: Monster, rig: CreatureRig, dt: number, now: number): void {
  const t = m.type;
  const flash = m.hurtT > 0;
  if (flash) m.hurtT -= dt;
  for (const mt of rig.mats) mt.emissive.setHex(flash ? 0x7a1a1a : 0x000000);

  if (m.attackT > 0) {
    // Raise the arms high, then bring them down.
    const k = Math.sin((1 - m.attackT / FALLBACK_ATTACK_TIME) * Math.PI);
    rig.armL.rotation.x = rig.armBase[0] - k * 1.4;
    rig.armR.rotation.x = rig.armBase[1] - k * 1.4;
    m.moving = false;
    return;
  }

  m.anim += dt * (m.moving ? t.animSpeed : 1.4);
  const sw = m.moving ? t.swing : 0.08;
  rig.armL.rotation.x = rig.armBase[0] + Math.sin(m.anim) * sw;
  rig.armR.rotation.x = rig.armBase[1] - Math.sin(m.anim) * sw * 0.6;
  rig.legL.rotation.x = Math.sin(m.anim) * sw * 0.9;
  rig.legR.rotation.x = -Math.sin(m.anim) * sw * rig.limp;
  rig.torso.rotation.z = Math.sin(m.anim * 0.5) * 0.06;
  rig.head.rotation.z = Math.sin(now * 0.0017 + m.bobSeed) * 0.12;
  // The whole body bobs while walking.
  m.mesh.position.y = m.moving ? Math.abs(Math.sin(m.anim)) * 0.05 : 0;
  m.moving = false;
}

/** Starts the attack animation, honouring the clip's own length when there is one. */
function startAttack(m: Monster): void {
  const clip = m.playback ? clipDuration(m.playback, 'attack') : null;
  // attackSpeed shortens the clip, so every timing below scales with it.
  const dur = (clip ?? FALLBACK_ATTACK_TIME) / m.type.attackSpeed;
  m.attackT = dur;
  // The hit lands partway through, as the arm comes down — not at the start.
  m.pendingHit = dur * ATTACK_IMPACT;
  // Keep the next attack from overlapping before this animation ends.
  m.atkCd = Math.max(m.type.atkCd, dur);
  if (m.playback) {
    setAnim(m.playback, 'attack', { loop: false, force: true, fade: 0.08, speed: m.type.attackSpeed });
  }
}

/** Turns an angle toward a target by at most maxStep, along the shortest path in -π..π. */
function turnToward(current: number, target: number, maxStep: number): number {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

// ================= Player =================
/** Returns whether the player moved this frame, which is what cancels looting. */
function updatePlayer(dt: number, now: number): boolean {
  if (keys['ArrowLeft']) state.yaw += 2.2 * dt;
  if (keys['ArrowRight']) state.yaw -= 2.2 * dt;
  edgeTurn(dt);

  state.dashCd = Math.max(0, state.dashCd - dt);
  // Runs from the moment the dodge starts, so it overlaps DASH_TIME: swinging
  // mid-dodge is the cleanest lunge there is, and should not have to wait.
  state.lungeT = Math.max(0, state.lungeT - dt);
  state.parryT = Math.max(0, state.parryT - dt);
  state.parryCd = Math.max(0, state.parryCd - dt);

  // Moving each axis separately is what lets the player slide along a wall.
  //
  // Creatures are solid too, except mid-dodge. `collides()` only ever knew about
  // walls, so the player walked straight through them — and once creatures stop
  // sharing a space with each other, walking through one is the only thing left
  // on screen that looks broken. The dodge is the exception on purpose: config
  // already calls it "what turns a blocked corridor from a death into a
  // decision", and that is only true if it is the one thing that gets through a
  // body. Solid creatures without it would make being surrounded a cage rather
  // than a threat.
  const step = (dx: number, dz: number): void => {
    const solid = state.dashT < 0;
    if (!collides(state.pos.x + dx, state.pos.z)
      && !(solid && entersCreature(state.pos.x + dx, state.pos.z))) state.pos.x += dx;
    if (!collides(state.pos.x, state.pos.z + dz)
      && !(solid && entersCreature(state.pos.x, state.pos.z + dz))) state.pos.z += dz;
  };

  // ---- Dodging: the locked direction overrides input until it ends ----
  if (state.dashT >= 0) {
    state.dashT += dt;
    // Eased out, so it leaves fast and arrives settled rather than stopping dead.
    const k = 1 - (state.dashT / DASH_TIME) ** 2;
    step(state.dashX * DASH_SPEED * Math.max(0, k) * dt, state.dashZ * DASH_SPEED * Math.max(0, k) * dt);
    if (state.dashT >= DASH_TIME) state.dashT = -1;
    state.pos.y = EYE_H;
    return true;
  }

  const { f: rawF, s: rawS } = moveInput();
  let f = rawF, s = rawS;
  const len = Math.hypot(f, s);
  let moving = false;
  if (len > 0.01) {
    moving = true;
    // Normalise so diagonals are not faster, but leave small stick inputs alone.
    f /= Math.max(len, 1);
    s /= Math.max(len, 1);
    // Braced behind a shield you shuffle rather than walk. This is most of what
    // the guard costs — it is why holding it up crossing a room is not free.
    const sp = SPEED * (state.guarding ? GUARD_SLOW : 1);
    step(
      (Math.sin(state.yaw) * f - Math.cos(state.yaw) * s) * sp * dt,
      (Math.cos(state.yaw) * f + Math.sin(state.yaw) * s) * sp * dt,
    );
  }
  state.pos.y = EYE_H + (moving ? Math.sin(now * 0.012) * 0.045 : 0);
  return moving;
}

// ================= Weapons =================
/**
 * The raised and the cut-through poses, as offsets from SWORD_REST.
 * A purely vertical chop sends a blade as long as a sabre clean off the bottom of
 * the screen at the peak, which drains the impact — so the cut runs diagonally,
 * from upper right to lower left.
 *
 * These are **offsets**, so they had to be re-tuned when SWORD_REST's yaw moved:
 * the old windup added a further -0.2 to a rest that was already swung out, and
 * the blade ended up pointing away from the camera with the pommel toward it.
 * The rule for both poses is that the blade must stay side-on — a sword seen
 * down its own length is a stick, which is the whole problem the rest pose fixed.
 */
const SWING_UP = { rot: [0.55, 0.25, 0.3], pos: [0.06, 0.1, 0.1] } as const;
const SWING_DOWN = { rot: [-0.35, 0.9, -1.35], pos: [-0.28, -0.08, -0.04] } as const;

/**
 * The swing curve, mapping t (0..1) to -1 (raised), +1 (cut through) and back to 0.
 * The raise decelerates into its stop; the downswing accelerates into the hit.
 */
function swingCurve(t: number): number {
  if (t < SWING_WINDUP) return -Math.sin((t / SWING_WINDUP) * (Math.PI / 2));

  const u = (t - SWING_WINDUP) / (1 - SWING_WINDUP);
  const strike = (SWING_IMPACT - SWING_WINDUP) / (1 - SWING_WINDUP);
  if (u < strike) return -1 + 2 * (1 - Math.cos((u / strike) * (Math.PI / 2)));
  return 1 - Math.sin(((u - strike) / (1 - strike)) * (Math.PI / 2));
}

function updateWeapons(dt: number): void {
  state.atkTimer = Math.max(0, state.atkTimer - dt);
  if (state.atkQueue > 0) {
    // Released before the queue is decremented. ATTACK_BUFFER equals ATTACK_CD,
    // so two presses inside one frame gave both timers the same value and they
    // reached zero together — and testing the queue after the subtraction threw
    // the swing away on exactly the frame it should have fired.
    if (state.atkTimer <= 0) releaseQueuedAttack();
    else state.atkQueue = Math.max(0, state.atkQueue - dt);
  }

  // ---- Sword swing ----
  if (state.swingT >= 0) {
    state.swingT += dt * SWING_SPEED;
    if (!state.swingHit && state.swingT >= SWING_IMPACT) {
      state.swingHit = true;
      resolveSwing();
    }
    if (state.swingT >= 1) {
      state.swingT = -1;
      sword.rotation.copy(SWORD_REST.rot);
      sword.position.copy(SWORD_REST.pos);
    } else {
      const w = swingCurve(state.swingT);
      const o = w < 0 ? SWING_UP : SWING_DOWN;
      const a = Math.abs(w);
      sword.rotation.set(
        SWORD_REST.rot.x + o.rot[0] * a,
        SWORD_REST.rot.y + o.rot[1] * a,
        SWORD_REST.rot.z + o.rot[2] * a,
      );
      sword.position.set(
        SWORD_REST.pos.x + o.pos[0] * a,
        SWORD_REST.pos.y + o.pos[1] * a,
        SWORD_REST.pos.z + o.pos[2] * a,
      );
    }
  }

  // ---- Musket reload ----
  if (state.reloadT >= 0) {
    state.reloadT += dt;
    reloadFillEl.style.width = Math.min(100, (state.reloadT / MUSKET_RELOAD) * 100) + '%';
    const step = Math.floor((state.reloadT / MUSKET_RELOAD) * 3);
    if (String(step) !== reloadBarEl.dataset.step && step < 3) {
      reloadBarEl.dataset.step = String(step);
      sfxReloadStep(step);
    }
    // The musket drops while reloading.
    musket.position.y = MUSKET_REST.y - Math.sin(Math.min(1, state.reloadT / 0.4) * (Math.PI / 2)) * 0.12;
    if (state.reloadT >= MUSKET_RELOAD) {
      state.reloadT = -1;
      state.loaded = true;
      reloadBarEl.style.display = 'none';
      musket.position.y = MUSKET_REST.y;
      updateHUD();
    }
  }

  // ---- Recoil ----
  if (state.recoilT >= 0) {
    state.recoilT += dt * 5;
    const k = state.recoilT < 1 ? Math.sin(state.recoilT * Math.PI) : 0;
    musket.position.z = MUSKET_REST.z + k * 0.16;
    musket.rotation.x = MUSKET_REST.rotX + k * 0.22;
    if (state.recoilT >= 1) state.recoilT = -1;
  }

  // ---- Lunge impact ----
  // Owns flashLight only while no muzzle flash is running: the two never overlap
  // in practice, since one is the sword and the other the musket, but a shot
  // fired at the tail of a lunge would otherwise have its flash cut short.
  if (state.lungeHitT > 0) {
    state.lungeHitT = Math.max(0, state.lungeHitT - dt);
    if (state.flashT <= 0) {
      const k = state.lungeHitT / LUNGE_HIT_TIME;
      // Squared: a hard arrival and a quick falloff, like a struck spark.
      flashLight.intensity = LUNGE_HIT_LIGHT * k * k;
    }
  }

  // ---- Muzzle flash ----
  if (state.flashT > 0) {
    state.flashT -= dt;
    if (state.flashT <= 0) {
      muzzleFlash.visible = false;
      flashLight.intensity = 0;
    } else {
      flashLight.intensity = 3.5 * (state.flashT / 0.09);
    }
  }

  // ---- Smoke ----
  if (smoke.material.opacity > 0) {
    smoke.material.opacity = Math.max(0, smoke.material.opacity - dt * 1.1);
    smoke.scale.multiplyScalar(1 + dt * 2.5);
    smoke.position.y += dt * 0.4;
    if (smoke.material.opacity <= 0) smoke.position.y = SMOKE_REST_Y;
  }
}

// ================= Creatures =================
/** Returns the distance to the nearest living creature, which paces the heartbeat. */
function updateMonsters(dt: number, now: number): number {
  let nearest = 99;
  const pgx = Math.round(state.pos.x / CELL), pgz = Math.round(state.pos.z / CELL);

  for (const m of state.monsters) {
    if (m.hp <= 0) {
      // Let the death animation play out, then take it off the scene.
      if (m.dead) {
        m.playback?.mixer.update(dt);
        m.deadT -= dt;
        if (m.deadT <= 0) {
          scene.remove(m.mesh);
          m.dead = false;
        }
      }
      continue;
    }

    const t = m.type;
    m.atkCd = Math.max(0, m.atkCd - dt);


    const dx = state.pos.x - m.mesh.position.x, dz = state.pos.z - m.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    nearest = Math.min(nearest, dist);
    // Drawing only, not thinking — see CREATURE_DRAW_DISTANCE.
    m.mesh.visible = dist < CREATURE_DRAW_DISTANCE;

    // ---- Staggered by a parry ----
    //
    // Built from the root transform because the creatures have no stagger clip.
    // The lean is about the mesh's own X after yaw — rotation.order is 'YXZ' for
    // exactly this — so it rocks backwards whichever way the creature is facing.
    // It eases out on the square, so the body snaps back and settles rather than
    // returning at a constant rate like a door closing.
    if (m.staggerT > 0) {
      m.staggerT = Math.max(0, m.staggerT - dt);
      // Kept running through the stagger. They live below the `continue`, so a
      // parried creature was otherwise staying alerted — and holding its groan —
      // for however long it spent rocked back.
      m.alert = Math.max(0, m.alert - dt);
      m.groanT -= dt;
      const k = m.staggerT / STAGGER_TIME;
      m.mesh.rotation.x = -STAGGER_LEAN * k * k;
      const push = staggerPush(m, dt);
      const nx = m.mesh.position.x + m.staggerX * push;
      const nz = m.mesh.position.z + m.staggerZ * push;
      // Per axis, like everything else that moves a creature, so being knocked
      // back cannot shove one through a wall.
      if (!collides(nx, m.mesh.position.z, t.clearance)) m.mesh.position.x = nx;
      if (!collides(m.mesh.position.x, nz, t.clearance)) m.mesh.position.z = nz;
      if (m.playback) animLoaded(m, m.playback, dt);
      else if (m.rig) animProcedural(m, m.rig, dt, now);
      // It still turns to face you as it recovers, so the counter lands on its
      // front and it is visibly still coming.
      m.mesh.rotation.y = turnToward(m.mesh.rotation.y, Math.atan2(dx, dz), TURN_RATE * dt);
      continue;
    }
    m.mesh.rotation.x = 0;

    // ---- Attack animation in progress ----
    const attacking = m.attackT > 0;
    if (attacking) {
      m.attackT -= dt;
      if (m.pendingHit !== null) {
        m.pendingHit -= dt;
        if (m.pendingHit <= 0) {
          m.pendingHit = null;
          // The player must still be in reach when the arm lands — back away and it whiffs.
          if (dist < t.reach * ATTACK_IMPACT_REACH) playerHurt(t.dmg, m);
        }
      }
    }

    m.groanT -= dt;
    if (m.groanT <= 0) {
      m.groanT = t.groan[0] + Math.random() * (t.groan[1] - t.groan[0]);
      if (dist < 13) sfxCreature(t.voice, Math.max(0.15, 1 - dist / 13));
    }
    if (m.alert > 0) m.alert -= dt;

    const aggroed = dist < t.aggro || m.alert > 0;

    let moved = 0;
    if (aggroed) {
      // While attacking it stands still and finishes the animation.
      if (!attacking) {
        // Close in, walk straight at the player; further out, follow the first BFS step.
        let tx: number, tz: number;
        if (dist < CELL * 1.4) {
          tx = state.pos.x;
          tz = state.pos.z;
        } else {
          m.repath -= dt;
          if (m.repath <= 0 || !m.step) {
            m.step = findPath(state.maze, Math.round(m.mesh.position.x / CELL), Math.round(m.mesh.position.z / CELL), pgx, pgz);
            m.repath = 0.4;
          }
          if (m.step) {
            tx = m.step[0] * CELL;
            tz = m.step[1] * CELL;
          } else {
            tx = m.mesh.position.x;
            tz = m.mesh.position.z;
          }
        }

        const ddx = tx - m.mesh.position.x, ddz = tz - m.mesh.position.z;
        const dl = Math.hypot(ddx, ddz);
        if (dl > 0.05 && dist > t.reach * 0.75) {
          const step = t.speed * m.speedMul * dt;
          const nx = m.mesh.position.x + (ddx / dl) * step;
          const nz = m.mesh.position.z + (ddz / dl) * step;
          const fromX = m.mesh.position.x, fromZ = m.mesh.position.z;
          if (!collides(nx, m.mesh.position.z, t.clearance)) m.mesh.position.x = nx;
          if (!collides(m.mesh.position.x, nz, t.clearance)) m.mesh.position.z = nz;
          // What it covered, not what it asked for. Collision is per axis, so a
          // creature sliding along a wall gets a fraction of `step` — and the
          // walk clip has to be retimed to that or the legs run on the spot.
          moved = Math.hypot(m.mesh.position.x - fromX, m.mesh.position.z - fromZ);
          m.moving = moved > 1e-6;
        }
      }
      // Turn toward the player smoothly rather than snapping.
      m.mesh.rotation.y = turnToward(m.mesh.rotation.y, Math.atan2(dx, dz), TURN_RATE * dt);

      if (!attacking && dist < t.reach && m.atkCd <= 0) startAttack(m);
    }

    // Smoothed so one blocked frame does not stutter the legs.
    //
    // Guarded because THREE.Clock.getDelta() returns exactly 0 on its first call
    // — it auto-starts and reports no elapsed time — so frame 1 computed 0/0 and
    // gave every creature a NaN ground speed. That poisons the walk clip's
    // timeScale, and a NaN timeScale does not throw: the clip's time becomes NaN
    // and the pose simply stops advancing, so creatures slide along frozen.
    // Nothing can have moved in a zero-length frame, so skipping is exact.
    if (dt > 0) {
      const k = Math.min(1, dt * GROUND_SPEED_SMOOTH);
      m.groundSpeed += (moved / dt - m.groundSpeed) * k;
    }

    if (m.playback) animLoaded(m, m.playback, dt);
    else if (m.rig) animProcedural(m, m.rig, dt, now);
  }
  separateMonsters(dt);
  return nearest;
}

/**
 * Whether moving to (wx, wz) would put the player inside a creature it is not
 * already inside.
 *
 * Entry, not overlap — and that asymmetry is the whole design. Creatures walk
 * into the player, so the player ends up overlapping one without ever having
 * moved. A plain "is this spot occupied" test would then reject every escape as
 * well, pinning the player exactly where they are least able to afford it. Being
 * allowed to keep moving through a creature already touching you means you can
 * always walk out of what walked into you.
 */
function entersCreature(wx: number, wz: number): boolean {
  for (const m of state.monsters) {
    // Corpses are walked over, not around.
    if (m.hp <= 0) continue;
    const min = PLAYER_R + m.type.r;
    const nx = wx - m.mesh.position.x, nz = wz - m.mesh.position.z;
    if (nx * nx + nz * nz >= min * min) continue;
    const ox = state.pos.x - m.mesh.position.x, oz = state.pos.z - m.mesh.position.z;
    if (ox * ox + oz * oz < min * min) continue;
    return true;
  }
  return false;
}

/**
 * The same rule the other way round: whether a shove would push a creature into
 * the player it is not already touching.
 *
 * Creatures are not separated *from* the player — a crowd that could shove the
 * player around would push them into corners and off the exit, and being pressed
 * is the threat rather than a bug. But without this a creature squeezed by the
 * nine behind it gets squirted through the player's body and ends up inside the
 * camera. Walking creatures never reach this close on their own: every one of
 * them stops at `reach * 0.75`, which is wider than its own radius plus the
 * player's. Only the shove can do it, so only the shove is checked.
 */
function shovesIntoPlayer(wx: number, wz: number, r: number, fromX: number, fromZ: number): boolean {
  const min = PLAYER_R + r;
  const dx = wx - state.pos.x, dz = wz - state.pos.z;
  if (dx * dx + dz * dz >= min * min) return false;
  const ox = fromX - state.pos.x, oz = fromZ - state.pos.z;
  return ox * ox + oz * oz >= min * min;
}

// ================= Creature separation =================
/**
 * Bucket edge for the neighbour search, in metres.
 *
 * Derived from the widest creature rather than written down, so adding a bigger
 * one cannot silently leave pairs untested: two creatures can only overlap
 * within the sum of their radii, so a bucket of the largest diameter means the
 * 3x3 block around a creature is guaranteed to contain every one it could be
 * touching.
 */
const SEP_CELL = Math.max(...Object.values(TYPES).map((t) => t.r)) * 2;
const sepBuckets = new Map<number, Monster[]>();

/** Bucket coordinates packed into one number, so the Map can key on a primitive. */
function sepKey(gx: number, gz: number): number {
  return (gx + 4096) * 8192 + (gz + 4096);
}

/**
 * Push overlapping creatures apart. Runs after everything has moved, so it
 * resolves the positions they actually ended up in rather than the ones they
 * asked for.
 *
 * Bucketed rather than every-pair: stage 12 puts 113 creatures in the dungeon,
 * and the naive version is 6,328 pairs a frame to find the handful that are
 * actually touching.
 */
function separateMonsters(dt: number): void {
  sepBuckets.clear();
  for (const m of state.monsters) {
    // Corpses do not shove, and are not shoved. Standing over a body is fine;
    // a body sliding out from under a fight is not.
    if (m.hp <= 0) continue;
    const key = sepKey(Math.floor(m.mesh.position.x / SEP_CELL), Math.floor(m.mesh.position.z / SEP_CELL));
    const b = sepBuckets.get(key);
    if (b) b.push(m);
    else sepBuckets.set(key, [m]);
  }

  const maxStep = CREATURE_PUSH * dt;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const gx = Math.floor(m.mesh.position.x / SEP_CELL), gz = Math.floor(m.mesh.position.z / SEP_CELL);
    let px = 0, pz = 0;
    for (let bz = -1; bz <= 1; bz++) {
      for (let bx = -1; bx <= 1; bx++) {
        const bucket = sepBuckets.get(sepKey(gx + bx, gz + bz));
        if (!bucket) continue;
        for (const o of bucket) {
          if (o === m) continue;
          const ox = m.mesh.position.x - o.mesh.position.x;
          const oz = m.mesh.position.z - o.mesh.position.z;
          const min = m.type.r + o.type.r;
          const d2 = ox * ox + oz * oz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          // Two creatures at the same point have no direction to separate along.
          // The mesh id gives each a fixed angle, so they pick opposite ways and
          // stay picked instead of jittering on a fresh random every frame.
          const a = m.mesh.id * 2.399963;
          const [ux, uz] = d > 1e-4 ? [ox / d, oz / d] : [Math.cos(a), Math.sin(a)];
          // Normalised, so the push grows the deeper they are into each other.
          const overlap = (min - d) / min;
          px += ux * overlap;
          pz += uz * overlap;
        }
      }
    }
    const pl = Math.hypot(px, pz);
    if (pl < 1e-5) continue;
    // Half the budget each: the neighbour moves itself the other way on its own
    // turn, so a pair separates at the full CREATURE_PUSH.
    const scale = (Math.min(pl, 1) * maxStep * 0.5) / pl;
    const nx = m.mesh.position.x + px * scale;
    const nz = m.mesh.position.z + pz * scale;
    // Per axis, exactly like walking: being shoved must not push anyone through
    // a wall, and a creature pinned against one should slide along it instead.
    const fromX = m.mesh.position.x, fromZ = m.mesh.position.z;
    if (!collides(nx, m.mesh.position.z, m.type.clearance)
      && !shovesIntoPlayer(nx, m.mesh.position.z, m.type.r, fromX, fromZ)) m.mesh.position.x = nx;
    if (!collides(m.mesh.position.x, nz, m.type.clearance)
      && !shovesIntoPlayer(m.mesh.position.x, nz, m.type.r, fromX, fromZ)) m.mesh.position.z = nz;
  }
}

// ================= Traps =================
/**
 * Springs any trap the player has walked onto, and settles the ones already
 * sprung.
 *
 * Checked against the player's position after movement rather than along the
 * path they took. A dodge covers 2.9m in 0.26s — about 0.05m a frame at 60fps —
 * so nothing can step over one, and testing the swept path would cost a lot to
 * catch a case that cannot happen.
 *
 * A sprung trap stays in the world. Leaving it as visibly triggered scenery is
 * the only way a player learns what an *un*sprung one looks like, and on a map
 * you are crossing twice it also marks where you have already been.
 */
function updateTraps(dt: number): void {
  for (const t of state.traps) {
    if (t.springT > 0) {
      t.springT = Math.max(0, t.springT - dt);
      // The jaws snap shut. Eased on the square so it leaves fast and arrives
      // hard, which is the whole character of a spring — a linear close reads
      // like a door. The bone ring this replaced could only be scaled flat.
      const k = t.springT / TRAP_SPRING_TIME;
      setTrapJaws(t.jaws, k * k);
      continue;
    }
    if (t.sprung) continue;
    const dx = t.mesh.position.x - state.pos.x, dz = t.mesh.position.z - state.pos.z;
    if (dx * dx + dz * dz > TRAP_RADIUS * TRAP_RADIUS) continue;
    t.sprung = true;
    t.springT = TRAP_SPRING_TIME;
    showMsg(springTrap());
  }
}

/** Seconds the collapse takes. Long enough to see, short enough not to be an event. */
const TRAP_SPRING_TIME = 0.35;

// ================= Chests =================
function updateChests(dt: number, playerMoving: boolean): void {
  state.nearChest = null;
  let nd = 1.7;
  for (const c of state.chests) {
    if (c.state !== 'closed') continue;
    const d = Math.hypot(c.mesh.position.x - state.pos.x, c.mesh.position.z - state.pos.z);
    if (d < nd) {
      nd = d;
      state.nearChest = c;
    }
  }
  promptEl.style.display = state.nearChest && !state.looting ? 'block' : 'none';
  lootBtn.classList.toggle('show', !!state.nearChest && !state.looting);

  if (state.looting) {
    // Moving interrupts looting.
    if (playerMoving) {
      cancelLoot();
    } else {
      state.looting.t += dt;
      lootFillEl.style.width = Math.min(100, (state.looting.t / LOOT_TIME) * 100) + '%';
      if (state.looting.t >= LOOT_TIME) {
        // Cleared *before* the chest opens, not after. A trapped chest damages
        // the player from inside openChest(), and playerHurt() cancels a loot in
        // progress and says "Looting interrupted!" — which is both untrue here
        // (the loot finished) and immediately overwritten by the contents in the
        // same frame. Invisible, but only by accident.
        const chest = state.looting.chest;
        cancelLoot();
        openChest(chest);
      }
    }
  }

  // Easing on the lid as it opens
  for (const c of state.chests) {
    if (c.state === 'opened' && c.openT < 1) {
      c.openT = Math.min(1, c.openT + dt * 3);
      c.lid.rotation.x = CHEST_LID_OPEN * (1 - Math.pow(1 - c.openT, 3));
    }
  }
}

/** Advances a potion going down and applies the health when it lands. */
function updateDrink(dt: number): void {
  if (state.drinkT < 0) return;
  state.drinkT += dt;
  drinkFillEl.style.width = Math.min(100, (state.drinkT / POTION_DRINK) * 100) + '%';
  if (state.drinkT >= POTION_DRINK) finishDrink();
}

/** Burns the lantern down, warns once, and puts it out when the fuel runs dry. */
function updateLantern(dt: number): void {
  if (state.lanternT <= 0) return;
  state.lanternT -= dt;

  if (!state.lanternWarned && state.lanternT <= LANTERN_WARN) {
    state.lanternWarned = true;
    showMsg('The lantern is guttering');
  }
  if (state.lanternT <= 0) {
    state.lanternT = 0;
    state.lightBase = setLampLit(false);
    showMsg('The lantern goes out');
  }
  updateHUD();
}

// ================= Atmosphere =================
/**
 * Moves everything held in hand with the player's stride, and lets it settle when
 * they stop. `swayT` ramps 0..1 with movement so it starts and ends smoothly
 * instead of snapping on the frame the player touches a key.
 *
 * The two hands do not move alike, on purpose. The lantern *hangs*, so it swings
 * on a lag behind the stride and its motion is mostly roll. The weapons are
 * *gripped*, so they ride the body: a small figure of eight, with the vertical
 * term at twice the rate because both feet land per cycle. Giving them the same
 * motion made the sword look like it was dangling from a strap.
 */
let swayT = 0;

function updateHeldGear(dt: number, now: number, moving: boolean): void {
  swayT = Math.max(0, Math.min(1, swayT + (moving ? dt : -dt) * SWAY_DAMP));
  const t = (now / 1000) * STRIDE_RATE;

  // ---- Weapons: carried by the body ----
  const b = swayT * GEAR_BOB;
  gearBob.position.x = Math.sin(t) * b;
  gearBob.position.y = Math.abs(Math.sin(t)) * -b;
  gearBob.rotation.z = Math.sin(t) * swayT * GEAR_BOB_ROLL;
  gearBob.rotation.x = Math.abs(Math.sin(t)) * swayT * GEAR_BOB_ROLL * 0.4;

  // ---- Shield: hung from the other hand, or up ----
  //
  // The raise is smoothed rather than snapped so the shield reads as being
  // lifted. The sway is scaled by how far down it is: a shield hanging at the
  // side swings like the lantern that used to hang here, and a shield braced in
  // front of you does not.
  state.guardT += ((state.guarding ? 1 : 0) - state.guardT) * Math.min(1, dt * GUARD_RAISE);
  const g = state.guardT * state.guardT * (3 - 2 * state.guardT);
  handShield.position.lerpVectors(SHIELD_REST.pos, SHIELD_GUARD.pos, g);
  handShield.rotation.set(
    SHIELD_REST.rot.x + (SHIELD_GUARD.rot.x - SHIELD_REST.rot.x) * g,
    SHIELD_REST.rot.y + (SHIELD_GUARD.rot.y - SHIELD_REST.rot.y) * g,
    SHIELD_REST.rot.z + (SHIELD_GUARD.rot.z - SHIELD_REST.rot.z) * g,
  );
  const a = swayT * LAMP_SWAY * (1 - g);
  handShield.rotation.z += Math.sin(t - LAMP_SWAY_LAG) * a;
  handShield.rotation.x += Math.sin(t * 2 - LAMP_SWAY_LAG) * a * 0.35;
  handShield.position.x += Math.sin(t - LAMP_SWAY_LAG) * a * 0.09;
  handShield.position.y += Math.abs(Math.sin(t)) * a * 0.12;
}

function updateAmbience(dt: number, now: number): void {
  playerLight.position.set(state.pos.x, state.pos.y + 0.25, state.pos.z);
  // Two sines plus noise, so the flicker never settles into a pattern.
  // A lantern running out of fuel gutters before it dies, which is the warning
  // the player actually reads — the HUD countdown is easy to miss in a fight.
  const dying = state.lanternT > 0 && state.lanternT < LANTERN_WARN ? 1 - state.lanternT / LANTERN_WARN : 0;
  const flicker = Math.sin(now * 0.011) * 0.2 + Math.sin(now * 0.037) * 0.12 + (Math.random() - 0.5) * 0.1;
  playerLight.intensity = Math.max(0.35, state.lightBase + flicker * (1 + dying * 5) - dying * 0.55);

  portal.rotation.z += dt * 1.0;
  portalCore.material.opacity = 0.38 + Math.sin(now * 0.004) * 0.12;
  portal.lookAt(state.pos.x, 1.5, state.pos.z);
  portalCore.lookAt(state.pos.x, 1.5, state.pos.z);

  for (const s of state.sconces) {
    const k = 0.75 + Math.sin(now * 0.013 + s.seed) * 0.15 + (Math.random() - 0.5) * 0.2;
    s.light.intensity = 0.55 * k;
    s.flame.scale.set(k, 0.8 + k * 0.4, k);
  }
  for (const p of state.props) {
    if (p.swing !== null) p.object.rotation.z = Math.sin(now * 0.0012 + p.swing) * 0.06;
  }

  // Dust drifts down and returns to the ceiling on reaching the floor, recycled within 14m of the player.
  const dp = dustGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < DUST; i++) {
    dp[i * 3] += Math.sin(now * 0.0004 + i) * 0.0015;
    dp[i * 3 + 1] -= 0.06 * dt;
    dp[i * 3 + 2] += Math.cos(now * 0.0005 + i * 1.3) * 0.0015;
    if (dp[i * 3 + 1] < 0.05) dp[i * 3 + 1] = WALL_H;
    if (dp[i * 3] - state.pos.x > 7) dp[i * 3] -= 14;
    else if (state.pos.x - dp[i * 3] > 7) dp[i * 3] += 14;
    if (dp[i * 3 + 2] - state.pos.z > 7) dp[i * 3 + 2] -= 14;
    else if (state.pos.z - dp[i * 3 + 2] > 7) dp[i * 3 + 2] += 14;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

// ================= Frame loop =================
const clock = new THREE.Clock();

export function animate(): void {
  requestAnimationFrame(animate);
  // Clamped so returning from a backgrounded tab does not deliver one enormous dt.
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  // Paused still renders — the guide sits over a live-looking dungeon — but
  // nothing advances, so reading the controls cannot get the player killed.
  // Outside the block on purpose. Paused, the window is frozen and so is the
  // glow, which is right; dead, it has to go out, and a sword still lit behind
  // the KILLED panel reads as an effect that got stuck. Only with the sword in
  // hand — a lunge does nothing for the musket, so lighting up would be a lie.
  const armed = !state.gameOver && state.weapon === 'sword' ? state.lungeT / LUNGE_WINDOW : 0;
  // The discharge overrides the armed glow rather than adding to it, so the
  // blade goes brightest at the instant the charge is spent and then dies.
  const discharge = state.gameOver ? 0 : (state.lungeHitT / LUNGE_HIT_TIME) * LUNGE_HIT_GLOW;
  setBladeGlow(Math.max(armed, discharge));
  // Shown twice, because a thumb on a phone is nowhere near the sword in the
  // corner: the attack button is where the player is about to press anyway.
  atkBtn.classList.toggle('armed', armed > 0);

  if (!state.gameOver && !state.paused) {
    const moving = updatePlayer(dt, now);
    updateWeapons(dt);
    updateLantern(dt);
    updateDrink(dt);
    const nearest = updateMonsters(dt, now);
    updateChests(dt, moving);
    updateTraps(dt);
    updateHeldGear(dt, now, moving);

    // The closer a creature is, the faster the heart beats.
    if (audioReady() && nearest < 7.5) {
      const interval = 0.42 + (nearest / 7.5) * 0.7;
      if (now / 1000 - lastBeat() > interval) {
        setLastBeat(now / 1000);
        sfxHeartbeat(0.35 + (1 - nearest / 7.5) * 0.65);
      }
    }

    const ex = portal.position.x - state.pos.x, ez = portal.position.z - state.pos.z;
    const atPortal = ex * ex + ez * ez < PORTAL_RADIUS ** 2;
    if (atPortal && state.hasKey) endRun(true);
    // Told once on arrival. The check runs every frame, so warning here without
    // the edge test would replace every other message in the game.
    else if (atPortal && !state.atPortal) showMsg('The portal is sealed — find the key');
    state.atPortal = atPortal;
    if (state.hasMap) drawMinimap();
  }

  camera.position.copy(state.pos);
  // A sideways dodge rolls the view into it and back out. Straight dodges do not
  // roll, because rolling a forward lunge reads as a stumble.
  const dashK = state.dashT >= 0 ? Math.sin((state.dashT / DASH_TIME) * Math.PI) : 0;
  // A landed lunge kicks the view up and settles. Added to the pitch here rather
  // than written into state.pitch, so it cannot accumulate into the player's aim.
  const kickK = state.lungeHitT / LUNGE_HIT_TIME;
  const kick = LUNGE_HIT_KICK * kickK * kickK;
  camera.rotation.set(state.pitch + kick, state.yaw + Math.PI, state.dashSide * DASH_ROLL * dashK, 'YXZ');
  updateAmbience(dt, now);
  renderFrame();
}
