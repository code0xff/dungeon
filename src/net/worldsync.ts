import { sfxCreak, sfxTrap } from '../audio';
import { alertCreatures } from '../combat';
import { CHEST_ALERT_RADIUS, CHEST_ALERT_TIME, TRAP_ALERT_RADIUS, TRAP_ALERT_TIME, TRAP_SPRING_TIME } from '../config';
import { setPortalOpen } from '../scene';
import { el } from '../dom';
import { state } from '../state';
import { cancelLoot, minimapEl, objectiveEl, overlayEl, showMsg, updateHUD } from '../ui';
import { net, onNetClaim, onNetEvent, onNetParty, sendClaim, sendEvent } from './client';
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
onNetClaim((i, to) => {
  if (to === net.id) return;
  if (state.looting?.chest !== state.chests[i]) return;
  cancelLoot();
  showMsg(`${nameOf(to)} is already opening that one`);
});

/**
 * The party's total, whenever somebody's run ends.
 *
 * Written into the end screen if this player is sitting on one, because that is
 * where the number belongs and they may well be reading it when an ally walks
 * out — a total that was true when the panel opened and silently wrong a minute
 * later is worse than no total.
 */
onNetParty((total, by, gold, out) => {
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
