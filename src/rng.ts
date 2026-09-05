/**
 * The seeded random stream the world is built from.
 *
 * Everything that decides *where something is* — the maze, the rooms, spawns,
 * chests, traps, props, sconces — draws from here instead of `Math.random()`,
 * so a seed and a stage number reproduce a dungeon exactly. That is what a
 * second player would need in order to walk around the same one: the host sends
 * a number, not a map.
 *
 * It is deliberately not everything. Textures, audio, the dust, the torch
 * flicker and the groan timers stay on `Math.random()` because they are
 * cosmetic, run on their own clocks, and pulling them into this stream would
 * make the layout depend on how many times a torch happened to flicker.
 *
 * mulberry32: 32-bit state, one multiply and a few shifts, and it passes the
 * small-crush tests that matter at this scale. `Math.random()` cannot be used
 * even with a seed because V8 gives no way to set one — that is the whole
 * reason this file exists.
 */
let s = 1;

/** The next float in [0, 1). Same contract as Math.random(). */
export function random(): number {
  // >>> 0 keeps the state unsigned: without it the addition overflows into a
  // negative number and the generator's period collapses.
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Starts the stream. Every call with the same seed produces the same sequence.
 *
 * Seed 0 is remapped because mulberry32's state is the seed itself, and a run
 * seeded 0 would share its first draws with anything else that forgot to seed.
 */
export function setSeed(seed: number): void {
  s = (seed | 0) === 0 ? 0x9e3779b9 : seed >>> 0;
}

/**
 * Folds a run seed and a stage into the seed for that stage's dungeon.
 *
 * Adding them would have been the obvious thing and is wrong: run 100 stage 2
 * and run 101 stage 1 would be the same dungeon, so advancing a stage would
 * sometimes hand the player a maze they had already walked. This mixes both
 * through a 32-bit avalanche so neighbouring inputs share nothing.
 */
export function mixSeed(seed: number, stage: number): number {
  let h = Math.imul(seed >>> 0, 0x85ebca6b) ^ Math.imul(stage | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2d);
  return (h ^ (h >>> 15)) >>> 0;
}

/** A fresh run seed. This is the one place a real random number gets in. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * Fisher-Yates, on the seeded stream.
 *
 * Replaces `sort(() => random() - 0.5)`, which was not just biased: a comparator
 * that answers differently for the same pair is undefined behaviour for
 * Array.prototype.sort, so the result depended on the engine's sort. Two players
 * on different browsers would have found the key in different chests from the
 * same seed.
 */
export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
