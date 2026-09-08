import {
  CELL, GUARD_KEY, LANTERN_KEY, LUNGE_DMG, POTION_KEY, TUTORIAL_DODGES, TUTORIAL_MOVE_DIST,
  TUTORIAL_POTION_HP, TUTORIAL_ROOM,
} from './config';
import { el } from './dom';
import { state } from './state';
import type { Monster } from './types';
import { objectiveEl, showMsg, updateHUD } from './ui';
import { buildWorld, placeChest, spawnAt } from './world';

/**
 * The lesson: one open room, one thing at a time.
 *
 * It runs *on top of* the ordinary game rather than beside it. The room is
 * built by buildWorld() with `state.tutorial` set, the zombies are real ones,
 * the sword and the shield and the potion do exactly what they do on stage 1.
 * All this module adds is the order — a zombie is brought in when its lesson
 * comes, and the banner says what to do to it — and the checks that decide a
 * lesson is learned. That is what makes it worth having: a tutorial that
 * simulated the fight would teach a fight that does not exist.
 *
 * Nothing in here touches `progress`. Walking out of the room builds stage 1
 * from whatever the save already held.
 */

/** Saved apart from progress, so a new game does not forget it was seen. */
const PREF_KEY = 'dungeon.tutorial.v1';

interface Pref {
  /** Never show it on its own again; the menu can still start it. */
  skip: boolean;
  /** It has been started at least once, so the first visit is over. */
  seen: boolean;
}

function loadPref(): Pref {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const o: unknown = JSON.parse(raw);
      if (o && typeof o === 'object') {
        const p = o as Partial<Pref>;
        return { skip: !!p.skip, seen: !!p.seen };
      }
    }
  } catch {
    // No storage: shown every time, which is the only safe default.
  }
  return { skip: false, seen: false };
}

function savePref(p: Pref): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Not remembered; still honoured for this visit.
  }
}

export const tutorialPref = loadPref();

export function setSkipTutorial(skip: boolean): void {
  tutorialPref.skip = skip;
  savePref(tutorialPref);
}

/** Whether a fresh start should open on the lesson rather than stage 1. */
export function wantsTutorial(): boolean {
  return !tutorialPref.skip;
}

const bannerEl = el('tutor');
const textEl = el('tutorText');
const skipBtn = el('tutorSkip');

/** Buttons rather than keys, on a screen that has no keys. */
const touch = matchMedia('(pointer: coarse)').matches;

/**
 * One lesson. `enter` sets it up; `done` is polled every frame. The zombie a
 * lesson brings in is remembered so its death can be waited on.
 */
interface Lesson {
  text: string;
  enter?: () => void;
  done: () => boolean;
  /**
   * Brings another zombie in when the last one died without the lesson being
   * learned — killed with the sword in the musket lesson, or cut down before
   * it ever swung in the parry lesson. Without it the room is empty and the
   * lesson can never end.
   */
  refill?: () => void;
}

/** Where a lesson's zombie stands up: across the room from the door. */
function zombieAt(cx: number, cz: number): Monster {
  const m = spawnAt('zombie', cx * CELL, cz * CELL);
  m.mesh.rotation.y = Math.atan2(state.pos.x - m.mesh.position.x, state.pos.z - m.mesh.position.z);
  return m;
}

const dead = (m: Monster | null): boolean => m !== null && m.hp <= 0;

let current: Monster | null = null;
let step = 0;
let walked = 0;
let lastX = 0, lastZ = 0;
let dodges = 0;
let wasDodging = false;
let wasLungeHit = false;
let lunged = false;
let parried = false;
let staggerSeen = false;

const far = TUTORIAL_ROOM - 2;

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

