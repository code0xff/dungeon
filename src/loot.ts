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
      msg += '\n🔥 횃불 획득 — 시야가 넓어진다';
      break;
    case 'map':
      state.hasMap = true;
      minimapEl.style.display = 'block';
      objectiveEl.style.opacity = '0';
      msg += '\n🗺 지도 획득 — 던전 구조가 드러난다';
      break;
    case 'potion':
      state.hp = Math.min(100, state.hp + 35);
      msg += '\n🧪 물약 +35 HP';
      break;
    case 'musket':
      state.hasMusket = true;
      state.ammo += MUSKET_AMMO;
      state.loaded = true;
      wpnBtn.classList.add('show');
      setWeapon('musket');
      msg += `\n🔫 머스킷 획득 (${MUSKET_AMMO + 1}발) — Q로 전환. 총성은 크리처를 부른다`;
      break;
    case 'ammo':
      state.ammo += AMMO_PICKUP;
      msg += `\n🔫 탄약 +${AMMO_PICKUP}`;
      // 빈 총을 들고 있었으면 바로 장전을 시작한다.
      if (!state.loaded && state.reloadT < 0 && state.weapon === 'musket') startReload();
      break;
  }

  if (c.item) sfxPickup();
  updateHUD();
  showMsg(msg);
}
