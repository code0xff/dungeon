import { MAX_HP, SWORD_DUR_MAX, COOP_KIT } from '../config';
import type { Outfit } from '../types';

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
  /** The host chose hard mode: one chest, the key, no pack. See progress.hard. */
  hard: false,
  /**
   * Which dungeon this player's score belongs to.
   *
   * Kept after the run ends, unlike net.runId, because the end screen outlives
   * the run: it is what tells a total for the dungeon you just left from a
   * total for one you left twenty minutes ago.
   */
  runId: 0,
  /**
   * What the party has banked between them this run.
   *
   * Counted by the host, because only the host sees everyone finish. It is the
   * mode's only score: there is no bank and nothing carries, so this number and
   * the story of the run are the whole of what a party takes away.
   */
  partyGold: 0,
  /**
   * Watching the rest of the party after dying.
   *
   * Death is final and spectating is offered rather than forced (docs/coop.md),
   * and this is the offer being taken: the run is over for this player, the
   * dungeon carries on, and they can look at it.
   */
  watching: false,
  /**
   * What this player walked out of the party's last dungeon with — health,
   * gear, and the gold that is theirs to spend in the shop — or null for a
   * player arriving with nothing: the first dungeon, after a death, or after
   * leaving the lobby. It lives as long as the connection and never touches
   * progress.ts; a party's gear is the party's.
   */
  carry: null as Outfit | null,
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
 * For a player arriving with nothing — the first dungeon of a party, or the
 * one after a death. Solo reaches stage 8 through eight visits to the shop,
 * and a level 8 dungeon on a stage 1 kit is not a difficulty setting, it is a
 * wall. A player who got out of the last one carries their own (coop.carry).
 *
 * The rates are in COOP_KIT rather than here so the whole ramp is one place in
 * config.ts, next to the spawn curve it is meant to keep pace with.
 */
export function coopKit(level: number, hard: boolean): {
  hp: number; potions: number; lanterns: number; whetstones: number;
  ammo: number; swordDur: number; lanternT: number;
} {
  const n = Math.max(1, Math.round(level));
  // Hard mode's pack is empty, the same as solo: the level ramp is for the
  // dungeon's difficulty, and hard mode is the difficulty of having nothing.
  const upTo = (per: number, cap: number): number => (hard ? 0 : Math.min(cap, Math.floor(n / per)));
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
