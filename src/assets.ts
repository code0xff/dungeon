import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CLIP_NAMES, CREATURE_ASSETS, FLOOR_TEX_DIR, GRID, WALL_TEX_DIR } from './config';
import { MAKERS } from './creatures';
import type { ClipName, Clips, CreatureKey, CreatureRig, CreatureTemplate, MonsterPlayback, PBRMaps } from './types';

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function materialsOf(o: THREE.Mesh): THREE.Material[] {
  return Array.isArray(o.material) ? o.material : [o.material];
}

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

/** 로드에 성공한 크리처만 들어간다. 없는 키는 절차적 폴백을 쓴다. */
const templates: Partial<Record<CreatureKey, CreatureTemplate>> = {};
const pbr: { wall: PBRMaps | null; floor: PBRMaps | null } = { wall: null, floor: null };

export function wallPBR(): PBRMaps | null {
  return pbr.wall;
}
export function floorPBR(): PBRMaps | null {
  return pbr.floor;
}

interface LoadedModel {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** base 경로에 .fbx/.glb/.gltf를 차례로 붙여 시도한다. 전부 없으면 null. */
async function tryLoadModel(base: string): Promise<LoadedModel | null> {
  for (const ext of ['fbx', 'glb', 'gltf'] as const) {
    const url = `${base}.${ext}`;
    try {
      if (ext === 'fbx') {
        const r = await fbxLoader.loadAsync(url);
        return { root: r, animations: r.animations };
      }
      const r = await gltfLoader.loadAsync(url);
      return { root: r.scene, animations: r.animations };
    } catch {
      // 다음 확장자 시도
    }
  }
  return null;
}

async function tryLoadTexture(url: string, srgb = false): Promise<THREE.Texture | null> {
  try {
    const t = await texLoader.loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch {
    return null;
  }
}

/** diffuse가 없으면 PBR 세트 자체를 포기하고 폴백 텍스처를 쓴다. */
async function loadPBR(dir: string, repeat: number): Promise<PBRMaps | null> {
  const [map, normalMap, roughnessMap] = await Promise.all([
    tryLoadTexture(`${dir}/diffuse.jpg`, true),
    tryLoadTexture(`${dir}/normal.jpg`),
    tryLoadTexture(`${dir}/rough.jpg`),
  ]);
  if (!map) return null;
  for (const t of [map, normalMap, roughnessMap]) t?.repeat.set(repeat, repeat);
  const maps: PBRMaps = { map };
  if (normalMap) maps.normalMap = normalMap;
  if (roughnessMap) maps.roughnessMap = roughnessMap;
  return maps;
}

/**
 * 모델의 높이와 바닥 y를 잰다.
 *
 * 스킨드 메시는 화면에 그려질 때 정점이 **본 행렬**로 배치되므로, geometry의
 * 바운딩박스가 실제로 보이는 크기와 전혀 다를 수 있다. FBX2glTF가 내보낸 GLB가
 * 그런 경우로, 박스는 0.44인데 본 기준으로는 1.49였다(3.4배 차이).
 * 그래서 본이 있으면 본 월드 위치로 재고, 없을 때만 박스로 폴백한다.
 */
function measure(root: THREE.Object3D): { height: number; minY: number } {
  root.updateWorldMatrix(false, true);

  const v = new THREE.Vector3();
  let min = Infinity, max = -Infinity, bones = 0;
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    bones++;
    o.getWorldPosition(v);
    if (v.y < min) min = v.y;
    if (v.y > max) max = v.y;
  });
  if (bones >= 2) return { height: max - min, minY: min };

  const box = new THREE.Box3().setFromObject(root);
  return { height: box.max.y - box.min.y, minY: box.min.y };
}

/**
 * 모델의 메시/텍스처 상태를 한 줄로 요약한다.
 * Mixamo에서 캐릭터를 안 고르고 받으면 텍스처 없는 기본 마네킹(Beta/Alpha = Y Bot·X Bot)이
 * 딸려오는데, 화면만 봐서는 "왜 스킨이 없지"로 보여서 로그에 바로 드러나게 한다.
 */
function describeSkin(root: THREE.Object3D): string {
  let meshes = 0, mannequin = false;
  const maps = new Set<string>();
  root.traverse((o) => {
    if (!isMesh(o)) return;
    meshes++;
    if (/^(Beta|Alpha)_/.test(o.name)) mannequin = true;
    for (const m of materialsOf(o)) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) maps.add(map.uuid);
    }
  });
  const tex = maps.size ? `텍스처 ${maps.size}장` : '텍스처 없음';
  const hint = !maps.size && mannequin ? ' — Mixamo 기본 마네킹이다. Characters 탭에서 캐릭터를 먼저 고를 것' : '';
  return `메시 ${meshes} · ${tex}${hint}`;
}

/**
 * 크기 정규화에 쓸 수 없는 모델이면 사람이 읽을 이유를, 쓸 수 있으면 null을 돌려준다.
 * 메시 없는 FBX(Mixamo "Without Skin")를 그냥 통과시키면 스케일이 0이 되어
 * 아무것도 안 보이는데 로그에는 "로드 완료"가 찍혀 원인을 찾기 어렵다.
 */
function unusableReason(root: THREE.Object3D): string | null {
  let verts = 0;
  root.traverse((o) => {
    if (isMesh(o)) verts += o.geometry?.getAttribute('position')?.count ?? 0;
  });
  if (verts === 0) return '메시 없음 (idle을 With Skin으로 다시 받을 것)';

  const { height } = measure(root);
  if (!Number.isFinite(height) || height <= 0) return `높이를 잴 수 없음 (h=${height})`;
  return null;
}

