import {
  GUARD_KEY, GUIDE_KEY, LANTERN_KEY, LUNGE_DMG, POTION_KEY, SOUND_KEY, WHETSTONE_KEY,
} from './config';
import { el } from './dom';

/**
 * The controls panel — now a child screen of the menu rather than what
 * GUIDE_KEY opens directly. It shows and hides itself; `state.paused` and the
 * panel stack belong to menu.ts.
 *
 * It replaced a permanent strip of key hints across the bottom of the screen.
 * That strip had to stay short enough not to be clutter, which meant it could
 * never list everything — the pack keys and the dodge were missing from it — and
 * it was in the way for every hour after the first five minutes.
 *
 * Every key here is read from `config.ts` rather than written out, so a rebinding
 * cannot leave the guide telling the player something untrue.
 */
const guideEl = el('guide');
const listEl = el('guideList');

/** Label, then what to press. */
const KEYS: readonly (readonly [string, string])[] = [
  ['Move', 'W A S D'],
  ['Dodge', 'Shift'],
  ['Lunge', `Dodge forward and the blade lights up. Attack while it is lit for ${LUNGE_DMG}x damage — a sharp sword kills a zombie outright`],
  ['Look', 'Move the mouse — click to lock it, Esc to release'],
  ['Attack / fire', 'Click or Space'],
  ['Guard', `Hold the right mouse button, or ${GUARD_KEY}`],
  ['Parry', 'Raise the guard as the blow lands — no damage, and it opens the same window a lunge does'],
  ['Open chest', 'E'],
  ['Swap weapon', 'Q — or 1 for the sword, 2 for the musket'],
  ['Drink a potion', `${POTION_KEY} — takes a moment to go down`],
  ['Light a lantern', LANTERN_KEY],
  ['Sharpen the sword', WHETSTONE_KEY],
  ['This guide', GUIDE_KEY],
  ['Sound on / off', SOUND_KEY],
];

/** On a phone there are no keys, so the same actions are named by their control. */
const TOUCH: readonly (readonly [string, string])[] = [
  ['Move', 'The stick, bottom left'],
  ['Look', 'Drag anywhere on the right'],
  ['Attack / fire', 'The red button'],
  ['Dodge', 'The blue button beside it'],
  ['Guard / parry', 'Hold the shield button; tap it as the blow lands to parry'],
  ['Lunge', `Dodge with the stick pushed forward; attack while the button glows for ${LUNGE_DMG}x damage`],
  ['Open chest', 'Appears when you are near one'],
  ['Potion / lantern / whetstone', 'The small buttons above the swap, when you carry one'],
];

function rows(pairs: readonly (readonly [string, string])[], cls: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = cls;
  for (const [label, keys] of pairs) {
    const row = document.createElement('div');
    row.className = 'guideRow';
    const l = document.createElement('span');
    l.className = 'guideLabel';
    l.textContent = label;
    const k = document.createElement('span');
    k.className = 'guideKeys';
    k.textContent = keys;
    row.append(l, k);
    wrap.append(row);
  }
  return wrap;
}

listEl.append(rows(KEYS, 'guideKeyboard'), rows(TOUCH, 'guideTouch'));

// The objective panel points here, and takes the key from the same constant so
// the two can never disagree.
el('guideHint').textContent = GUIDE_KEY;

export function openGuidePanel(): void {
  guideEl.style.display = 'flex';
}

export function closeGuidePanel(): void {
  guideEl.style.display = 'none';
}
