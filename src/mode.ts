import { el } from './dom';
import { setHard } from './progress';
import { state } from './state';

/**
 * The one question asked before stage 1: normal or hard.
 *
 * A panel, not a menu item, because the answer is for the life of the save —
 * the chests, the shop and the pack are all different — and a mode that could
 * be switched at stage 6 would be switched to whichever was easier at stage 6.
 * It opens after the tutorial, or straight away when the tutorial is skipped,
 * and on New game; nothing else can open it and nothing dismisses it but an
 * answer.
 */
const panelEl = el('modePick');
let then: (() => void) | null = null;

function choose(hard: boolean): void {
  setHard(hard);
  panelEl.style.display = 'none';
  state.uiOpen = false;
  const go = then;
  then = null;
  go?.();
}

/** Shows the panel; `next` runs once a mode is chosen. */
export function pickMode(next: () => void): void {
  then = next;
  panelEl.style.display = 'flex';
  // Input is off while it is up: the world behind it is whatever was there
  // last, and a click meant for the button must not also be a swing.
  state.uiOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
}

el('modeNormal').addEventListener('click', () => choose(false));
el('modeHard').addEventListener('click', () => choose(true));
