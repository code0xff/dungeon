import type * as THREE from 'three';

// ================= Dungeon =================
/** 0 = floor, 1 = wall. Indexed maze[z][x]. */
export type Maze = number[][];
export type GridCell = readonly [x: number, z: number];

// ================= Creatures =================
export type CreatureKey = 'zombie' | 'brute' | 'lunatic';
export type ClipName = 'idle' | 'walk' | 'attack' | 'death';

export interface CreatureType {
  name: string;
  hp: number;
  dmg: number;
  /** m/s */
  speed: number;
  /** Attack cooldown in seconds. The longer of this and the attack clip wins. */
  atkCd: number;
  /**
   * Playback rate of the attack clip, which is also what sets the real cadence:
   * startAttack floors the cooldown at the clip's length, so `atkCd` alone can
   * never make a creature swing more often.
   *
   * Per creature because the clips are not the same length — Mixamo gave the
   * zombie a 2.5s swing and the brute a 4.63s one, and a single global rate that
   * suits one leaves the other rooted to the spot for three seconds.
   */
  attackSpeed: number;
  /** Reach of the attack, in metres. */
  reach: number;
  /** Collision radius, in metres. Used for the player's attack cone. */
  r: number;
  /**
   * Radius kept from walls, as opposed to `r`, which is the body.
   *
   * A creature's arms reach far outside its body, so testing at the body radius
   * let arms pass through walls in corners. Stepping every skinned vertex through
   * every clip puts the furthest point of a moving creature at 1.03m for the
   * zombie, 1.46m for the brute and 1.00m for the lunatic, times the 1.08 top of
   * SCALE_VARIANCE.
   *
   * Measure it per creature rather than deriving it from `r` or from height. The
   * brute is 1.27x the zombie's height and reaches 1.4x as far; the lunatic is
   * shorter than the zombie and reaches the same distance. The number comes from
   * the pose each creature's own attack clip strikes, not from the body.
   *
   * A 4m corridor leaves CELL - 2*clearance of usable width, so keep it well
   * under 2 or a creature cannot enter a corridor at all.
   */
  clearance: number;
  /** Middle of the gold a kill pays; REWARD_SPREAD sets the band around it. */
  reward: number;
  /** Distance at which the player is noticed, in metres. */
  aggro: number;
  /** Groan interval as [min, max] seconds. */
  groan: readonly [number, number];
  /**
   * Groan pitch multiplier. 1 is the zombie. Below 1 is a bigger chest cavity —
   * it is the only thing that tells the player which of the two is in the dark
   * ahead of them, so keep the values well apart.
   */
  voice: number;
  /** Limb swing rate of the fallback box model. */
  animSpeed: number;
  /** Limb swing amplitude of the fallback box model, in radians. */
  swing: number;
}

/** Joints of the fallback box model. null once an external model is in use. */
export interface CreatureRig {
  /** For the hit flash. Must be a material cloned per creature. */
  mats: THREE.MeshStandardMaterial[];
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Group;
  torso: THREE.Group;
  /** Resting x rotation of the arms, as [left, right]. */
  armBase: readonly [number, number];
  /** Swing multiplier for the right leg. Below 1 gives a limp. */
  limp: number;
}

// ---- Creatures from external models (FBX/GLB) ----
export type Clips = Partial<Record<ClipName, THREE.AnimationClip>>;

/**
 * How many of a creature spawn, as a starting count and a per-stage increase.
 * See SPAWN in config.ts for the reasoning.
 */
export interface SpawnRate {
  /** Stage 1's count. */
  base: number;
  /** Added per stage after the first. Fractional; the total is floored. */
  perStage: number;
}

/** Where a creature's model and clips come from. See CREATURE_ASSETS in config.ts. */
export interface CreatureAsset {
  /** Folder under assets/, holding idle/walk/attack/death in fbx, glb or gltf. */
  dir: string;
  /** Height in metres the model is normalised to, feet on the floor. */
  height: number;
}

