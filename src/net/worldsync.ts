import { sfxCreak, sfxTrap } from '../audio';
import { alertCreatures } from '../combat';
import {
  CHEST_ALERT_RADIUS, CHEST_ALERT_TIME, LANTERN_FUEL, SHOT_ALERT_RADIUS, SHOT_ALERT_TIME,
  TRAP_ALERT_RADIUS, TRAP_ALERT_TIME, TRAP_SPRING_TIME,
} from '../config';
import { setLampLit, setPortalOpen } from '../scene';
import { el } from '../dom';
import { state } from '../state';
import { cancelLoot, minimapEl, objectiveEl, overlayEl, showMsg, updateHUD } from '../ui';
import { isAuthority, net, onNetClaim, onNetEvent, onNetParty, sendClaim, sendEvent } from './client';
import { remotePosition } from './remote';
import type { WorldEvent } from './protocol';
import { coop } from './session';

/**
 * Keeps the dungeon itself in step between players: chests, the key, the map
 * and the floor traps.
 *
 * Only *changes* cross the wire. Everyone generated the same dungeon from the
 * same seed, so both sides already know what chest 3 holds and where trap 7 is
 * — an event is two numbers, and the receiver looks the rest up locally.
 *
 * This is not the same problem as the creatures. A chest is opened once, by one
 * person, at a moment everyone can agree on; a creature is a continuous
 * simulation. So chests are handled as events from whoever did them, and the
 * creatures still run separately on every client until one of them is made the
 * authority.
 */

/** What to call a player in a message, when it was not this one. */
function nameOf(id: number): string {
  return net.players.find((p) => p.id === id)?.name ?? 'Someone';
}

/** Sends only in co-op. In solo these all cost nothing and do nothing. */
function tell(k: WorldEvent, i: number): void {
  if (coop.active) sendEvent(k, i);
}

export function tellCreak(chestIndex: number): void {
  tell('creak', chestIndex);
  // And ask to own it. The noise and the claim are separate on purpose: the
  // noise is true the moment the lid moves and cannot be taken back, while the
  // claim is a question the host answers. Sending them together only means the
  // answer arrives while the loot bar is still running.
  if (coop.active) sendClaim(chestIndex, net.id);
}

/**
 * The host has said who owns a chest.
 *
 * Losing means somebody started opening it first — not that they finished. The
 * loot is cancelled now rather than at the end, so the player can go and do
 * something else with the second they would have spent standing still.
 */
/** Chest indices the host has awarded to this player. */
const granted = new Set<number>();

/**
 * Drops the grants with the dungeon. buildWorld() calls it.
 *
 * They are chest *indices*, and the next dungeon has its own chest 3 — carrying
 * them would let a player open one without ever asking, which is the whole
 * thing this exists to prevent.
 */
export function clearWorldSync(): void {
  granted.clear();
}

onNetClaim((i, to) => {
  if (to === net.id) {
    granted.add(i);
    return;
  }
  // Named to somebody else, so it is no longer ours — and this line is the one
  // that matters. A grant used to be kept forever once received, which let two
  // players hold one at the same time: take a chest, get interrupted by a
  // zombie before opening it, and the lease on the host expires while your own
  // client still believes the chest is yours. The next player is granted it for
  // real, and if you both finish opening within a round trip of each other,
  // neither has heard about the other's chest and it pays twice.
  granted.delete(i);
  if (state.looting?.chest !== state.chests[i]) return;
  cancelLoot();
  showMsg(`${nameOf(to)} is already opening that one`);
});

/**
 * Whether this player may open a chest yet.
 *
 * In solo, always. In co-op the answer comes from the host, and the loot bar
 * waits at the end for it rather than opening on the strength of having asked.
 * That is what closes the race: two clients can both finish looting, but only
 * one of them is ever told yes.
 *
 * The wait is normally invisible — the request goes out when the lid starts
 * moving, LOOT_TIME earlier — and it only shows at all on a connection where
 * the round trip is longer than opening a chest takes.
 */
export function mayOpen(chestIndex: number): boolean {
  return !coop.active || granted.has(chestIndex);
}

/**
 * The party's total, whenever somebody's run ends.
 *
 * Written into the end screen if this player is sitting on one, because that is
 * where the number belongs and they may well be reading it when an ally walks
 * out — a total that was true when the panel opened and silently wrong a minute
 * later is worse than no total.
 */
onNetParty((run, total, by, gold, out) => {
  // A score for a dungeon this player is no longer counting. They may have died
  // out of it, gone back in, and be looking at a newer run's end screen.
  if (run !== coop.runId) return;
  coop.partyGold = total;
  const mine = by === net.id;
  if (!mine) {
    showMsg(out
      ? `${nameOf(by)} got out with ${gold} G — the party has ${total} G`
      : `${nameOf(by)} died with ${gold} G`);
  }
  const bank = el('ovBank');
  if (overlayEl.style.display === 'flex') bank.textContent = `Party total: ${total} G`;
});

