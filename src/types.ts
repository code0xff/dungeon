import type * as THREE from 'three';

// ================= 던전 =================
/** 0 = 통로, 1 = 벽. maze[z][x] 순서로 인덱싱한다. */
export type Maze = number[][];
export type GridCell = readonly [x: number, z: number];

// ================= 크리처 =================
export type CreatureKey = 'zombie';
export type ClipName = 'idle' | 'walk' | 'attack' | 'death';

export interface CreatureType {
  name: string;
  hp: number;
  dmg: number;
  /** m/s */
  speed: number;
  /** 공격 쿨다운(초). 실제로는 공격 클립 길이와 큰 쪽이 쓰인다. */
  atkCd: number;
  /** 공격이 닿는 거리(m) */
  reach: number;
  /** 충돌 반지름(m) */
  r: number;
  /** 처치 보상 골드 */
  reward: number;
  /** 플레이어를 인식하는 거리(m) */
  aggro: number;
  /** 신음 간격 [최소, 최대] 초 */
  groan: readonly [number, number];
  /** 폴백 박스 모델의 팔다리 스윙 속도 */
  animSpeed: number;
  /** 폴백 박스 모델의 팔다리 스윙 폭(rad) */
  swing: number;
}

/** 폴백 박스 모델의 관절. 외부 모델을 쓰면 null이다. */
export interface CreatureRig {
  /** 피격 플래시용. 개체마다 복제된 머티리얼이어야 한다. */
  mats: THREE.MeshStandardMaterial[];
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Group;
  torso: THREE.Group;
  /** 팔의 기본 x회전 [왼팔, 오른팔] */
  armBase: readonly [number, number];
  /** 오른다리 스윙 배율. 1보다 작으면 절뚝인다. */
  limp: number;
}

// ---- 외부 모델(FBX/GLB) 크리처 ----
export type Clips = Partial<Record<ClipName, THREE.AnimationClip>>;

export interface CreatureTemplate {
  root: THREE.Object3D;
  clips: Clips;
}

/** 외부 모델로 스폰된 크리처의 애니메이션 재생 상태. */
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
  /** 외부 모델이면 재생 상태, 폴백이면 null */
  playback: MonsterPlayback | null;
  /** 폴백이면 리그, 외부 모델이면 null */
  rig: CreatureRig | null;
  /** 남은 공격 쿨다운(초) */
  atkCd: number;
  /** 공격 모션 잔여 시간(초). >0이면 공격 중이라 못 움직인다. */
  attackT: number;
  /** 타격 판정까지 남은 시간(초). 모션 중간에 한 번 터지고 null이 된다. */
  pendingHit: number | null;
  /** 피격 플래시 잔여 시간(초) */
  hurtT: number;
  /** 총성 등으로 각성한 잔여 시간(초). >0이면 aggro 밖에서도 추격 */
  alert: number;
  /** 다음 경로 재탐색까지 남은 시간(초) */
  repath: number;
  /** 현재 향하는 다음 그리드 칸 */
  step: GridCell | null;
  /** 이번 프레임에 이동했는지 */
  moving: boolean;
  /** 개체별 이동 속도 배율. 무리가 한 몸처럼 움직이지 않게 흩는다. */
  speedMul: number;
  /** 폴백 박스 모델의 걷기 위상 */
  anim: number;
  /** 고개 흔들림 위상 오프셋 */
  bobSeed: number;
  /** 다음 신음까지 남은 시간(초) */
  groanT: number;
  /** 사망 모션 재생 중 */
  dead: boolean;
  /** 씬에서 제거되기까지 남은 시간(초) */
  deadT: number;
}

// ================= 상자 / 소품 =================
export type ItemKind = 'torch' | 'map' | 'ammo' | 'potion' | 'musket';

export interface Chest {
  mesh: THREE.Group;
  /** 뚜껑 피벗. 열릴 때 x축으로 회전한다. */
  lid: THREE.Group;
  value: number;
  state: 'closed' | 'opened';
  /** 뚜껑 열림 진행도 0~1 */
  openT: number;
  item: ItemKind | null;
}

export interface Prop {
  object: THREE.Object3D;
  /** 사슬처럼 흔들리는 소품의 위상 오프셋. 흔들리지 않으면 null */
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
  /** 경과 시간(초) */
  t: number;
}

// ================= 무기 =================
export type WeaponKind = 'sword' | 'musket';

/**
 * 1인칭 무기 모델의 손 맞춤 설정. 모델마다 원점과 축이 제각각이라
 * 로더가 rot → length → back 순으로 정규화한다. 자세한 건 config.ts 의 WEAPON_ASSETS 참고.
 */
export interface WeaponAsset {
  url: string;
  /** 라디안. 모델의 긴 축을 -Z로 돌리는 회전. */
  rot: readonly [number, number, number];
  /** 정규화 후 z 방향 전체 길이(m). */
  length: number;
  /** 원점보다 뒤(+z)로 나오는 길이(m). */
  back: number;
}

// ================= 텍스처 =================
export interface PBRMaps {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
}
