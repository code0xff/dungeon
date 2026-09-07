import * as THREE from 'three';
import { clipDuration, setAnim, spawnPlayerModel } from '../assets';
import {
  NAME_TAG_W, NAME_TAG_Y, REMOTE_FADE, REMOTE_LERP, REMOTE_SWING_FADE, REMOTE_TINT, REMOTE_TINTS,
} from '../config';
import { scene } from '../scene';
import { state } from '../state';
import type { ClipName, MonsterPlayback } from '../types';
import { net, onNetChange, onNetSnap, sendPose } from './client';
import { ANIM_ATTACK, ANIM_DEAD, ANIM_GUARD, ANIM_IDLE, ANIM_WALK, TICK_HZ } from './protocol';
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
  /** The name label, and the name it was drawn with. */
  tag: THREE.Sprite;
  tagName: string;
  /**
   * True for the fallback body, which built its own geometry.
   *
   * A loaded model shares its geometry with the template every other ally is
   * cloned from, and disposing that would empty the dungeon of allies.
   */
  ownsGeometry: boolean;
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
  /**
   * Seconds left on a swing the body is committed to.
   *
   * The sender reports a swing for as long as *their* swing lasts — a third of
   * a second of first-person arm — and the knight's slash clip is longer than
   * that. Following the wire cut every ally's attack off part way through. Once
   * a swing starts here it runs to the end of the clip, and the wire is not
   * consulted about the body until it has.
   */
  swinging: number;
  /** Set for one frame when a swing has just been reported, so it starts once. */
  swingStart: boolean;
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
 * The floating name over an ally.
 *
 * Drawn into a canvas rather than built from DOM: this has to sit in the world,
 * behind walls and at the right distance, and an HTML overlay would have to be
 * projected by hand every frame and would happily draw through stone.
 *
 * The name came off the network, so it goes through fillText and nothing else —
 * no innerHTML anywhere near it.
 */
function makeNameTag(name: string, colour: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const x = canvas.getContext('2d');
  // A canvas with no 2d context is not worth failing a run over; an empty tag
  // is. The caller gets a sprite either way.
  if (x) {
    x.font = '600 34px "EB Garamond", Georgia, serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    // Outlined before filled. A dungeon is lit the colour of rust and a name in
    // any single colour disappears against something — the dark stroke is what
    // makes it readable over a torch as well as over shadow.
    x.lineWidth = 6;
    x.strokeStyle = 'rgba(0,0,0,0.85)';
    x.strokeText(name, 128, 34);
    x.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
    x.fillText(name, 128, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  // The label is small on screen and never viewed straight on, so a mipmap
  // chain costs memory to make it blurrier.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(NAME_TAG_W, NAME_TAG_W / 4, 1);
  sprite.position.y = NAME_TAG_Y;
  return sprite;
}

/** What to call a player: their name, or something stable until the roster lands. */
function nameFor(id: number): string {
  return net.players.find((p) => p.id === id)?.name ?? `Player ${id}`;
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
  const tagName = nameFor(id);
  const tag = makeNameTag(tagName, colour);
  group.add(tag);
  group.position.set(x, 0, z);
  scene.add(group);
  const rem: Remote = {
    id, group, tag, tagName, ownsGeometry: !spawned, playback: spawned?.playback ?? null,
    x, z, r, tx: x, tz: z, tr: r, anim: ANIM_IDLE, quiet: 0, swinging: 0, swingStart: false,
  };
  if (rem.playback) setAnim(rem.playback, 'idle', { fade: 0 });
  return rem;
}

function destroy(rem: Remote): void {
  scene.remove(rem.group);
  rem.playback?.mixer.stopAllAction();
  // The tag owns its canvas texture and material outright.
  rem.tag.material.map?.dispose();
  rem.tag.material.dispose();
  // And so does the body, in two different ways. A loaded model is a clone
  // whose *materials* were cloned per instance so the tint is per player — the
  // geometry is shared with the template and must be left alone. A fallback
  // body built here owns both. Getting this wrong in either direction is a
  // bug: leaking on every join, or disposing the template out from under
  // everyone else.
  rem.group.traverse((o) => {
    // The tag is a Sprite, disposed above, and is not a Mesh — so the isMesh
    // test already excludes it.
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat?.dispose();
    if (rem.ownsGeometry) mesh.geometry?.dispose();
  });
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
    // The edge, not the level: a swing that is still being reported from last
    // tick is the same swing, and restarting the clip on every packet would
    // stutter it at 20Hz.
    if (row.a === ANIM_ATTACK && rem.anim !== ANIM_ATTACK) rem.swingStart = true;
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
    // Compared against coop.runId, not net.runId: net.runId is cleared the
    // moment this player's own run ends, and a spectator watching from the end
    // screen still wants the bodies of the dungeon they just left. An ally who
    // has gone into the *next* run has a different runId and is dropped, which
    // is what stops their body haunting the run they left — a ghost the
    // creatures would happily chase.
    if (!row || !row.inRun || row.runId !== coop.runId) {
      destroy(rem);
      remotes.delete(id);
      continue;
    }
    // A body can be created from a pose that arrived before the roster did, so
    // the tag may be reading "Player 3". Redrawn once the real name is known.
    if (row.name !== rem.tagName) {
      rem.tag.material.map?.dispose();
      rem.tag.material.dispose();
      rem.group.remove(rem.tag);
      rem.tag = makeNameTag(row.name, tintFor(id));
      rem.tagName = row.name;
      rem.group.add(rem.tag);
    }
  }
});