export async function loadAssets(onProgress: (msg: string) => void): Promise<void> {
  const log: string[] = [];

  for (const key of Object.keys(CREATURE_ASSETS) as CreatureKey[]) {
    const cfg = CREATURE_ASSETS[key];
    onProgress(`크리처 로딩: ${key}`);
    const base = await tryLoadModel(`${cfg.dir}/idle`);
    if (!base) {
      log.push(`${key}: 파일 없음 → 기본 모델`);
      continue;
    }
    const root = base.root;

    // 크기 정규화 (Mixamo FBX는 cm 단위라 100배 크다)
    // Mixamo에서 idle.fbx를 Without Skin으로 받으면 뼈대만 들어있고 메시가 없다.
    // 그대로 두면 빈 Box3 때문에 스케일이 0, position이 NaN이 되어 조용히 사라진다.
    const reason = unusableReason(root);
    if (reason) {
      log.push(`${key}: ${reason} → 기본 모델`);
      continue;
    }
    const { height } = measure(root);
    root.scale.multiplyScalar(cfg.height / height);
    // 발이 바닥(y=0)에 닿게 내린다.
    root.position.y = -measure(root).minY;
    root.traverse((o) => {
      if (isMesh(o)) {
        o.frustumCulled = false;
        o.castShadow = false;
      }
    });

    const clips: Clips = {};
    if (base.animations[0]) clips.idle = base.animations[0];
    for (const name of CLIP_NAMES.slice(1) as ClipName[]) {
      const r = await tryLoadModel(`${cfg.dir}/${name}`);
      if (r?.animations[0]) clips[name] = r.animations[0];
    }
    templates[key] = { root, clips };
    log.push(`${key}: 로드 완료 [${Object.keys(clips).join(', ')}] · ${describeSkin(root)}`);
  }

  onProgress('텍스처 로딩');
  pbr.wall = await loadPBR(WALL_TEX_DIR, 1.5);
  pbr.floor = await loadPBR(FLOOR_TEX_DIR, GRID * 1.2);
  log.push(`벽 텍스처: ${pbr.wall ? 'PBR' : '기본'} · 바닥 텍스처: ${pbr.floor ? 'PBR' : '기본'}`);
  console.log('[assets]\n' + log.join('\n'));
}

export interface SpawnedCreature {
  mesh: THREE.Group;
  playback: MonsterPlayback | null;
  rig: CreatureRig | null;
}

/** 외부 모델이 있으면 그걸 복제하고, 없으면 절차적 박스 모델을 만든다. */
export function spawnCreature(key: CreatureKey): SpawnedCreature {
  const t = templates[key];
  if (!t) {
    const { mesh, rig } = MAKERS[key]();
    return { mesh, playback: null, rig };
  }
  const wrap = new THREE.Group();
  const model = cloneSkinned(t.root);
  // 피격 플래시가 개체별로 되도록 머티리얼을 복제한다.
  model.traverse((o) => {
    if (!isMesh(o) || !o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  wrap.add(model);
  return {
    mesh: wrap,
    playback: { mixer: new THREE.AnimationMixer(model), clips: t.clips, action: null, animName: null },
    rig: null,
  };
}

export interface SetAnimOptions {
  /** false면 한 번만 재생하고 마지막 프레임에서 멈춘다. */
  loop?: boolean;
  /** 크로스페이드 시간(초) */
  fade?: number;
  /** 같은 클립이어도 처음부터 다시 재생한다 (연속 공격 등). */
  force?: boolean;
  /** 재생 시작 위치(초). 개체마다 다르게 줘서 무리가 한 몸처럼 움직이지 않게 한다. */
  startAt?: number;
}

/** 같은 클립이 이미 재생 중이면 아무것도 하지 않는다 (force로 무시 가능). */
export function setAnim(pb: MonsterPlayback, name: ClipName, opts: SetAnimOptions = {}): void {
  const { loop = true, fade = 0.15, force = false, startAt = 0 } = opts;
  const clip = pb.clips[name];
  if (!clip || (pb.animName === name && !force)) return;

  const a = pb.mixer.clipAction(clip);
  const prev = pb.action;
  a.reset();
  a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  a.clampWhenFinished = !loop;
  a.enabled = true;
  a.timeScale = 1;
  a.time = startAt;
  a.setEffectiveWeight(1);
  a.fadeIn(fade).play();
  // 같은 액션을 재시작하는 경우엔 자기 자신을 페이드아웃하면 안 된다.
  if (prev && prev !== a) prev.fadeOut(fade);
  pb.action = a;
  pb.animName = name;
}

/** 클립 길이(초). 클립이 없으면 null. */
export function clipDuration(pb: MonsterPlayback, name: ClipName): number | null {
  return pb.clips[name]?.duration ?? null;
}

/** 외부 모델 크리처의 피격 플래시를 emissive로 표현한다. */
export function flashLoadedMesh(mesh: THREE.Object3D, on: boolean): void {
  mesh.traverse((o) => {
    if (!isMesh(o) || !o.material) return;
    for (const m of materialsOf(o)) {
      const emissive = (m as THREE.MeshStandardMaterial).emissive;
      emissive?.setHex(on ? 0x7a1a1a : 0x000000);
    }
  });
}
