import { sfxCreak, sfxPickup } from './audio';
import {
  AMMO_PICKUP, LANTERN_FUEL, LANTERN_KEY, MAX_HP, MUSKET_AMMO, POTION_HEAL, POTION_KEY,
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
