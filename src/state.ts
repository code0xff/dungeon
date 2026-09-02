import * as THREE from 'three';
import type { Chest, Looting, Maze, Monster, Prop, Sconce, WeaponKind } from './types';

/**
 * Mutable state for one run. buildWorld resets nearly all of it.
 * Only bankGold survives from run to run.
 */
export const state = {
  // ---- Dungeon ----
  maze: [] as Maze,
  exitCell: { x: 0, z: 0 },

  // ---- Player ----
  pos: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  hp: 100,
  runGold: 0,
  /** Only a successful extraction moves gold here. Die and runGold is lost. */
  bankGold: 0,

  // ---- World contents ----
  monsters: [] as Monster[],
  chests: [] as Chest[],
  props: [] as Prop[],
  sconces: [] as Sconce[],

  // ---- Progress ----
  gameOver: false,

  // ---- Sword ----
  /** Attack cooldown left, in seconds. */
  atkTimer: 0,
  /** Swing progress 0..1; -1 means not swinging. */
  swingT: -1,
  /** Whether this swing already resolved, so one swing cuts once. */
  swingHit: false,

  // ---- Looting ----
  looting: null as Looting | null,
  nearChest: null as Chest | null,

  // ---- Items ----
  hasTorch: false,
  hasMap: false,
  /** Base intensity of the player's light. Picking up a torch raises it. */
  torchBase: 1.75,

  // ---- Musket ----
  hasMusket: false,
  ammo: 0,
  /** Whether a round is chambered. */
  loaded: false,
  /** Seconds into the reload; -1 means not reloading. */
  reloadT: -1,
  weapon: 'sword' as WeaponKind,
  /** Recoil progress 0..1; -1 means no recoil. */
  recoilT: -1,
  /** Seconds of muzzle flash left. */
  flashT: 0,
};
