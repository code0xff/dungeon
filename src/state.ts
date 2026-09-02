import * as THREE from 'three';
import type { Chest, Looting, Maze, Monster, Prop, Sconce, WeaponKind } from './types';

/**
 * 한 판(run)의 가변 상태. buildWorld가 대부분을 초기화한다.
 * bankGold만 판을 넘어 유지된다.
 */
export const state = {
  // ---- 던전 ----
  maze: [] as Maze,
  exitCell: { x: 0, z: 0 },

  // ---- 플레이어 ----
  pos: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  hp: 100,
  runGold: 0,
  /** 탈출에 성공해야 여기로 옮겨진다. 죽으면 runGold는 소멸. */
  bankGold: 0,

  // ---- 월드 내용물 ----
  monsters: [] as Monster[],
  chests: [] as Chest[],
  props: [] as Prop[],
  sconces: [] as Sconce[],

  // ---- 진행 ----
  gameOver: false,

  // ---- 검 ----
  /** 남은 공격 쿨다운(초) */
  atkTimer: 0,
  /** 휘두르기 진행도 0~1. -1이면 휘두르지 않는 상태 */
  swingT: -1,

  // ---- 루팅 ----
  looting: null as Looting | null,
  nearChest: null as Chest | null,

  // ---- 아이템 ----
  hasTorch: false,
  hasMap: false,
  /** 플레이어 횃불의 기본 밝기. 횃불을 얻으면 올라간다. */
  torchBase: 1.75,

  // ---- 머스킷 ----
  hasMusket: false,
  ammo: 0,
  /** 총알이 장전되어 있는지 */
  loaded: false,
  /** 장전 경과 시간(초). -1이면 장전 중 아님 */
  reloadT: -1,
  weapon: 'sword' as WeaponKind,
  /** 반동 진행도 0~1. -1이면 반동 중 아님 */
  recoilT: -1,
  /** 총구 화염 잔여 시간(초) */
  flashT: 0,
};
