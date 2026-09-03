import { LANTERN_FUEL, MAX_HP, START_AMMO, SWORD_DUR_MAX } from './config';

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
  /** Sword durability carried out. A new run after death gets a fresh blade. */
  swordDur: number;
}

const KEY = 'dungeon.progress.v1';

function fresh(): Progress {
  return {
    stage: 1, bankGold: 0, hp: MAX_HP, lanternT: 0, ammo: START_AMMO,
    potions: 0, lanterns: 0, swordDur: SWORD_DUR_MAX,
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
  if (typeof o.swordDur === 'number' && Number.isFinite(o.swordDur)) {
    progress.swordDur = Math.min(SWORD_DUR_MAX, Math.max(0, o.swordDur));
  }
}

/**
 * localStorage throws outright in some privacy modes rather than returning null,
 * so both directions are guarded. Losing a save is a shame; refusing to start
 * the game over it is worse.
 */
export function loadProgress(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage: keep the defaults.
  }
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
    potions: number; lanterns: number; swordDur: number;
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
  progress.swordDur = gear.swordDur;
  saveProgress();
}

/** Death: the run's gold and everything carried is gone. The bank is not. */
export function loseRun(): void {
  const { bankGold } = progress;
  Object.assign(progress, fresh(), { bankGold });
  saveProgress();
}
