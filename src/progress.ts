import { LANTERN_FUEL, MAX_HP, START_AMMO, SWORD_DUR_MAX } from './config';
import { randomSeed } from './rng';

/**
 * What survives a run, saved to localStorage.
 *
 * `src/state.ts` holds the current run and is rebuilt from scratch by
 * buildWorld(). This is the other half: extraction banks the gold and carries
 * the gear into the next stage, dying loses both and drops back to stage 1.
 * Only `bankGold` is permanent — it is the score the whole loop is built around.
 */
export interface Progress {
  /** 1-based. Counts consecutive successful extractions. */
  stage: number;
  /** Permanent. Survives death. */
  bankGold: number;
  // Carried out of the last run, wiped on death.
  //
  // There is deliberately no map here: a map charts *this* dungeon, and the next
  // stage generates a new one, so carrying it would hand the player a plan of a
  // maze they are not standing in.

  /** Health carried forward. Extract wounded and the next stage starts wounded. */
  hp: number;
  /** Seconds of lantern fuel left. */
  lanternT: number;
  ammo: number;
  /** Unspent slot items. Walking out with a full pack is part of the reward. */
  potions: number;
  lanterns: number;
  whetstones: number;
  wards: number;
  /** Sword durability carried out. A new run after death gets a fresh blade. */
  swordDur: number;
  /**
   * The seed every dungeon in this run is generated from, combined with the
   * stage. Saved with the rest so a reload continues the same run rather than
   * quietly regenerating the dungeon underneath the player.
   */
  seed: number;
  /**
   * Hard mode: one chest and it holds the key, no map, no potions, lanterns
   * or whetstones anywhere, and a shop of wounds, blade and musket balls at
   * HARD_PRICE. Chosen once, before stage 1; a save is one mode for its life.
   */
  hard: boolean;
}

const KEY = 'dungeon.progress.v1';

function fresh(): Progress {
  return {
    stage: 1, bankGold: 0, hp: MAX_HP, lanternT: 0, ammo: START_AMMO,
    potions: 0, lanterns: 0, whetstones: 0, wards: 0, swordDur: SWORD_DUR_MAX,
    // Drawn here rather than at the first buildWorld() so that death and New
    // game — the two callers of fresh() — are exactly what changes the dungeon.
    seed: randomSeed(),
    hard: false,
  };
}

export const progress: Progress = fresh();

/**
 * Reading a stored field only when it has the right type means a corrupt or
 * half-written save degrades to the default rather than poisoning the run with
 * NaN gold or an undefined ammo count.
 */
function merge(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return;
  const o = raw as Record<string, unknown>;
  if (typeof o.stage === 'number' && Number.isFinite(o.stage)) progress.stage = Math.max(1, o.stage | 0);
  if (typeof o.bankGold === 'number' && Number.isFinite(o.bankGold)) progress.bankGold = Math.max(0, o.bankGold | 0);
  if (typeof o.hp === 'number' && Number.isFinite(o.hp)) progress.hp = Math.min(MAX_HP, Math.max(1, o.hp | 0));
  if (typeof o.lanternT === 'number' && Number.isFinite(o.lanternT)) {
    progress.lanternT = Math.min(LANTERN_FUEL, Math.max(0, o.lanternT));
  }
  if (typeof o.ammo === 'number' && Number.isFinite(o.ammo)) progress.ammo = Math.max(0, o.ammo | 0);
  if (typeof o.potions === 'number' && Number.isFinite(o.potions)) progress.potions = Math.max(0, o.potions | 0);
  if (typeof o.lanterns === 'number' && Number.isFinite(o.lanterns)) progress.lanterns = Math.max(0, o.lanterns | 0);
  if (typeof o.whetstones === 'number' && Number.isFinite(o.whetstones)) {
    progress.whetstones = Math.max(0, o.whetstones | 0);
  }
  if (typeof o.wards === 'number' && Number.isFinite(o.wards)) progress.wards = Math.max(0, o.wards | 0);
  if (typeof o.swordDur === 'number' && Number.isFinite(o.swordDur)) {
    progress.swordDur = Math.min(SWORD_DUR_MAX, Math.max(0, o.swordDur));
  }
  if (typeof o.hard === 'boolean') progress.hard = o.hard;
  // A save written before seeds existed has none, and keeping the one fresh()
  // already drew is the right answer: that run gets a seed from here on.
  if (typeof o.seed === 'number' && Number.isFinite(o.seed)) progress.seed = o.seed >>> 0;
}

/**
 * localStorage throws outright in some privacy modes rather than returning null,
 * so both directions are guarded. Losing a save is a shame; refusing to start
 * the game over it is worse.
 */
export function loadProgress(): void {
  try {
    const raw = localStorage.getItem(KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (stored) merge(stored);
    // A fresh install, or a save written before seeds existed, is carrying the
    // seed fresh() just drew and nothing on disk. Written now rather than at the
    // first extraction, because a reload before then would draw another one —
    // and reloading into a different dungeon is the thing the seed exists to
    // prevent.
    const hadSeed = typeof (stored as { seed?: unknown } | null)?.seed === 'number';
    if (!hadSeed) saveProgress();
  } catch {
    // Corrupt or unavailable storage: keep the defaults.
  }
}

/**
 * Overrides the run seed — the `?seed=` URL parameter, and later whatever a
 * multiplayer host sends. Not saved on its own: it takes effect on the next
 * buildWorld() and is written out with the rest at the next extraction, so a
 * link handed to someone else does not silently overwrite the run they are in
 * the middle of until they actually finish a stage.
 */
export function setRunSeed(seed: number): void {
  progress.seed = seed >>> 0;
}

/** The mode for this save. Picked before stage 1 and never again until New game. */
export function setHard(hard: boolean): void {
  progress.hard = hard;
  saveProgress();
}

export function saveProgress(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable. The run still works, it just will not be remembered.
  }
}

/** Extraction: bank the run, keep the gear, move to the next stage. */
export function bankRun(
  runGold: number,
  gear: {
    hp: number; lanternT: number; ammo: number;
    potions: number; lanterns: number; whetstones: number; wards: number; swordDur: number;
  },
): void {
  progress.bankGold += runGold;
  progress.stage += 1;
  // Health is carried as-is. Walking out on 12 HP means walking in on 12 HP,
  // which is what makes stopping at the portal a decision.
  progress.hp = Math.max(1, Math.round(gear.hp));
  progress.lanternT = Math.max(0, gear.lanternT);
  progress.ammo = gear.ammo;
  progress.potions = gear.potions;
  progress.lanterns = gear.lanterns;
  progress.whetstones = gear.whetstones;
  progress.wards = gear.wards;
  progress.swordDur = gear.swordDur;
  saveProgress();
}

/**
 * New game: everything, bank included.
 *
 * The same wipe as a death, chosen instead of suffered — which is why the menu
 * asks before calling it and names the number it is about to destroy.
 */
export function resetProgress(): void {
  Object.assign(progress, fresh());
  saveProgress();
}

/**
 * Death: everything is gone — the run, the gear, and the bank with it.
 *
 * The bank used to survive, and the shop opened over the death screen to spend
 * it on a fresh stage 1. In practice that was gold with nothing worth buying:
 * stage 1 does not need a kit, and outfitting for it only delayed the run that
 * was actually going to matter. Now a death is a clean start, and the bank is
 * a number you keep by staying alive — which is what makes it worth extracting
 * with, and what puts the ending's score in reach of one life only.
 */
export function loseRun(): void {
  Object.assign(progress, fresh());
  saveProgress();
}
