import { sfxCreak, sfxPickup } from './audio';
import { alertCreatures, springTrap } from './combat';
import {
  AMMO_PICKUP, CHEST_ALERT_RADIUS, CHEST_ALERT_TIME, LANTERN_FUEL, LANTERN_KEY, MAX_HP,
  MUSKET_AMMO, POTION_HEAL, POTION_KEY, SWORD_DUR_MAX, WHETSTONE_KEY, WHETSTONE_REPAIR,
} from './config';
import { setLampLit, setPortalOpen } from './scene';
import { state } from './state';
import type { Chest } from './types';
import { drinkBarEl, drinkFillEl, lootBarEl, minimapEl, objectiveEl, showMsg, updateHUD, wpnBtn } from './ui';
import { setWeapon, startReload } from './weapons';

export function startLoot(): void {
  if (state.gameOver || !state.nearChest || state.looting) return;
  state.looting = { chest: state.nearChest, t: 0 };
  lootBarEl.style.display = 'block';
  sfxCreak();

  // Charged when the lid creaks, not when it finishes opening.
  //
  // The sound plays here and the alert used to fire LOOT_TIME later, so what the
  // player heard and what the dungeon heard were a second apart — and since
  // moving cancels looting, the whole cost landed after the risk was already
  // taken. Alerting on the creak is what makes the LOOT_TIME bar mean something:
  // they are already coming, and you have to stand still anyway.
  //
  // Starting and cancelling still wakes them. That is the point — the noise was
  // made.
  const heard = alertCreatures(CHEST_ALERT_RADIUS, CHEST_ALERT_TIME);
  if (heard > 0) showMsg(`The lid creaks... ${heard} heard it`);
}

export function openChest(c: Chest): void {
  c.state = 'opened';
  c.openT = 0;
  // Fired on the lid coming open rather than on the creak, so backing out of a
  // loot you started still avoids it. That is what makes the tell on the lid
  // worth reading: seeing it is only useful if there is still a choice left.
  const trapLine = c.trapped ? springTrap() : null;
  // A trap can be what kills you. Banking the gold and announcing the contents
  // over the death screen would be answering a question nobody is asking.
  if (state.gameOver) return;
  state.runGold += c.value;
  let msg = `+${c.value} G`;

  switch (c.item) {
    case 'key':
      state.hasKey = true;
      setPortalOpen(true);
      msg += '\nThe key — the portal will open now';
      break;
    case 'lantern':
      // Into the pack, not lit. Choosing when to burn one is the point: light
      // costs nothing to carry and everything to waste.
      state.lanterns++;
      msg += `\nLantern — press ${LANTERN_KEY} to light it`;
      break;
    case 'map':
      state.hasMap = true;
      minimapEl.style.display = 'block';
      objectiveEl.style.opacity = '0';
      msg += '\nMap — the dungeon layout is revealed';
      break;
    case 'potion':
      state.potions++;
      msg += `\nPotion — press ${POTION_KEY} to drink it`;
      break;
    case 'whetstone':
      state.whetstones++;
      msg += `\nWhetstone — press ${WHETSTONE_KEY} to grind the blade back`;
      break;
    case 'musket':
      state.hasMusket = true;
      state.ammo += MUSKET_AMMO;
      state.loaded = true;
      wpnBtn.classList.add('show');
      setWeapon('musket');
      msg += `\nMusket (${MUSKET_AMMO + 1} shots) — press Q to swap. The noise draws creatures`;
      break;
    case 'ammo':
      state.ammo += AMMO_PICKUP;
      msg += `\nAmmo +${AMMO_PICKUP}`;
      // Start reloading right away if the musket was held empty.
      if (!state.loaded && state.reloadT < 0 && state.weapon === 'musket') startReload();
      break;
  }

  if (c.item) sfxPickup();
  if (trapLine) msg += `\n${trapLine}`;

  updateHUD();
  showMsg(msg);
}

/**
 * Slot items are spent by hand rather than on pickup, so both of these refuse
 * rather than waste. Being told "already at full health" is better than losing
 * the potion that would have saved the next fight.
 */
export function usePotion(): void {
  if (state.gameOver) return;
  if (state.drinkT >= 0) return;
  if (state.potions <= 0) return showMsg('No potions');
  if (state.hp >= MAX_HP) return showMsg('Already at full health');
  // Spent at the first sip, not the last. Otherwise the key could be held down
  // and the same potion would heal every frame it was still going down.
  state.potions--;
  state.drinkT = 0;
  drinkBarEl.style.display = 'block';
  sfxPickup();
  updateHUD();
}

/** The health lands here, POTION_DRINK later. loop.ts calls this. */
export function finishDrink(): void {
  state.drinkT = -1;
  drinkBarEl.style.display = 'none';
  drinkFillEl.style.width = '0%';
  if (state.gameOver) return;
  const healed = Math.min(MAX_HP, state.hp + POTION_HEAL) - state.hp;
  state.hp += healed;
  updateHUD();
  showMsg(`Potion +${Math.round(healed)} HP`);
}

/**
 * Repairs where the sword was worn out, which the shop cannot do.
 *
 * It refuses at full durability like the potion refuses at full health, and for
 * the same reason: a stone spent on a blade that did not need it is the whole
 * rest of the run fought blunt.
 */
export function useWhetstone(): void {
  if (state.gameOver) return;
  if (state.whetstones <= 0) return showMsg('No whetstones');
  if (state.swordDur >= SWORD_DUR_MAX) return showMsg('The blade is already keen');
  state.whetstones--;
  state.swordDur = Math.min(SWORD_DUR_MAX, state.swordDur + WHETSTONE_REPAIR);
  // So the "going blunt" warning can fire again if it wears down a second time.
  state.swordWarned = false;
  sfxPickup();
  updateHUD();
  showMsg(`Blade sharpened — ${Math.round((state.swordDur / SWORD_DUR_MAX) * 100)}%`);
}

export function useLantern(): void {
  if (state.gameOver) return;
  if (state.lanterns <= 0) return showMsg('No lanterns');
  if (state.lanternT >= LANTERN_FUEL) return showMsg('The lantern is already full');
  state.lanterns--;
  // Topping up rather than replacing, so lighting one early is not a waste.
  state.lanternT = Math.min(LANTERN_FUEL, state.lanternT + LANTERN_FUEL);
  state.lanternWarned = false;
  state.lightBase = setLampLit(true);
  sfxPickup();
  updateHUD();
  showMsg(`Lantern lit — ${Math.round(LANTERN_FUEL / 60)} minutes of fuel`);
}
