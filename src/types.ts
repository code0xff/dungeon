import type * as THREE from 'three';

// ================= Dungeon =================
/** 0 = floor, 1 = wall. Indexed maze[z][x]. */
export type Maze = number[][];
export type GridCell = readonly [x: number, z: number];

// ================= Creatures =================
export type CreatureKey = 'zombie';
export type ClipName = 'idle' | 'walk' | 'attack' | 'death';

export interface CreatureType {
  name: string;
  hp: number;
  dmg: number;
  /** m/s */
  speed: number;
  /** Attack cooldown in seconds. The longer of this and the attack clip wins. */
  atkCd: number;
  /** Reach of the attack, in metres. */
  reach: number;
  /** Collision radius, in metres. */
  r: number;
  /** Gold awarded for the kill. */
  reward: number;
  /** Distance at which the player is noticed, in metres. */
  aggro: number;
  /** Groan interval as [min, max] seconds. */
  groan: readonly [number, number];
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

export interface CreatureTemplate {
  root: THREE.Object3D;
  clips: Clips;
}

/** Animation playback state for a creature spawned from an external model. */
export interface MonsterPlayback {
  mixer: THREE.AnimationMixer;
  clips: Clips;
  action: THREE.AnimationAction | null;
  animName: ClipName | null;
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
  /** Whether it moved this frame. */
  moving: boolean;
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
export type ItemKind = 'torch' | 'map' | 'ammo' | 'potion' | 'musket';

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