export interface CreatureTemplate {
  root: THREE.Object3D;
  clips: Clips;
  /**
   * Ground speed the walk clip was authored at, in m/s, measured from the root
   * motion before it was stripped. null when the clip was already in place and
   * there was nothing to measure — then WALK_CLIP_SPEED is the only estimate.
   */
  walkClipSpeed: number | null;
}

/** Animation playback state for a creature spawned from an external model. */
export interface MonsterPlayback {
  mixer: THREE.AnimationMixer;
  clips: Clips;
  action: THREE.AnimationAction | null;
  animName: ClipName | null;
  /** See CreatureTemplate.walkClipSpeed. */
  walkClipSpeed: number | null;
}

export interface Monster {
  mesh: THREE.Group;
  key: CreatureKey;
  type: CreatureType;
  hp: number;
  /** Playback state for an external model; null for the fallback. */
  playback: MonsterPlayback | null;
  /** The rig for a fallback model; null for an external one. */
  rig: CreatureRig | null;
  /** Attack cooldown left, in seconds. */
  atkCd: number;
  /** Seconds of attack animation left. Above 0 the creature is attacking and cannot move. */
  attackT: number;
  /** Seconds until the hit resolves. Fires once mid-animation, then goes null. */
  pendingHit: number | null;
  /** Seconds of hit flash left. */
  hurtT: number;
  /** Seconds left of alertness from a gunshot. Above 0 it chases from beyond aggro range. */
  alert: number;
  /** Seconds until the path is recomputed. */
  repath: number;
  /** The next grid cell being walked toward. */
  step: GridCell | null;
  /** Whether it actually moved this frame — not merely whether it tried to. */
  moving: boolean;
  /**
   * Ground speed actually achieved, in m/s, smoothed. Drives the walk clip's
   * playback rate. Not the same as `type.speed`: a creature sliding along a wall
   * covers a fraction of what it intended.
   */
  groundSpeed: number;
  /** Per-creature speed multiplier, so the horde does not move as one body. */
  speedMul: number;
  /** Walk phase of the fallback box model. */
  anim: number;
  /** Phase offset of the head bob. */
  bobSeed: number;
  /** Seconds until the next groan. */
  groanT: number;
  /** Death animation is playing. */
  dead: boolean;
  /** Seconds until removal from the scene. */
  deadT: number;
}

// ================= Chests and props =================
export type ItemKind = 'key' | 'lantern' | 'map' | 'ammo' | 'potion' | 'musket' | 'whetstone';

export interface Chest {
  mesh: THREE.Group;
  /**
   * Lid pivot. Rotates about x as the chest opens.
   * Object3D rather than Group because a glTF node that carries geometry
   * arrives as a Mesh.
   */
  lid: THREE.Object3D;
  value: number;
  state: 'closed' | 'opened';
  /** Lid opening progress, 0..1. */
  openT: number;
  item: ItemKind | null;
  /** A trap on the lid: springs when it comes open, and the map marks it. */
  trapped: boolean;
}

export interface Trap {
  mesh: THREE.Group;
  /** Sprung traps stay in the world as visibly triggered scenery. */
  sprung: boolean;
  /** Seconds of spring animation left, or 0. */
  springT: number;
}

export interface Prop {
  object: THREE.Object3D;
  /** Phase offset for props that sway, like chains. null when it does not sway. */
  swing: number | null;
}

export interface Sconce {
  group: THREE.Group;
  flame: THREE.Mesh;
  light: THREE.PointLight;
  seed: number;
}

export interface Looting {
  chest: Chest;
  /** Elapsed time, in seconds. */
  t: number;
}

// ================= Weapons =================
export type WeaponKind = 'sword' | 'musket';

/**
 * How a first-person weapon model is fitted to the hand. Every model has its own
 * origin and axes, so the loader normalises by rot, then length, then back.
 * See WEAPON_ASSETS in config.ts for the details.
 */
export interface WeaponAsset {
  url: string;
  /** Radians. The rotation that points the model's long axis down -Z. */
  rot: readonly [number, number, number];
  /** Total length along z after normalising, in metres. */
  length: number;
  /** How far the model reaches behind the origin (+z), in metres. */
  back: number;
}

// ================= Textures =================
export interface PBRMaps {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
}
