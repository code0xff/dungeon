import type { CreatureKey, CreatureType, WeaponAsset, WeaponKind } from './types';

// ================= Asset configuration =================
// publicDir='assets' in vite.config.ts is why none of these paths carry an 'assets/' prefix.
// On disk: assets/creatures/zombie/idle.fbx (model + idle clip), walk.fbx, attack.fbx,
//          death.fbx (glb/gltf work too), assets/textures/wall/{diffuse,normal,rough}.webp,
//          assets/textures/floor/...
// Anything missing falls back to the models and textures built in code.
export const CREATURE_ASSETS: Record<CreatureKey, { dir: string; height: number }> = {
  zombie: { dir: 'creatures/zombie', height: 1.85 },
};
export const WALL_TEX_DIR = 'textures/wall';
export const FLOOR_TEX_DIR = 'textures/floor';
export const CLIP_NAMES = ['idle', 'walk', 'attack', 'death'] as const;

/**
 * First-person weapon models. Without them the primitives in src/scene.ts are used.
 * `npm run fetch-assets` pulls these from Poly Haven (CC0).
 *
 * Every model has its own origin and axes, so the loader fits it to the hand in order:
 *   1. apply rot so the long axis points down -Z, in front of the camera
 *   2. scale uniformly until the total z length equals `length`
 *   3. translate so the rear end (buttstock or pommel) lands at z=back, which puts
 *      the grip near the origin
 * The muzzle is read off the normalised bounds, so it needs no entry here.
 */
export const WEAPON_ASSETS: Record<WeaponKind, WeaponAsset> = {
  // wooden_handle_saber: tip along +Y, grip near the origin
  sword: { url: 'weapons/sword.glb', rot: [-Math.PI / 2, 0, 0], length: 1.05, back: 0.14 },
  // bolt_action_rifle_7_62: muzzle along +X
  musket: { url: 'weapons/musket.glb', rot: [0, Math.PI / 2, 0], length: 1.3, back: 0.3 },
};

// ================= Tuning =================
export const MAZE_CELLS = 11;
export const GRID = MAZE_CELLS * 2 + 1;
export const CELL = 4;
export const WALL_H = 3.4;
export const PLAYER_R = 0.45;
export const SPEED = 5.2;
export const CHEST_COUNT = 10;
export const ATTACK_RANGE = 2.3;
export const ATTACK_CD = 0.45;

// ---- Sword swing ----
// The blade is raised, then brought down. One cycle takes 1/SWING_SPEED seconds.
/** Higher is faster. One cycle is 0.33s — it must stay under ATTACK_CD (0.45s) or the motion is cut off. */
export const SWING_SPEED = 3.0;
/** Fraction of the cycle spent raising the blade. 0.11s. */
export const SWING_WINDUP = 0.33;
/**
 * Point in the cycle (0..1) where the blade lands. Damage resolves here.
 * Same idea as ATTACK_IMPACT on the zombie side, but this one answers to player
 * input, so a late hit feels sluggish — it is set much earlier, about 0.2s.
 *
 * The stretch from SWING_WINDUP to here is the downswing itself. It needs to be
 * about five frames at 60fps for the blade to read as passing through. Do not
 * crowd it up against WINDUP.
 */
export const SWING_IMPACT = 0.6;
export const LOOT_TIME = 1.2;
export const FOG_BASE = 0.115;
export const FOG_TORCH = 0.08;

/** Eye height in metres. Walking bobs the camera around this. */
export const EYE_H = 1.55;

// ---- Musket ----
export const MUSKET_DMG = 3;
export const MUSKET_RELOAD = 3.0;

// ---- Ammo ----
/** Spare rounds at the start. One chambered round is added on top, so a run opens with START_AMMO+1 shots. */
export const START_AMMO = 6;
/** Rounds granted by one ammo pickup. */
export const AMMO_PICKUP = 3;
/** Rounds that come with the musket pickup. */
export const MUSKET_AMMO = 5;
export const MUSKET_RANGE = 26;
export const SHOT_ALERT_RADIUS = 20;

// ================= Creatures =================
export const TYPES: Record<CreatureKey, CreatureType> = {
  zombie: {
    name: 'Zombie',
    hp: 3, dmg: 14, speed: 2.2, atkCd: 1.0,
    reach: 1.6, r: 0.45, reward: 10, aggro: 9,
    groan: [4, 8],
    animSpeed: 6.5, swing: 0.5,
  },
};

/** The creatures spawned in one run. */
export const SPAWN: readonly CreatureKey[] = ['zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie'];

// ---- Creature animation ----
/** Attack duration in seconds when the external model carries no attack clip. */
export const FALLBACK_ATTACK_TIME = 0.9;
/** Where in the attack clip the hit resolves (0 = start, 1 = end) — as the arm comes down. */
export const ATTACK_IMPACT = 0.45;
/** At impact the player must be within reach times this. Kept slightly generous. */
export const ATTACK_IMPACT_REACH = 1.3;
/** Ground speed in m/s that the Mixamo in-place walk clip assumes. Used to cancel foot sliding. */
export const WALK_CLIP_SPEED = 1.45;
/** Allowed range for the walk clip's timeScale, clamped so it never crawls or blurs. */
export const WALK_TIMESCALE_RANGE: readonly [number, number] = [0.6, 1.9];
/** Top turn rate in rad/s, so creatures rotate rather than snap. */
export const TURN_RATE = 6.0;
/** Seconds the corpse lingers after the death animation ends. */
export const CORPSE_LINGER = 1.5;
/** Per-creature speed multiplier range, so the horde does not move as one body. */
export const SPEED_VARIANCE: readonly [number, number] = [0.85, 1.15];
/** Per-creature scale multiplier range. */
export const SCALE_VARIANCE: readonly [number, number] = [0.93, 1.08];
