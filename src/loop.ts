import * as THREE from 'three';
import { clipDuration, flashLoadedMesh, setAnim } from './assets';
import { audioReady, lastBeat, setLastBeat, sfxCreature, sfxHeartbeat, sfxReloadStep } from './audio';
import {
  ATTACK_IMPACT, ATTACK_IMPACT_REACH, CELL, CHEST_LID_OPEN, CREATURE_DRAW_DISTANCE,
  DASH_ROLL, DASH_SPEED, DASH_TIME, EYE_H, GROUND_SPEED_SMOOTH,
  FALLBACK_ATTACK_TIME, GEAR_BOB, GEAR_BOB_ROLL, LAMP_SWAY, LAMP_SWAY_LAG,
  LANTERN_WARN, LOOT_TIME, MUSKET_RELOAD, PORTAL_RADIUS, SPEED, STRIDE_RATE, SWAY_DAMP,
  SWING_IMPACT,
  SWING_SPEED, SWING_WINDUP, TURN_RATE, WALK_CLIP_SPEED, WALK_TIMESCALE_RANGE, WALL_H,
} from './config';
import { playerHurt, resolveSwing } from './combat';
import { findPath } from './dungeon';
import { edgeTurn, keys, moveInput } from './input';
import { openChest } from './loot';
import {
  DUST, camera, dustGeo, flashLight, gearBob, handLamp, LAMP_REST, MUSKET_REST, musket,
  muzzleFlash, portal, portalCore, renderFrame, scene, setLampLit, SMOKE_REST_Y, smoke, sword,
  SWORD_REST, playerLight,
} from './scene';
import { state } from './state';
import { collides } from './world';
import type { CreatureRig, Monster, MonsterPlayback } from './types';
import {
  cancelLoot, drawMinimap, endRun, lootBtn, lootFillEl,
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

  // Moving each axis separately is what lets the player slide along a wall.
  const step = (dx: number, dz: number): void => {
    if (!collides(state.pos.x + dx, state.pos.z)) state.pos.x += dx;
    if (!collides(state.pos.x, state.pos.z + dz)) state.pos.z += dz;
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
    step(
      (Math.sin(state.yaw) * f - Math.cos(state.yaw) * s) * SPEED * dt,
      (Math.cos(state.yaw) * f + Math.sin(state.yaw) * s) * SPEED * dt,
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

    // ---- Attack animation in progress ----
    const attacking = m.attackT > 0;
    if (attacking) {
      m.attackT -= dt;
      if (m.pendingHit !== null) {
        m.pendingHit -= dt;
        if (m.pendingHit <= 0) {
          m.pendingHit = null;
          // The player must still be in reach when the arm lands — back away and it whiffs.
          if (dist < t.reach * ATTACK_IMPACT_REACH) playerHurt(t.dmg);
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
  return nearest;
}

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
        openChest(state.looting.chest);
        cancelLoot();
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

  // ---- Lantern: hung from the other hand ----
  if (!handLamp.visible) return;
  const a = swayT * LAMP_SWAY;
  handLamp.rotation.z = LAMP_REST.rot.z + Math.sin(t - LAMP_SWAY_LAG) * a;
  handLamp.rotation.x = LAMP_REST.rot.x + Math.sin(t * 2 - LAMP_SWAY_LAG) * a * 0.35;
  handLamp.position.x = LAMP_REST.pos.x + Math.sin(t - LAMP_SWAY_LAG) * a * 0.09;
  handLamp.position.y = LAMP_REST.pos.y + Math.abs(Math.sin(t)) * a * 0.12;
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
  if (!state.gameOver && !state.paused) {
    const moving = updatePlayer(dt, now);
    updateWeapons(dt);
    updateLantern(dt);
    const nearest = updateMonsters(dt, now);
    updateChests(dt, moving);
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
  camera.rotation.set(state.pitch, state.yaw + Math.PI, state.dashSide * DASH_ROLL * dashK, 'YXZ');
  updateAmbience(dt, now);
  renderFrame();
}
