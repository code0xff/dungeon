import * as THREE from 'three';
import { LIGHT_DIM, MAX_HP } from './config';
import type { Chest, Looting, Maze, Monster, Prop, Sconce, WeaponKind } from './types';

/**
 * Mutable state for one run. buildWorld() resets all of it.
 * Anything that has to survive a run lives in src/progress.ts instead.
 */
export const state = {
  // ---- Dungeon ----
  maze: [] as Maze,
  exitCell: { x: 0, z: 0 },

  // ---- Player ----
  pos: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  hp: MAX_HP,
  runGold: 0,

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
  /** Seconds of lantern fuel left. 0 means unlit. */
  lanternT: 0,
  /** Whether the low-fuel warning has already fired this run. */
  lanternWarned: false,
  hasMap: false,
  /** The exit will not open without it. One per dungeon, and it does not carry. */
  hasKey: false,
  /** Whether the player was inside the portal last frame, so the locked-door
   *  message fires once on arrival rather than every frame. */
  atPortal: false,
  // Carried, not consumed on pickup: pressing the slot key spends one.
  potions: 0,
  lanterns: 0,
  /** Base intensity of the player's light. A lit lantern raises it. */
  // Widened: LIGHT_DIM is `as const`, so without this the field types as 1.75.
  lightBase: LIGHT_DIM.intensity as number,

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