const LESSONS: Lesson[] = [
  {
    text: touch
      ? 'Move with the stick on the left. Drag anywhere else to look around.'
      : 'Move with W A S D and look with the mouse. Click the game once to lock the cursor.',
    enter: () => {
      walked = 0;
      lastX = state.pos.x;
      lastZ = state.pos.z;
    },
    done: () => walked >= TUTORIAL_MOVE_DIST,
  },
  {
    text: touch
      ? 'A zombie. Tap the red button to swing the sword until it drops.'
      : 'A zombie. Swing the sword — click, or Space — until it drops.',
    enter: () => {
      current = zombieAt(far, far);
    },
    done: () => dead(current),
  },
  {
    text: touch
      ? 'Another, further off. Tap Swap for the musket and the red button to fire. It reloads on its own.'
      : 'Another, further off. Q draws the musket; click to fire. It reloads on its own — Q again for the sword.',
    enter: () => {
      current = zombieAt(far, 1);
    },
    done: () => dead(current),
  },
  {
    text: touch
      ? `Dodge — the blue button — throws you the way you are moving. Do it ${TUTORIAL_DODGES === 2 ? 'twice' : `${TUTORIAL_DODGES} times`}. It is how you leave a creature's reach, and the only way through one.`
      : `Shift dodges the way you are moving. Do it ${TUTORIAL_DODGES === 2 ? 'twice' : `${TUTORIAL_DODGES} times`}. It is how you leave a creature's reach, and the only way through one.`,
    enter: () => {
      dodges = 0;
      wasDodging = false;
    },
    done: () => dodges >= TUTORIAL_DODGES,
  },
  {
    text: `Dodge forward and the blade lights up. Swing while it is lit for ${LUNGE_DMG}x — kill this one with a lunge.`,
    enter: () => {
      current = zombieAt(1, far);
      wasLungeHit = false;
      lunged = false;
    },
    done: () => lunged && dead(current),
    refill: () => {
      current = zombieAt(1, far);
    },
  },
  {
    text: touch
      ? 'Hold Guard as its blow lands and it staggers — that is a parry. Parry it once, then finish it.'
      : `Hold the guard — right mouse, or ${GUARD_KEY} — as its blow lands and it staggers. That is a parry. Parry it once, then finish it.`,
    enter: () => {
      current = zombieAt(far, far);
      parried = false;
      staggerSeen = false;
    },
    done: () => parried && dead(current),
    refill: () => {
      current = zombieAt(far, far);
      staggerSeen = false;
    },
  },
  {
    text: touch
      ? 'You are hurt. Tap the potion — it takes a moment to go down, and you are slow while it does.'
      : `You are hurt. Press ${POTION_KEY} to drink — it takes a moment to go down, and you are slow while it does.`,
    enter: () => {
      state.hp = TUTORIAL_POTION_HP;
      updateHUD();
    },
    done: () => state.potions === 0 && state.drinkT < 0,
  },
  {
    text: touch
      ? 'Tap the lantern. It reaches further than the torch and burns for two and a half minutes.'
      : `Press ${LANTERN_KEY} to light the lantern. It reaches further than the torch and burns for two and a half minutes.`,
    done: () => state.lanternT > 0,
  },
  {
    text: touch
      ? 'A chest, and the key is in it. Stand beside it and hold Open — walk away and the lid stays shut. Every lid creaks, and things hear it.'
      : 'A chest, and the key is in it. Stand beside it and hold E — walk away and the lid stays shut. Every lid creaks, and things hear it.',
    enter: () => {
      const mid = ((TUTORIAL_ROOM - 1) / 2) * CELL;
      placeChest(mid, mid, 'key', false);
    },
    done: () => state.hasKey,
  },
  {
    text: 'That is all of it. The portal is open — walk in for stage 1.',
    done: () => false,
  },
];

function show(i: number): void {
  step = i;
  state.tutorialStep = i;
  const l = LESSONS[i];
  textEl.textContent = l.text;
  l.enter?.();
}

/** Builds the room and starts at the first lesson. */
export function startTutorial(): void {
  if (!tutorialPref.seen) {
    tutorialPref.seen = true;
    savePref(tutorialPref);
  }
  state.tutorial = true;
  current = null;
  buildWorld();
  // The room has no key and no map, so the objective panel would only say so.
  objectiveEl.style.opacity = '0';
  bannerEl.style.display = 'flex';
  show(0);
}

/**
 * Leaves the room for stage 1 — by finishing or by skipping, the same door.
 * Everything the lesson handed out goes with it: the kit for stage 1 is the
 * save's, as it always was.
 */
export function endTutorial(): void {
  if (!state.tutorial) return;
  leaveTutorial();
  buildWorld();
}

/**
 * Drops the lesson without building anything, for callers about to build a
 * world of their own — the host's start, which would otherwise build the
 * party's dungeon as a practice room.
 */
export function leaveTutorial(): void {
  state.tutorial = false;
  current = null;
  bannerEl.style.display = 'none';
}

/** Polled every live frame by the loop while the room is up. */
export function updateTutorial(): void {
  if (!state.tutorial) return;

  // Movement is measured, not asked about: the lesson ends when the player has
  // walked, wherever they walked to.
  walked += Math.hypot(state.pos.x - lastX, state.pos.z - lastZ);
  lastX = state.pos.x;
  lastZ = state.pos.z;

  // Edges rather than levels, so one long dodge or one long stagger counts once.
  const dodging = state.dashT >= 0;
  if (dodging && !wasDodging) dodges++;
  wasDodging = dodging;

  const lungeHit = state.lungeHitT > 0;
  if (lungeHit && !wasLungeHit && step === 4) {
    lunged = true;
    showMsg('That is a lunge');
  }
  wasLungeHit = lungeHit;

  // A stagger only ever comes from a parry, so the zombie rocking back is the
  // parry having happened — and it is the zombie that is checked, not the
  // shield, because the shield going up on its own is what a parry is not.
  if (current && current.staggerT > 0 && !staggerSeen) {
    staggerSeen = true;
    parried = true;
    if (step === 5) showMsg('Parried — now it is open');
  }
  if (current && current.staggerT <= 0) staggerSeen = false;

  const lesson = LESSONS[step];
  if (lesson.done()) {
    show(step + 1);
    return;
  }
  // The zombie is gone and the lesson is not: somebody killed it the wrong
  // way, or the right way before the lesson could see it. Another comes in.
  if (lesson.refill && dead(current)) {
    lesson.refill();
    showMsg('Another one — try it on this');
  }
}

skipBtn.addEventListener('click', endTutorial);
// A tap on the button must not also be a tap on the game behind it.
skipBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  endTutorial();
}, { passive: false });
