import * as THREE from 'three';
import { clipDuration, setAnim, spawnPlayerModel } from './assets';
import {
  REMOTE_SWING_FADE, THIRD_PERSON_KEY, TP_BODY_LIFT, TP_CLEAR, TP_DISTANCE, TP_EASE, TP_HEIGHT, TP_MIN_DIST,
  TP_SHOULDER, WALL_H,
} from './config';
import { animName, makeFallbackBody, ownAnim } from './net/remote';
import { ANIM_ATTACK, ANIM_DEAD } from './net/protocol';
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
  // The look direction is (sin yaw, cos yaw) and a Mixamo body faces its own
  // +Z, so yaw alone turns it to face where the player looks — see remote.ts.
  b.rotation.y = state.yaw;

  if (playback) {
    const anim = ownAnim(moving);
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
        const want = animName(anim, playback);
        if (want !== 'attack') setAnim(playback, want);
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
