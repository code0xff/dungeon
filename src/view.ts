import * as THREE from 'three';
import { clipDuration, gait, setAnim, spawnPlayerModel } from './assets';
import {
  BODY_WALK_MAX, REMOTE_SWING_FADE, THIRD_PERSON_KEY, TP_BODY_LIFT, TP_CLEAR, TP_DISTANCE, TP_EASE, TP_HEIGHT,
  TP_MIN_DIST, TP_SHOULDER, TP_TURN_RATE, WALL_H,
} from './config';
import { animName, makeFallbackBody, ownAnim } from './net/remote';
import { ANIM_ATTACK, ANIM_DEAD, ANIM_GUARD } from './net/protocol';
import { gearBob, handShield, scene } from './scene';
import { state } from './state';
import type { MonsterPlayback } from './types';
import { showMsg } from './ui';
import { collides } from './world';

/**
 * Third person: the player's own body, and a camera behind it.
 *
 * The body is the same knight the other players see, driven by the same
 * ownAnim() that reports the player to them — so what you see yourself doing is
 * exactly what your allies see, swing for swing.
 *
 * Sword only. The knight carries a sword and a shield and nothing else: there
 * is no musket in its hands and no clip that aims one, so drawing the musket
 * puts the view back behind the eyes, the way most games drop to a tighter
 * camera to aim. First person is not a fallback here, it is the aiming view.
 */

const PREF_KEY = 'dungeon.view.v1';

/** The player's body: a knight clone, or the capsule if the model is missing. */
let body: THREE.Group | null = null;
let playback: MonsterPlayback | null = null;
/** The knight's sword mesh, for the lunge glow. null for the fallback body. */
let swordMat: THREE.MeshStandardMaterial | null = null;
/** Seconds left on a swing the body is committed to — see remote.ts. */
let swinging = 0;
let wasAttacking = false;
let died = false;
/** The camera's current distance from the eye, eased — see TP_EASE. */
let camDist = 0;
/** Where the body is facing, which is not always where the camera is. */
let bodyYaw = 0;
/** Last frame's feet, for measuring how fast they actually moved. */
let lastX = NaN, lastZ = NaN, groundSpeed = 0;
const clear = new THREE.Vector3();

try {
  state.thirdPerson = localStorage.getItem(PREF_KEY) === 'third';
} catch {
  // Storage unavailable; first person is the default and the game still runs.
}

/** True when the body is drawn and the camera is behind it. */
export function thirdPersonActive(): boolean {
  return state.thirdPerson && state.weapon === 'sword';
}

export function toggleView(): void {
  state.thirdPerson = !state.thirdPerson;
  try {
    localStorage.setItem(PREF_KEY, state.thirdPerson ? 'third' : 'first');
  } catch {
    // Not remembered, still switched.
  }
  showMsg(state.thirdPerson
    ? `Third person — ${THIRD_PERSON_KEY} to switch back. The musket aims first-person`
    : 'First person');
}

function ensureBody(): THREE.Group {
  if (body) return body;
  const spawned = spawnPlayerModel();
  body = new THREE.Group();
  if (spawned) {
    body.add(spawned.mesh);
    playback = spawned.playback;
    // The sword is its own mesh, so the lunge glow can go on it alone. The
    // materials were cloned per instance by the spawn, so this touches nobody
    // else's knight.
    spawned.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/Sword/.test(m.name)) swordMat = mat;
      // See TP_BODY_LIFT. The sword's emissive is overwritten every frame by
      // the glow, so it is left out here.
      else if (mat.emissive) { mat.emissive.setHex(0xffffff); mat.emissiveIntensity = TP_BODY_LIFT; }
    });
  } else {
    body.add(makeFallbackBody(0xc9c0ae));
  }
  body.visible = false;
  scene.add(body);
  return body;
}

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const want = new THREE.Vector3();
const glow = new THREE.Color();
const GLOW = new THREE.Color(0xffc060);

/**
 * Where the camera goes for a player at (pos, yaw, pitch): behind, up and over
 * the shoulder, pulled in along its own line until it is clear of the walls.
 *
 * Pure, so the wall handling can be checked with numbers rather than by walking
 * into corners. The sweep samples the line from the eye outward and stops at
 * the last sample that clears the walls by TP_CLEAR and stays under the
 * ceiling; a camera that is inside stone shows the inside of stone.
 */
export function thirdPersonCamera(
  pos: THREE.Vector3, yaw: number, pitch: number, out: THREE.Vector3,
): { dist: number } {
  // The camera's own basis for rotation (pitch, yaw + PI, 0) in YXZ order:
  // it looks down its local -Z, so "forward" is that axis carried into the
  // world, and "right" is its local +X.
  const t = yaw + Math.PI;
  fwd.set(-Math.sin(t) * Math.cos(pitch), Math.sin(pitch), -Math.cos(t) * Math.cos(pitch));
  right.set(Math.cos(t), 0, -Math.sin(t));
  want.copy(pos).addScaledVector(fwd, -TP_DISTANCE).addScaledVector(right, TP_SHOULDER);
  want.y += TP_HEIGHT;

  // Walk out from the eye toward the wanted spot and keep the furthest clear
  // sample. 40 steps over ~2.4m is a sample every 6cm: coarser than that and
  // the camera's distance changes in visible jumps as you turn along a wall.
  out.copy(pos);
  let dist = 0;
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const x = pos.x + (want.x - pos.x) * k;
    const y = pos.y + (want.y - pos.y) * k;
    const z = pos.z + (want.z - pos.z) * k;
    if (collides(x, z, TP_CLEAR) || y > WALL_H - TP_CLEAR || y < TP_CLEAR) break;
    out.set(x, y, z);
    dist = k * pos.distanceTo(want);
  }
  return { dist };
}

