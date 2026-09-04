import { sfxCreak, sfxPickup } from './audio';
import { alertCreatures } from './combat';
import {
  AMMO_PICKUP, CHEST_ALERT_RADIUS, CHEST_ALERT_TIME, LANTERN_FUEL, LANTERN_KEY, MAX_HP,
  MUSKET_AMMO, POTION_HEAL, POTION_KEY, SWORD_DUR_MAX, WHETSTONE_KEY, WHETSTONE_REPAIR,
} from './config';
import { setLampLit, setPortalOpen } from './scene';
import { state } from './state';
import type { Chest } from './types';
import { lootBarEl, minimapEl, objectiveEl, showMsg, updateHUD, wpnBtn } from './ui';
import { setWeapon, startReload } from './weapons';

export function startLoot(): void {
  if (state.gameOver || !state.nearChest || state.looting) return;
  state.looting = { chest: state.nearChest, t: 0 };
  lootBarEl.style.display = 'block';
  sfxCreak();
}

export function openChest(c: Chest): void {
  c.state = 'opened';
  c.openT = 0;
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

  // The lid carries, just not as far as a shot. Looting in the open is meant to
  // cost something rather than be free gold.
  const heard = alertCreatures(CHEST_ALERT_RADIUS, CHEST_ALERT_TIME);
  if (heard > 0) msg += `\nThe lid creaks... ${heard} heard it`;

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
  if (state.potions <= 0) return showMsg('No potions');
  if (state.hp >= MAX_HP) return showMsg('Already at full health');
  state.potions--;
  state.hp = Math.min(MAX_HP, state.hp + POTION_HEAL);
  sfxPickup();
  updateHUD();
  showMsg(`Potion +${POTION_HEAL} HP`);
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
