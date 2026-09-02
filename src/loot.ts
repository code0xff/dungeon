import { sfxCreak, sfxPickup } from './audio';
import { AMMO_PICKUP, FOG_TORCH, MUSKET_AMMO } from './config';
import { fog, torch } from './scene';
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
    case 'torch':
      state.hasTorch = true;
      torch.distance = 19;
      state.torchBase = 2.7;
      fog.density = FOG_TORCH;
      msg += '\n🔥 Torch — you can see further';
      break;
    case 'map':
      state.hasMap = true;
      minimapEl.style.display = 'block';
      objectiveEl.style.opacity = '0';
      msg += '\n🗺 Map — the dungeon layout is revealed';
      break;
    case 'potion':
      state.hp = Math.min(100, state.hp + 35);
      msg += '\n🧪 Potion +35 HP';
      break;
    case 'musket':
      state.hasMusket = true;
      state.ammo += MUSKET_AMMO;
      state.loaded = true;
      wpnBtn.classList.add('show');
      setWeapon('musket');
      msg += `\n🔫 Musket (${MUSKET_AMMO + 1} shots) — press Q to swap. The noise draws creatures`;
      break;
    case 'ammo':
      state.ammo += AMMO_PICKUP;
      msg += `\n🔫 Ammo +${AMMO_PICKUP}`;
      // Start reloading right away if the musket was held empty.
      if (!state.loaded && state.reloadT < 0 && state.weapon === 'musket') startReload();
      break;
  }

  if (c.item) sfxPickup();
  updateHUD();
  showMsg(msg);
}
