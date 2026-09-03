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
 * Prop models. Without them the primitives in src/props.ts are used.
 *
 * `lidNode` names the node the open animation turns. Poly Haven's treasure_chest
 * already has its lid as a separate node hinged at the back, which is the same
 * convention the primitive chest uses, so it needs no rework.
 */
export const PROP_ASSETS = {
  chest: { url: 'props/chest.glb', height: 0.62, lidNode: 'treasure_chest_lid' },
  /** Held in the left hand. Without the file nothing is drawn — see loadLantern(). */
  lantern: { url: 'props/lantern.glb', height: 0.29 },
} as const;

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
/**
 * How far the lid swings open, in radians. Negative tips the front up.
 * Past about -1.6 the lid clears vertical and looks detached rather than open.
 */
export const CHEST_LID_OPEN = -1.5;
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

// ---- Lantern ----
/**
 * Seconds a lantern burns for. It is the only way to see far, so this is the
 * real clock on a run: about two and a half minutes of good light per pickup,
 * and the remainder carries into the next stage.
 */
export const LANTERN_FUEL = 150;
/** Fuel left when the player is warned, in seconds. */
export const LANTERN_WARN = 30;

/** The player's light, unlit and lit. Fog closes in when the lantern dies. */
export const LIGHT_DIM = { distance: 11, intensity: 1.75, fog: FOG_BASE } as const;
export const LIGHT_LIT = { distance: 19, intensity: 2.7, fog: FOG_TORCH } as const;

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

/**
 * How many of each creature spawn in one run.
 * The dungeon is 23x23 cells at 4m each, so this is what sets the odds of
 * turning a corner into something.
 */
export const SPAWN: Readonly<Record<CreatureKey, number>> = { zombie: 20 };

// ---- Creature animation ----
/**
 * Playback rate of the attack clip.
 *
 * The Mixamo attack is 2.5s, and startAttack floors the cooldown at the clip
 * length, so atkCd alone cannot make a creature swing more often — the clip has
 * to run faster. At 1.6 the swing takes 1.56s, which is also the real cadence.
 */
export const ATTACK_SPEED = 1.6;
/** Attack duration in seconds when the external model carries no attack clip. */
export const FALLBACK_ATTACK_TIME = 0.9;
/** Where in the attack clip the hit resolves (0 = start, 1 = end) — as the arm comes down. */
export const ATTACK_IMPACT = 0.45;
/** At impact the player must be within reach times this. Kept slightly generous. */
export const ATTACK_IMPACT_REACH = 1.3;
/**
 * Fallback ground speed of the walk clip, in m/s.
 *
 * Only used when the clip is genuinely in place and its authored speed cannot be
 * measured. Any clip with root motion is measured instead — see
 * CreatureTemplate.walkClipSpeed.
 */
export const WALK_CLIP_SPEED = 1.45;
/** Allowed range for the walk clip's timeScale, clamped so it never crawls or blurs. */
export const WALK_TIMESCALE_RANGE: readonly [number, number] = [0.6, 1.9];
/**
 * Radius creatures keep from walls, as opposed to `r`, which is the body used
 * for the player's attack cone.
 *
 * A zombie's arms reach about 1.0m from its origin while the body is only 0.45m
 * across, so testing at the body radius let arms pass through walls in corners.
 * A 4m corridor still leaves 2.1m of usable width at this clearance.
 */
export const CREATURE_WALL_CLEARANCE = 0.95;
/** Top turn rate in rad/s, so creatures rotate rather than snap. */
export const TURN_RATE = 6.0;
/** Seconds the corpse lingers after the death animation ends. */
export const CORPSE_LINGER = 1.5;
/** Per-creature speed multiplier range, so the horde does not move as one body. */
export const SPEED_VARIANCE: readonly [number, number] = [0.85, 1.15];
/** Per-creature scale multiplier range. */
export const SCALE_VARIANCE: readonly [number, number] = [0.93, 1.08];