export function tellChestOpened(chestIndex: number): void {
  tell('chest', chestIndex);
}

export function tellTrapSprung(trapIndex: number): void {
  tell('trap', trapIndex);
}

/** One player lit a lantern; the whole party sees by it. */
export function tellLantern(): void {
  tell('lantern', 0);
}

/**
 * A musket went off here.
 *
 * The noise is what matters and it is loud enough to be the point of the
 * weapon. No position travels with it: the authority already holds a fresher
 * copy of where the shooter is than anything this could send.
 */
export function tellShot(): void {
  tell('shot', 0);
}

onNetEvent((k, i, by) => {
  if (k === 'creak') {
    const c = state.chests[i];
    if (!c) return;
    // The noise happens where the chest is, not where this player is standing.
    // Alerting locally rather than trusting the sender's count: their creatures
    // are not these creatures yet, and how many heard it is a fact about this
    // dungeon's copy.
    alertCreatures(CHEST_ALERT_RADIUS, CHEST_ALERT_TIME, c.mesh.position.x, c.mesh.position.z);
    sfxCreak();
    return;
  }

  if (k === 'lantern') {
    // Topped up rather than set, exactly as the player's own lantern is, so two
    // people lighting one in the same minute is not a wasted lantern.
    state.lanternT = Math.min(LANTERN_FUEL, state.lanternT + LANTERN_FUEL);
    state.lanternWarned = false;
    state.lightBase = setLampLit(true);
    showMsg(`${nameOf(by)} lit a lantern`);
    updateHUD();
    return;
  }

  if (k === 'shot') {
    // Only the client simulating the creatures needs to act: everyone else is
    // drawing what it reports. The shot happened where the shooter is, and
    // remote.ts already knows that better than any payload could say.
    if (!isAuthority()) return;
    const who = remotePosition(by);
    if (who) alertCreatures(SHOT_ALERT_RADIUS, SHOT_ALERT_TIME, who.x, who.z);
    return;
  }

  if (k === 'trap') {
    const t = state.traps[i];
    if (!t || t.sprung) return;
    t.sprung = true;
    t.springT = TRAP_SPRING_TIME;
    alertCreatures(TRAP_ALERT_RADIUS, TRAP_ALERT_TIME, t.mesh.position.x, t.mesh.position.z);
    sfxTrap();
    // No damage. A trap hurts whoever stood on it, and that was resolved on
    // their machine — see docs/coop.md on who decides what.
    return;
  }

  // Explicit, not "everything else". The chest branch used to be the fallthrough
  // and any kind this build does not know — an older peer, a modified one —
  // silently consumed a chest.
  if (k !== 'chest') return;
  const c = state.chests[i];
  if (!c || c.state !== 'closed') return;
  c.state = 'opened';
  c.openT = 0;

  // Standing at the same chest, part way through opening it. Without this the
  // bar would run to the end and openChest() would pay the contents out twice —
  // once to each of them — in a mode whose whole point is one team total.
  //
  // It does not close the race, only the common case: two players who finish
  // within the same LOOT_TIME still both collect, because nothing claims a
  // chest until it is already open. That wants an authority, and the creatures
  // want one first.
  if (state.looting?.chest === c) {
    cancelLoot();
    showMsg(`${nameOf(by)} got there first`);
  }

  // The contents are not sent because they do not need to be: the same seed
  // dealt the same item into the same chest on every client. What differs is
  // who gets it.
  //
  // Gold and the pack items belong to the player who opened it — they took the
  // risk of standing still. Two things do not: the key and the map. There is one
  // portal, so one key opens it for everyone; and a map that only one player
  // could read would mean two people in the same corridor disagreeing about
  // whether they know where they are.
  // A trapped chest is a trap going off, and a trap is heard much further than
  // a creaking lid. The damage stays with whoever opened it — that was resolved
  // on their machine — but the noise belongs to the dungeon.
  if (c.trapped) {
    alertCreatures(TRAP_ALERT_RADIUS, TRAP_ALERT_TIME, c.mesh.position.x, c.mesh.position.z);
    sfxTrap();
  }

  const who = nameOf(by);
  if (c.item === 'key') {
    state.hasKey = true;
    setPortalOpen(true);
    showMsg(`${who} found the key — the portal will open`);
  } else if (c.item === 'map') {
    state.hasMap = true;
    minimapEl.style.display = 'block';
    objectiveEl.style.opacity = '0';
    showMsg(`${who} found the map`);
  }
  updateHUD();
});
