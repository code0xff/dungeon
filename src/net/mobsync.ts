import { MOB_LERP, MOB_STALE, TYPES } from '../config';
import { killMonster, playerHurt } from '../combat';
import { scene } from '../scene';
import { state } from '../state';
import { showMsg } from '../ui';
import {
  isAuthority, net, onNetKill, onNetMobHit, onNetMobs, onNetRemoteHit,
  sendHit, sendKill, sendMobHit, sendMobs,
} from './client';
import { ANIM_ATTACK, ANIM_DEAD, ANIM_IDLE, ANIM_WALK, TICK_HZ } from './protocol';
import type { MobRow } from './protocol';
import { coop } from './session';

/**
 * The creatures, when somebody else is simulating them.
 *
 * One client in each dungeon runs the real AI — see isAuthority() — and everyone
 * else runs this instead: no pathfinding, no attack decisions, no damage. They
 * take positions off the wire and chase them, exactly as remote.ts does for the
 * other players' bodies.
 *
 * The split exists because creatures are a continuous simulation. Two clients
 * running the same AI from the same seed drift apart within seconds — they see
 * different players in different places — and then you and your ally are swinging
 * at a zombie that is three metres apart on your two screens.
 */

/**
 * The latest reported state per creature index, and how long ago it arrived.
 *
 * The age matters because a snapshot is *partial*: the host drops creatures
 * further than MOB_INTEREST from the recipient, so walking away from one does
 * not produce a "gone" message, it produces silence. Without the age, that
 * creature would stand at its last reported spot forever — drawn, and counted
 * by the heartbeat as something nearby.
 */
interface Target {
  row: MobRow;
  quiet: number;
}

const targets = new Map<number, Target>();

/** Creatures this client has already put down, so a repeated kill does nothing. */
const killed = new Set<number>();

/** Drops everything. buildWorld() calls it: these creatures no longer exist. */
export function clearMobSync(): void {
  targets.clear();
  killed.clear();
  sinceSend = 0;
}

/** What a followed creature is doing, or null if this client has not been told. */
export function mobAnim(index: number): number | null {
  return targets.get(index)?.row.a ?? null;
}

onNetMobs((rows) => {
  // Ignored while simulating. A client that has just become the authority may
  // still receive a packet the old one had already sent, and applying it would
  // drag its creatures back to where somebody else last thought they were.
  if (isAuthority()) return;
  for (const row of rows) targets.set(row.i, { row, quiet: 0 });
});

/**
 * Applies a hit somebody else landed. Authority only.
 *
 * The attacker has already drawn the blood on their own screen; this is where it
 * becomes true. Nothing is sent back — the next snapshot carries the new hp, and
 * a death carries its own message.
 */
onNetRemoteHit((i, d, by) => {
  if (!isAuthority()) return;
  const m = state.monsters[i];
  if (!m || m.hp <= 0) return;
  m.hp -= d;
  m.hurtT = 0.18;
  if (m.hp <= 0) {
    // Not paid here: the authority is not the one who swung. The roll is made
    // once and travels with the announcement.
    const gold = killMonster(m, { pay: false });
    sendKillTo(i, by, gold);
  }
});

/** The authority telling everyone a creature is down and who is being paid. */
onNetKill((i, by, gold) => {
  const m = state.monsters[i];
  // Guarded on having killed it, not on its hp. A living creature's hp arrives
  // rounded and can already read 0 here, and testing that would leave the body
  // standing: never dying, never removed, still drawn.
  if (!m || killed.has(i)) return;
  killed.add(i);
  targets.delete(i);
  // The amount travels with the announcement rather than being rolled again
  // here: REWARD_SPREAD makes every roll different, and four clients rolling
  // for one kill would show four numbers for the same corpse.
  killMonster(m, { pay: by === net.id, gold });
  if (by === net.id) showMsg(`${m.type.name} killed +${gold} G`);
});

/**
 * A creature landed a blow on this player, according to the authority.
 *
 * The damage arrives; whether it lands does not. playerHurt() resolves the
 * guard, the arc and the parry here, on the machine of the person holding the
 * shield — which is the reason this mode is co-op. Over the internet the
 * attack is already ~70ms old, and in PvP that would be somebody losing a fight
 * to their connection. Here it is somebody keeping a block they earned.
 */
onNetMobHit((i, p, d) => {
  if (p !== net.id) return;
  playerHurt(d, state.monsters[i] ?? undefined);
});