/**
 * Called every frame from the loop, after the player has moved. Places the
 * camera when third person is active, and keeps the body in step either way so
 * switching views never shows a body a second behind.
 */
export function updateView(camera: THREE.PerspectiveCamera, dt: number, moving: boolean, bladeGlow: number): void {
  const active = thirdPersonActive();
  const b = ensureBody();

  // First-person gear is the camera's own hands, and hands are not drawn when
  // the whole body is.
  gearBob.visible = !active;
  handShield.visible = !active && state.weapon === 'sword';

  if (!active) {
    b.visible = false;
    camera.position.copy(state.pos);
    // So the next switch into third person eases out from the eye rather than
    // starting at whatever length it last had.
    camDist = 0;
    return;
  }

  const { dist } = thirdPersonCamera(state.pos, state.yaw, state.pitch, clear);
  // In at once, out gradually: the clear point is the furthest the camera may
  // be, and easing *toward* a wall would spend the ease inside it.
  camDist = dist < camDist ? dist : camDist + (dist - camDist) * Math.min(1, dt * TP_EASE);
  camera.position.copy(state.pos).lerp(clear, dist > 0 ? camDist / dist : 0);
  // Too close to draw: the near plane would be inside the back of the model.
  b.visible = camDist >= TP_MIN_DIST;

  b.position.set(state.pos.x, 0, state.pos.z);

  // How fast the feet really moved, smoothed. Measured rather than taken from
  // SPEED because a dodge, a wall slide and the guard shuffle all move the body
  // at something other than SPEED, and the legs should match the floor.
  if (Number.isNaN(lastX)) { lastX = state.pos.x; lastZ = state.pos.z; }
  const stepLen = Math.hypot(state.pos.x - lastX, state.pos.z - lastZ);
  lastX = state.pos.x; lastZ = state.pos.z;
  if (dt > 0) groundSpeed += (stepLen / dt - groundSpeed) * Math.min(1, dt * 12);

  // The body faces the way it walks, and the way it looks when it is doing
  // something aimed. The look direction is (sin yaw, cos yaw), a Mixamo body
  // faces its own +Z, so a yaw is a facing with no correction — see remote.ts.
  const anim = ownAnim(moving);
  const aimed = anim === ANIM_ATTACK || anim === ANIM_GUARD || swinging > 0;
  let want = state.yaw;
  if (moving && !aimed && Math.hypot(state.moveDirX, state.moveDirZ) > 0.01) {
    want = Math.atan2(state.moveDirX, state.moveDirZ);
  }
  const d = Math.atan2(Math.sin(want - bodyYaw), Math.cos(want - bodyYaw));
  const maxStep = TP_TURN_RATE * dt;
  bodyYaw = Math.abs(d) <= maxStep ? want : bodyYaw + Math.sign(d) * maxStep;
  b.rotation.y = bodyYaw;

  if (playback) {
    if (anim === ANIM_DEAD) {
      if (!died) {
        died = true;
        setAnim(playback, 'death', { loop: false, force: true, fade: 0.08 });
      }
    } else {
      died = false;
      // The swing is committed to for the length of the clip and later edges
      // are dropped, for the reasons remote.ts gives: the knight's slash runs
      // longer than the swing behind it, and restarting it every ATTACK_CD kept
      // the sword at the top of its arc.
      const attacking = anim === ANIM_ATTACK;
      if (attacking && !wasAttacking && swinging <= 0) {
        setAnim(playback, 'attack', { loop: false, force: true, fade: REMOTE_SWING_FADE });
        swinging = clipDuration(playback, 'attack') ?? 0;
      }
      wasAttacking = attacking;
      if (swinging > 0) swinging -= dt;
      else {
        let clip = animName(anim, playback);
        // Legs to floor: walk or run by speed, retimed to the clip's own
        // authored pace. Capped by BODY_WALK_MAX rather than the creatures'
        // range, because the player is far faster than any of them.
        const g = clip === 'walk' ? gait(playback, groundSpeed, BODY_WALK_MAX) : null;
        if (g) clip = g.clip;
        if (clip !== 'attack') setAnim(playback, clip);
        if (g && playback.action) playback.action.timeScale = g.scale;
      }
    }
    playback.mixer.update(dt);
  }

  // The lunge glow the first-person blade shows, on the body's own sword.
  if (swordMat) {
    glow.copy(GLOW).multiplyScalar(Math.min(1, bladeGlow) * 0.9);
    swordMat.emissive.copy(glow);
  }
}