/** Radians from a to b, taking the short way round. */
function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function animName(a: number, pb: MonsterPlayback): ClipName {
  if (a === ANIM_WALK) return 'walk';
  if (a === ANIM_ATTACK) return 'attack';
  if (a === ANIM_DEAD) return 'death';
  // A body whose knight has no guard clip stands rather than walks in place:
  // setAnim() ignores a clip it does not have and would leave whatever was
  // playing — a walk, for a player who guarded while moving.
  if (a === ANIM_GUARD) return pb.clips.guard ? 'guard' : 'idle';
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
      if (rem.swingStart) {
        rem.swingStart = false;
        // A swing that arrives while the last one is still playing is dropped,
        // not started. An ally can swing every ATTACK_CD — 0.45s — and the
        // knight's slash runs about 1.5s; restarting on every edge meant that
        // at a normal cadence the clip never got past its first third and the
        // sword never came down. One full slash per clip-length reads as
        // swinging; a sword that jerks back to the top every half second reads
        // as broken. This is the opposite call from the creatures', whose clips
        // are scaled to the length of the swing they report.
        if (rem.swinging <= 0) {
          // Forced anyway: setAnim will not restart the clip that is already
          // the current action, and after a finished slash it still is.
          setAnim(rem.playback, 'attack', { loop: false, force: true, fade: REMOTE_SWING_FADE });
          rem.swinging = clipDuration(rem.playback, 'attack') ?? 0;
        }
      }
      if (rem.swinging > 0) {
        rem.swinging -= dt;
      } else {
        const want = animName(rem.anim, rem.playback);
        // death does not loop: a body that replayed its own collapse every
        // second would be the funniest thing in the dungeon and the least
        // readable. A swing the wire is still reporting after the clip has
        // finished is left as idle — the blow has landed either way.
        if (want !== 'attack') setAnim(rem.playback, want, want === 'death' ? { loop: false } : {});
      }
      rem.playback.mixer.update(dt);
    }
  }
}

/**
 * The player nearest to a point, counting this one and every ally.
 *
 * The creatures use it to pick who to chase. Without it the whole dungeon
 * converges on whoever happens to be simulating, and three of the four players
 * walk through an empty maze while the fourth is eaten.
 *
 * Returns id 0 for this player, because ids only exist in co-op and the callers
 * only need to know whether the target is somebody else.
 */
export function nearestPlayer(x: number, z: number): { id: number; x: number; z: number; dist: number } {
  let best = { id: 0, x: state.pos.x, z: state.pos.z, dist: Math.hypot(state.pos.x - x, state.pos.z - z) };
  for (const rem of remotes.values()) {
    // A dead ally is not a target. Their body is still drawn until their client
    // leaves the run, and creatures queueing around a corpse is not the game.
    if (rem.anim === ANIM_DEAD) continue;
    const d = Math.hypot(rem.x - x, rem.z - z);
    if (d < best.dist) best = { id: rem.id, x: rem.x, z: rem.z, dist: d };
  }
  return best;
}

/** Where an ally is, or null if this client has no body for them. */
export function remotePosition(id: number): { x: number; z: number } | null {
  const rem = remotes.get(id);
  return rem ? { x: rem.x, z: rem.z } : null;
}

/** What this player's body is doing, for the others to draw. */
function ownAnim(moving: boolean): number {
  if (state.gameOver) return ANIM_DEAD;
  if (state.swingT >= 0) return ANIM_ATTACK;
  // Over walking: the guard clip is a held pose, and a body creeping along at
  // GUARD_SLOW with its shield up says more than legs do.
  if (state.guarding) return ANIM_GUARD;
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
