import { musket, sword } from './scene';
import { state } from './state';
import type { WeaponKind } from './types';
import { crosshairEl, reloadBarEl, showMsg, updateHUD } from './ui';

export function setWeapon(w: WeaponKind): void {
  state.weapon = w;
  sword.visible = w === 'sword';
  musket.visible = w === 'musket';
  crosshairEl.style.display = w === 'musket' ? 'block' : 'none';
  // Switching to the sword aborts a reload in progress.
  if (w !== 'musket') {
    state.reloadT = -1;
    reloadBarEl.style.display = 'none';
  }
  updateHUD();
}

export function toggleWeapon(): void {
  if (state.gameOver) return;
  if (!state.hasMusket) {
    showMsg('No musket — search the chests');
    return;
  }
  setWeapon(state.weapon === 'sword' ? 'musket' : 'sword');
  showMsg(state.weapon === 'musket' ? 'Musket' : 'Sword');
}

/** Ignored when already loaded, mid-reload, or out of ammo. */
export function startReload(): void {
  if (state.loaded || state.reloadT >= 0 || state.ammo <= 0) return;
  state.reloadT = 0;
  reloadBarEl.style.display = 'block';
  reloadBarEl.dataset.step = '0';
}
