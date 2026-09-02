import type { CreatureKey, CreatureType } from './types';

// ================= 에셋 설정 =================
// vite.config.ts 의 publicDir='assets' 때문에 아래 경로에는 'assets/' 접두사가 없다.
// 실제 파일 위치: assets/creatures/zombie/idle.fbx (모델+대기), walk.fbx, attack.fbx, death.fbx (glb/gltf도 됨)
//                assets/textures/wall/{diffuse,normal,rough}.jpg, assets/textures/floor/...
// 파일이 없으면 코드로 만든 기본 모델/텍스처를 자동으로 쓴다.
export const CREATURE_ASSETS: Record<CreatureKey, { dir: string; height: number }> = {
  zombie: { dir: 'creatures/zombie', height: 1.85 },
};
export const WALL_TEX_DIR = 'textures/wall';
export const FLOOR_TEX_DIR = 'textures/floor';
export const CLIP_NAMES = ['idle', 'walk', 'attack', 'death'] as const;

// ================= 설정 =================
export const MAZE_CELLS = 11;
export const GRID = MAZE_CELLS * 2 + 1;
export const CELL = 4;
export const WALL_H = 3.4;
export const PLAYER_R = 0.45;
export const SPEED = 5.2;
export const CHEST_COUNT = 10;
export const ATTACK_RANGE = 2.3;
export const ATTACK_CD = 0.45;
export const LOOT_TIME = 1.2;
export const FOG_BASE = 0.115;
export const FOG_TORCH = 0.08;

/** 눈높이(m). 걸을 때 여기서 위아래로 흔들린다. */
export const EYE_H = 1.55;

// ---- 머스킷 ----
export const MUSKET_DMG = 3;
export const MUSKET_RELOAD = 3.0;
export const MUSKET_RANGE = 26;
export const SHOT_ALERT_RADIUS = 20;

// ================= 크리처 =================
export const TYPES: Record<CreatureKey, CreatureType> = {
  zombie: {
    name: '좀비',
    hp: 3, dmg: 14, speed: 2.2, atkCd: 1.0,
    reach: 1.6, r: 0.45, reward: 10, aggro: 9,
    groan: [4, 8],
    animSpeed: 6.5, swing: 0.5,
  },
};

/** 한 판에 나오는 크리처. */
export const SPAWN: readonly CreatureKey[] = ['zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie'];

// ---- 크리처 애니메이션 ----
/** 외부 모델에 공격 클립이 없을 때 쓰는 공격 모션 길이(초). */
export const FALLBACK_ATTACK_TIME = 0.9;
/** 공격 클립의 어느 지점에서 타격 판정이 나는지 (0=시작, 1=끝). 팔이 내려오는 순간. */
export const ATTACK_IMPACT = 0.45;
/** 타격 판정 시점에 이 배율만큼 사거리 안에 있어야 맞는다. 살짝 넉넉하게. */
export const ATTACK_IMPACT_REACH = 1.3;
/** Mixamo In-Place 걷기 클립이 상정하는 이동 속도(m/s). 발 미끄러짐 보정에 쓴다. */
export const WALK_CLIP_SPEED = 1.45;
/** 걷기 클립 재생 속도 배율의 허용 범위. 너무 느리거나 빨라 보이지 않게 자른다. */
export const WALK_TIMESCALE_RANGE: readonly [number, number] = [0.6, 1.9];
/** 크리처가 도는 최대 각속도(rad/s). 즉시 스냅하지 않게 한다. */
export const TURN_RATE = 6.0;
/** 사망 모션이 끝난 뒤 시체가 남아있는 시간(초). */
export const CORPSE_LINGER = 1.5;
/** 개체별 이동 속도 배율 범위. 무리가 한 몸처럼 움직이지 않게 흩는다. */
export const SPEED_VARIANCE: readonly [number, number] = [0.85, 1.15];
/** 개체별 크기 배율 범위. */
export const SCALE_VARIANCE: readonly [number, number] = [0.93, 1.08];
