import { state } from './state';
import { showMsg } from './ui';

/**
 * What the tutorial has unlocked so far, for the things it unlocks.
 *
 * Its own module, apart from tutorial.ts, because of who asks. loot.ts,
 * weapons.ts and input.ts all check it, and ui.ts imports loot.ts; when this
 * lived in tutorial.ts that edge dragged tutorial → world → input → view into
 * ui.ts's evaluation, and input's and view's top-level button wiring ran while
 * ui.ts's exports were still uninitialised — a ReferenceError at load, with a
 * clean build. This needs only state and, at call time, showMsg.
 */
/**
 * The lessons by index, for the things they unlock. Kept in step with the
 * list below by hand; the order is the lesson.
 */
export const STEP = { move: 0, sword: 1, musket: 2, dodge: 3, lunge: 4, parry: 5, potion: 6, lantern: 7, chest: 8, done: 9 } as const;

/**
 * Whether a thing a lesson teaches may be used yet. Everything is allowed
 * outside the room; inside it, only what has been taught — a potion drunk
 * before the potion lesson is a potion the lesson cannot then ask for.
 */
export function taught(step: number): boolean {
  if (!state.tutorial || state.tutorialStep >= step) return true;
  showMsg('Not yet — that comes later in the lesson');
  return false;
}
