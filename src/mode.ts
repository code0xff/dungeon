import { initAudio } from './audio';
import { el } from './dom';
import { lockFromClick } from './input';
import { setHard } from './progress';
import { state } from './state';

/**
 * The one question asked before stage 1: normal or hard.
 *
 * A panel, not a menu item, because the answer is for the life of the save —
 * the chests, the shop and the pack are all different — and a mode that could
 * be switched at stage 6 would be switched to whichever was easier at stage 6.
 * It opens on New game — from the title screen or the menu — and after a first
 * tutorial; nothing else can open it and nothing dismisses it but an answer.
 */
const panelEl = el('modePick');
let then: (() => void) | null = null;

function choose(hard: boolean): void {
  setHard(hard);
  panelEl.style.display = 'none';
  state.uiOpen = false;
  state.paused = false;
  // The click that chose is the one that starts the game: sound and the cursor
  // both need a user gesture, and this is it.
  initAudio();
  lockFromClick();
  const go = then;
  then = null;
  go?.();
}

/** Shows the panel; `next` runs once a mode is chosen. */
export function pickMode(next: () => void): void {
  then = next;
  panelEl.style.display = 'flex';
  // Input is off and the world is held while it is up: what is behind it is
  // whatever was there last, a click meant for the button must not also be a
  // swing, and a zombie must not walk up while the player reads.
  state.uiOpen = true;
  state.paused = true;
  if (document.pointerLockElement) document.exitPointerLock();
}

el('modeNormal').addEventListener('click', () => choose(false));
el('modeHard').addEventListener('click', () => choose(true));
