import { START_AMMO } from './config';

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
  /** Gear carried out of the last run. Wiped on death. */
  hasTorch: boolean;
  hasMap: boolean;
  ammo: number;
}

const KEY = 'dungeon.progress.v1';

function fresh(): Progress {
  return { stage: 1, bankGold: 0, hasTorch: false, hasMap: false, ammo: START_AMMO };
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
  if (typeof o.hasTorch === 'boolean') progress.hasTorch = o.hasTorch;
  if (typeof o.hasMap === 'boolean') progress.hasMap = o.hasMap;
  if (typeof o.ammo === 'number' && Number.isFinite(o.ammo)) progress.ammo = Math.max(0, o.ammo | 0);
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
export function bankRun(runGold: number, gear: { hasTorch: boolean; hasMap: boolean; ammo: number }): void {
  progress.bankGold += runGold;
  progress.stage += 1;
  progress.hasTorch = gear.hasTorch;
  progress.hasMap = gear.hasMap;
  progress.ammo = gear.ammo;
  saveProgress();
}

/** Death: the run's gold and everything carried is gone. The bank is not. */
export function loseRun(): void {
  const { bankGold } = progress;
  Object.assign(progress, fresh(), { bankGold });
  saveProgress();
}
