import * as THREE from 'three';
import { setAnim, spawnPlayerModel } from '../assets';
import { REMOTE_FADE, REMOTE_LERP, REMOTE_TINT, REMOTE_TINTS } from '../config';
import { scene } from '../scene';
import { state } from '../state';
import type { MonsterPlayback } from '../types';
import { net, onNetChange, onNetSnap, sendPose } from './client';
import { ANIM_ATTACK, ANIM_DEAD, ANIM_IDLE, ANIM_WALK, TICK_HZ } from './protocol';
import { coop } from './session';

/**
 * The other players' bodies.
 *
 * They are drawn and nothing else: no collision, no AI, no damage. Every remote
 * body is a picture of a decision made on someone else's machine, and the only
 * job here is to make that picture arrive smoothly.
 */
interface Remote {
  id: number;
  group: THREE.Group;
  playback: MonsterPlayback | null;
  /** Where the body is being drawn, which is behind where it has been reported. */
  x: number;
  z: number;
  r: number;
  /** The latest reported pose — what it is moving toward. */
  tx: number;
  tz: number;
  tr: number;
  anim: number;
  /** Seconds since the last snapshot mentioned this player. */
  quiet: number;
}

const remotes = new Map<number, Remote>();

/**
 * A body for when the knight model is missing.
 *
 * Deliberately crude and deliberately not a person: if the download failed, the
 * useful thing is knowing where your ally is standing, and a bad humanoid reads
 * as a bug where an obvious placeholder reads as a placeholder.
 */
function makeFallbackBody(colour: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), mat);
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), mat);
  head.position.y = 1.62;
  g.add(body, head);
  return g;
}

/**
 * A stable colour per player, so the same ally is the same colour all run.
 *
 * Indexed by their position in the roster rather than by id: ids climb for the
 * life of the process, so keying on them would eventually hand two people in
 * the same dungeon the same tint.
 */
function tintFor(id: number): number {
  const i = net.players.findIndex((p) => p.id === id);
  return REMOTE_TINTS[(i < 0 ? 0 : i) % REMOTE_TINTS.length];
}

function createRemote(id: number, x: number, z: number, r: number): Remote {
  const colour = tintFor(id);
  const spawned = spawnPlayerModel();
  const group = new THREE.Group();
  if (spawned) {
    // Emissive rather than a recolour, at REMOTE_TINT: the knight's own texture
    // and its armour detail survive, and the tint both identifies the player and
    // lifts them off a dark wall. Pushing it harder erases the model.
    spawned.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.emissive) continue;
        std.emissive = new THREE.Color(colour);
        std.emissiveIntensity = REMOTE_TINT;
      }
    });
    group.add(spawned.mesh);
  } else {
    group.add(makeFallbackBody(colour));
  }
  group.position.set(x, 0, z);
  scene.add(group);
  const rem: Remote = {
    id, group, playback: spawned?.playback ?? null,
    x, z, r, tx: x, tz: z, tr: r, anim: ANIM_IDLE, quiet: 0,
  };
  if (rem.playback) setAnim(rem.playback, 'idle', { fade: 0 });
  return rem;
}

function destroy(rem: Remote): void {
  scene.remove(rem.group);
  // The geometry and materials come from the shared template clone, so only the
  // mixer holds anything that would otherwise keep ticking.
  rem.playback?.mixer.stopAllAction();
}

/** Drops every body. buildWorld() calls this: the last dungeon's allies are gone. */
export function clearRemotes(): void {
  for (const rem of remotes.values()) destroy(rem);
  remotes.clear();
}

onNetSnap((rows) => {
  for (const row of rows) {
    let rem = remotes.get(row.id);
    if (!rem) {
      rem = createRemote(row.id, row.x, row.z, row.r);
      remotes.set(row.id, rem);
    }
    rem.tx = row.x;
    rem.tz = row.z;
    rem.tr = row.r;
    rem.anim = row.a;
    rem.quiet = 0;
  }
});

