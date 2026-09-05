import { MAX_HP, SWORD_DUR_MAX, COOP_KIT } from '../config';

/**
 * What the game knows about being in a co-op run, separate from both
 * `state` (this dungeon) and `progress` (the solo save).
 *
 * It is its own module for one reason: co-op must never write to progress.ts.
 * A player brings nothing in and takes nothing out, so the two have to be
 * unable to reach each other rather than merely not doing so today. Keeping the
 * level here instead of assigning it to `progress.stage` is what enforces that.
 */
export const coop = {
  /** True from the host's start until the player leaves co-op. */
  active: false,
  /** The level the host chose. Feeds every curve `progress.stage` feeds in solo. */
  level: 1,
  /** The seed the whole party generates its dungeon from. */
  seed: 0,
};

/**
 * The number the dungeon is built at: the host's level in co-op, the saved
 * stage in solo. Everything that scales with depth goes through this, so
 * neither mode has to know the other exists.
 */
export function runLevel(soloStage: number): number {
  return coop.active ? coop.level : soloStage;
}

/**
 * What a player walks into a co-op dungeon carrying.
 *
 * Solo reaches stage 8 through eight visits to the shop, spending the gold of
 * seven previous runs. Co-op has no shop and no bank, so the same dungeon on a
 * stage 1 kit is not a difficulty setting, it is a wall — and the party cannot
 * grind their way past it, because nothing carries between runs.
 *
 * The rates are in COOP_KIT rather than here so the whole ramp is one place in
 * config.ts, next to the spawn curve it is meant to keep pace with.
 */
export function coopKit(level: number): {
  hp: number; potions: number; lanterns: number; whetstones: number;
  ammo: number; swordDur: number; lanternT: number;
} {
  const n = Math.max(1, Math.round(level));
  const upTo = (per: number, cap: number): number => Math.min(cap, Math.floor(n / per));
  return {
    // Full health and a fresh blade at every level: arriving wounded is a
    // consequence of a previous run, and in co-op there is no previous run.
    hp: MAX_HP,
    swordDur: SWORD_DUR_MAX,
    potions: upTo(COOP_KIT.potionPerLevels, COOP_KIT.potionCap),
    lanterns: upTo(COOP_KIT.lanternPerLevels, COOP_KIT.lanternCap),
    whetstones: upTo(COOP_KIT.whetstonePerLevels, COOP_KIT.whetstoneCap),
    ammo: COOP_KIT.ammoBase + Math.round((n - 1) * COOP_KIT.ammoPerLevel),
    // Carried unlit. Choosing when to burn one is the point of the item, and
    // handing out a lit lantern would spend that choice for the player.
    lanternT: 0,
  };
}