let sinceSend = 0;

/**
 * Publishes the creatures. Authority only, at TICK_HZ.
 *
 * Everything is sent every tick, including creatures nobody is near: the host
 * trims per recipient from the poses it already holds, and working out four
 * players' interest here would be the same filtering done four times in the
 * place with the least information.
 */
export function publishMobs(dt: number): void {
  if (!coop.active || !isAuthority()) return;
  sinceSend += dt;
  if (sinceSend < 1 / TICK_HZ) return;
  sinceSend = 0;

  const rows: MobRow[] = [];
  for (let i = 0; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    // A creature that has finished its death animation is gone from the scene
    // and does not need reporting; the kill message already removed it.
    if (m.hp <= 0 && !m.dead) continue;
    rows.push({
      i,
      x: Math.round(m.mesh.position.x * 100) / 100,
      z: Math.round(m.mesh.position.z * 100) / 100,
      r: Math.round(m.mesh.rotation.y * 100) / 100,
      a: m.hp <= 0 ? ANIM_DEAD : m.attackT > 0 ? ANIM_ATTACK : m.moving ? ANIM_WALK : ANIM_IDLE,
      // Rounded *up*, so something still alive never reports 0. A creature on
      // 0.4 hp is alive, and saying otherwise makes the receiver treat it as
      // dead before anyone has killed it.
      hp: m.hp > 0 ? Math.ceil(m.hp) : 0,
    });
  }
  if (rows.length) sendMobs(rows);
}

/** Tells the authority about a hit this client just landed. */
export function reportHit(index: number, damage: number): void {
  sendHit(index, Math.round(damage * 10) / 10);
}

/** Tells a player that a creature hit them. Authority only. */
export function reportMobHit(index: number, playerId: number, damage: number): void {
  sendMobHit(index, playerId, damage);
}

/** The authority's own kills, announced so the party sees them. */
export function announceKill(index: number, gold: number): void {
  if (coop.active && isAuthority()) sendKillTo(index, net.id, gold);
}

function sendKillTo(index: number, by: number, gold: number): void {
  if (coop.active) sendKill(index, by, gold);
}

/**
 * Moves the creatures this client is not simulating, and returns the distance to
 * the nearest living one so the heartbeat still works.
 *
 * Chased rather than snapped, for the reason remote.ts chases the player bodies:
 * snapshots arrive at TICK_HZ and frames are drawn three or four times as often.
 * A creature written straight from the last packet walks in visible steps, and
 * one you are fighting is exactly where that is least acceptable.
 */
export function followMobs(dt: number): number {
  let nearest = 99;
  const k = 1 - Math.exp(-MOB_LERP * dt);

  for (const t of targets.values()) t.quiet += dt;

  for (let i = 0; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    const target = targets.get(i);

    if (m.hp <= 0) {
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

    // Stale means "you walked away from it", not "it died": the host stops
    // sending what is out of range, and silence is the only notice given.
    if (target && target.quiet > MOB_STALE) {
      targets.delete(i);
      m.mesh.visible = false;
      continue;
    }
    const row = target?.row;

    if (!row) {
      // Never reported, or out of the interest radius. Hidden rather than left
      // standing where the seed first put it — a creature drawn at its spawn
      // point while it is actually across the dungeon is worse than no creature.
      m.mesh.visible = false;
      continue;
    }

    m.hp = row.hp;
    m.mesh.position.x += (row.x - m.mesh.position.x) * k;
    m.mesh.position.z += (row.z - m.mesh.position.z) * k;
    m.mesh.rotation.y = turnTo(m.mesh.rotation.y, row.r, k);
    m.moving = row.a === ANIM_WALK;

    const dist = Math.hypot(state.pos.x - m.mesh.position.x, state.pos.z - m.mesh.position.z);
    nearest = Math.min(nearest, dist);
    m.mesh.visible = true;

    // Ground speed drives the walk clip's retiming, and here it is read off the
    // reported motion rather than measured: the interpolation is a smoothed
    // version of what the authority did, so measuring it would feed the clip the
    // smoothing rather than the walk.
    const t = TYPES[m.key];
    m.groundSpeed = row.a === ANIM_WALK ? t.speed * m.speedMul : 0;
  }
  return nearest;
}

/** Shortest way round from a to b, by k. */
function turnTo(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