/**
 * Drops the body of anyone the roster says is no longer in this dungeon.
 *
 * The fade below is the backstop for packets that stop arriving; this is the
 * clean case, and it is worth handling separately for two reasons. It is
 * immediate — a player who dies or disconnects should not stand there for
 * REMOTE_FADE seconds afterwards — and it is driven by a message rather than by
 * the frame loop, so it still happens in a tab that is not being drawn.
 */
onNetChange(() => {
  for (const [id, rem] of remotes) {
    const row = net.players.find((p) => p.id === id);
    if (row && row.inRun) continue;
    destroy(rem);
    remotes.delete(id);
  }
});

/** Radians from a to b, taking the short way round. */
function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function animName(a: number): 'idle' | 'walk' | 'attack' | 'death' {
  if (a === ANIM_WALK) return 'walk';
  if (a === ANIM_ATTACK) return 'attack';
  if (a === ANIM_DEAD) return 'death';
  return 'idle';
}

/**
 * Advances the bodies. Called every frame from the loop.
 *
 * The position is chased rather than snapped. Snapshots arrive TICK_HZ times a
 * second and frames are drawn three or four times as often, so a body written
 * straight from the last snapshot moves in visible steps. Chasing it also
 * absorbs a dropped packet: the body keeps sliding toward where it was last
 * going instead of stopping dead and jumping when the next one lands.
 */
export function updateRemotes(dt: number): void {
  for (const [id, rem] of remotes) {
    rem.quiet += dt;
    // Gone: their run ended, they disconnected, or the packets stopped. Bodies
    // are removed on silence rather than on a message, because the message is
    // the thing most likely to be the one that went missing.
    if (rem.quiet > REMOTE_FADE) {
      destroy(rem);
      remotes.delete(id);
      continue;
    }

    // Frame-rate independent: at 144Hz this must not converge four times faster
    // than at 40Hz, or a fast machine's bodies snap while a slow one's glide.
    const k = 1 - Math.exp(-REMOTE_LERP * dt);
    rem.x += (rem.tx - rem.x) * k;
    rem.z += (rem.tz - rem.z) * k;
    rem.r += angleTo(rem.r, rem.tr) * k;
    rem.group.position.set(rem.x, 0, rem.z);
    // +PI because the model faces down its own -Z, the same correction the
    // camera makes for the player's yaw.
    rem.group.rotation.y = rem.r + Math.PI;

    if (rem.playback) {
      const want = animName(rem.anim);
      // death does not loop: a body that replayed its own collapse every second
      // would be the funniest thing in the dungeon and the least readable.
      setAnim(rem.playback, want, want === 'death' ? { loop: false } : {});
      rem.playback.mixer.update(dt);
    }
  }
}

/** What this player's body is doing, for the others to draw. */
function ownAnim(moving: boolean): number {
  if (state.gameOver) return ANIM_DEAD;
  if (state.swingT >= 0) return ANIM_ATTACK;
  return moving ? ANIM_WALK : ANIM_IDLE;
}

let sinceSend = 0;

/**
 * Sends this player's pose at TICK_HZ, not every frame.
 *
 * A 144Hz machine sending every frame would put seven times the traffic through
 * the host as a 20Hz one and gain nothing: the receiver interpolates anyway, so
 * the extra frames are thrown away at the other end.
 */
export function sendOwnPose(dt: number, moving: boolean): void {
  if (!coop.active) return;
  sinceSend += dt;
  if (sinceSend < 1 / TICK_HZ) return;
  sinceSend = 0;
  // Rounded to the centimetre and the hundredth of a radian. At 20Hz the digits
  // below that are noise nobody can see, and they are a third of the message.
  sendPose(
    Math.round(state.pos.x * 100) / 100,
    Math.round(state.pos.z * 100) / 100,
    Math.round(state.yaw * 100) / 100,
    ownAnim(moving),
  );
}
