import * as THREE from 'three';
import { LIGHT_DIM, MAX_HP } from './config';
import type { Chest, Looting, Maze, Monster, Prop, Sconce, Trap, WeaponKind } from './types';

/**
 * Mutable state for one run. buildWorld() resets all of it.
 * Anything that has to survive a run lives in src/progress.ts instead.
 */
export const state = {
  // ---- Dungeon ----
  maze: [] as Maze,
  /**
   * Grid dimensions of the current dungeon, walls included. They mirror
   * `maze[0].length` and `maze.length`, and are kept as fields because almost
   * every use is a bounds check in a hot loop where `state.gw` reads better than
   * digging the length back out of the array.
   *
   * They change every stage — the dungeon grows with the stage number and is not
   * necessarily square. Nothing may assume a compile-time size.
   */
  gw: 0,
  gh: 0,
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
  traps: [] as Trap[],

  // ---- Progress ----
  gameOver: false,
  /** The guide is open. The frame loop still renders, it just stops advancing. */
  paused: false,

  // ---- Sword ----
  /** Durability, 0..SWORD_DUR_MAX. Damage falls with it. */
  swordDur: 0,
  /** Whether the blunt-sword warning has already fired this run. */
  swordWarned: false,
  /** Attack cooldown left, in seconds. */
  atkTimer: 0,
  /** Swing progress 0..1; -1 means not swinging. */
  swingT: -1,
  /** Whether this swing already resolved, so one swing cuts once. */
  swingHit: false,
  /**
   * Whether the swing in flight was launched out of a forward dodge.
   *
   * Latched when the player presses, not read when the blade lands: the two are
   * SWING_IMPACT / SWING_SPEED apart, and the window belongs to the input.
   */
  swingLunge: false,
  /** Whether the lunge has been explained once this run. */
  lungeShown: false,

  // ---- Dodge ----
  /** Seconds of dodge left; -1 when not dodging. */
  dashT: -1,
  /** Seconds until it can be used again. */
  dashCd: 0,
  /** Direction locked in when the dodge started, as a world-space unit vector. */
  dashX: 0,
  dashZ: 0,
  /** -1 left, +1 right, 0 straight. Only used for the camera roll. */
  dashSide: 0,
  /** Seconds left in which an attack still counts as a lunge. 0 means none. */
  lungeT: 0,

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
  whetstones: 0,
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
