import { GUIDE_KEY } from './config';
import { el } from './dom';
import { closeGuidePanel, openGuidePanel } from './guide';
import { progress, resetProgress } from './progress';
import { closeShop } from './shop';
import { state } from './state';
import { guideBtn, guideCloseBtn, overlayEl } from './ui';
import { buildWorld } from './world';

/**
 * The pause menu, on GUIDE_KEY.
 *
 * That key used to open the control list directly, which made the only thing
 * you could reach mid-run a reference card — there was no way to abandon a run
 * and start over short of clearing the browser's storage. The controls are now
 * one entry inside this rather than the whole of it.
 *
 * It owns `state.paused` and the panel stack. The guide is a child screen: its
 * Back returns here rather than to the game, so there is one way out and it is
 * always the same key.
 *
 * This module registers its own key and touch handlers instead of being driven
 * from input.ts. input.ts is imported by world.ts, and this needs buildWorld()
 * for New game — going through input.ts would have made that a cycle.
 */
const menuEl = el('menu');
const statusEl = el('menuStatus');
const resumeBtn = el('menuResume');
const guideItem = el('menuGuide');
const newBtn = el('menuNew');

/** Whether New game has been clicked once and is waiting for confirmation. */
let armed = false;
let guideOpen = false;

function disarm(): void {
  armed = false;
  newBtn.classList.remove('arm');
  newBtn.textContent = 'New game';
}

export function isMenuOpen(): boolean {
  return menuEl.style.display === 'flex' || guideOpen;
}

export function openMenu(): void {
  disarm();
  guideOpen = false;
  closeGuidePanel();
  // Not while the end-of-run overlay is up: the loop is already stopped there,
  // and pausing on top of it would leave `paused` set when the next run starts.
  if (!state.gameOver) state.paused = true;
  // Reading needs the cursor back; the click that re-locks it is harmless.
  if (document.pointerLockElement) document.exitPointerLock();
  statusEl.textContent = `Stage ${progress.stage}  ·  Bank ${progress.bankGold} G`;
  menuEl.style.display = 'flex';
}

export function closeMenu(): void {
  disarm();
  guideOpen = false;
  closeGuidePanel();
  menuEl.style.display = 'none';
  state.paused = false;
}

export function toggleMenu(): void {
  if (isMenuOpen()) closeMenu();
  else openMenu();
}

/** Escape steps back one screen rather than dropping straight into the game. */
function back(): void {
  if (guideOpen) {
    guideOpen = false;
    closeGuidePanel();
    menuEl.style.display = 'flex';
    return;
  }
  closeMenu();
}

resumeBtn.addEventListener('click', closeMenu);

guideItem.addEventListener('click', () => {
  disarm();
  guideOpen = true;
  menuEl.style.display = 'none';
  openGuidePanel();
});

newBtn.addEventListener('click', () => {
  if (!armed) {
    armed = true;
    newBtn.classList.add('arm');
    // The bank is named because it is the only thing that survives death, so it
    // is the only thing this destroys that the player would miss.
    newBtn.textContent = `Erase ${progress.bankGold} G and start over?`;
    return;
  }
  resetProgress();
  closeShop();
  overlayEl.style.display = 'none';
  state.gameOver = false;
  closeMenu();
  buildWorld();
});

guideCloseBtn.addEventListener('click', back);
guideBtn.addEventListener('click', toggleMenu);

addEventListener('keydown', (e) => {
  // Auto-repeat would toggle the panel on every repeat, so holding the key made
  // the menu flicker open and shut and left the pause state wherever the release
  // happened to land.
  if (e.repeat) return;
  if (e.code === `Key${GUIDE_KEY}`) {
    toggleMenu();
    return;
  }
  if (e.code === 'Escape' && isMenuOpen()) back();
});
