import { sfxCreak, sfxPickup } from './audio';
import { AMMO_PICKUP, LANTERN_FUEL, MUSKET_AMMO } from './config';
import { setLampLit } from './scene';
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
    case 'lantern':
      // Topping up rather than replacing, so a second lantern in a run is worth
      // finding even while the first is still burning.
      state.lanternT = Math.min(LANTERN_FUEL, state.lanternT + LANTERN_FUEL);
      state.lanternWarned = false;
      state.lightBase = setLampLit(true);
      msg += `\nLantern lit — ${Math.round(LANTERN_FUEL / 60)} minutes of fuel`;
      break;
    case 'map':
      state.hasMap = true;
      minimapEl.style.display = 'block';
      objectiveEl.style.opacity = '0';
      msg += '\nMap — the dungeon layout is revealed';
      break;
    case 'potion':
      state.hp = Math.min(100, state.hp + 35);
      msg += '\nPotion +35 HP';
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
