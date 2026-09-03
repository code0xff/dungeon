import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  CLIP_NAMES, CREATURE_ASSETS, FLOOR_TEX_DIR, GRID, PROP_ASSETS, WALL_TEX_DIR, WEAPON_ASSETS,
} from './config';
import { MAKERS } from './creatures';
import { equipWeaponModel } from './scene';
import type {
  ClipName, Clips, CreatureKey, CreatureRig, CreatureTemplate, MonsterPlayback, PBRMaps, WeaponAsset, WeaponKind,
} from './types';

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function materialsOf(o: THREE.Mesh): THREE.Material[] {
  return Array.isArray(o.material) ? o.material : [o.material];
}

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

/** Only creatures that loaded end up here. A missing key falls back to the procedural model. */
const templates: Partial<Record<CreatureKey, CreatureTemplate>> = {};
const pbr: { wall: PBRMaps | null; floor: PBRMaps | null } = { wall: null, floor: null };
/** Loaded prop models. A null here means props.ts builds the primitive instead. */
const props: { chest: THREE.Object3D | null } = { chest: null };

/** The chest model, or null when the file is missing. Cloned per chest by props.ts. */
export function chestTemplate(): THREE.Object3D | null {
  return props.chest;
}

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

/** Tries .fbx, .glb and .gltf against the base path in turn. null when none exist. */
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
      // Try the next extension
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

/**
 * Looks for webp first, then jpg. `npm run fetch-assets` bakes webp, but both are
 * tried so dropping Poly Haven's own JPGs into the folder still works.
 */
async function tryLoadMap(dir: string, name: string, srgb = false): Promise<THREE.Texture | null> {
  for (const ext of ['webp', 'jpg'] as const) {
    const t = await tryLoadTexture(`${dir}/${name}.${ext}`, srgb);
    if (t) return t;
  }
  return null;
}

/** Without a diffuse the whole PBR set is abandoned in favour of the fallback texture. */
async function loadPBR(dir: string, repeat: number): Promise<PBRMaps | null> {
  const [map, normalMap, roughnessMap] = await Promise.all([
    tryLoadMap(dir, 'diffuse', true),
    tryLoadMap(dir, 'normal'),
    tryLoadMap(dir, 'rough'),
  ]);
  if (!map) return null;
  for (const t of [map, normalMap, roughnessMap]) t?.repeat.set(repeat, repeat);
  const maps: PBRMaps = { map };
  if (normalMap) maps.normalMap = normalMap;
  if (roughnessMap) maps.roughnessMap = roughnessMap;
  return maps;
}

/**
 * Measures a model's height and the y of its lowest point.
 *
 * A skinned mesh has its vertices placed by the **bone matrices** at draw time, so
 * the geometry's bounding box can bear no relation to the size actually rendered.
 * The GLB that FBX2glTF produced was one of these: the box read 0.44 while the
 * bones spanned 1.49, a factor of 3.4. So bones are measured when present, and the
 * box is only a fallback.
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
 * One-line summary of a model's meshes and textures.
 * Downloading from Mixamo without choosing a character hands you the untextured
 * default mannequin (Beta/Alpha = Y Bot / X Bot). On screen that just looks like a
 * missing skin, so the log says so outright.
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
  const tex = maps.size ? `${maps.size} texture(s)` : 'no textures';
  const hint = !maps.size && mannequin
    ? ' — this is the default Mixamo mannequin. Pick a character on the Characters tab first'
    : '';
  return `${meshes} mesh(es) · ${tex}${hint}`;
}

/**
 * Returns a human-readable reason when a model cannot be normalised, or null when it can.
 * Letting a mesh-less FBX through — Mixamo's "Without Skin" download — yields a scale
 * of 0 and nothing on screen, while the log cheerfully reports a successful load.
 */
function unusableReason(root: THREE.Object3D): string | null {
  let verts = 0;
  root.traverse((o) => {
    if (isMesh(o)) verts += o.geometry?.getAttribute('position')?.count ?? 0;
  });
  if (verts === 0) return 'no mesh (re-download idle with "With Skin")';

  const { height } = measure(root);
  if (!Number.isFinite(height) || height <= 0) return `cannot measure height (h=${height})`;
  return null;
}

/**
 * Finds the frontmost (-z) point of a model — where the muzzle flash and smoke go.
 * A single extreme vertex can land on some unrelated spur such as the tip of a
 * scope, so this averages every vertex within 2cm of the front.
 */
function findTip(root: THREE.Object3D): THREE.Vector3 {
  root.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const eachVertex = (fn: (p: THREE.Vector3) => void): void => {
    root.traverse((o) => {
      if (!isMesh(o)) return;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        fn(v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(o.matrixWorld));
      }
    });
  };

  let minZ = Infinity;
  eachVertex((p) => { if (p.z < minZ) minZ = p.z; });

  const sum = new THREE.Vector3();
  let n = 0;
  eachVertex((p) => { if (p.z <= minZ + 0.02) { sum.add(p); n++; } });
  return n ? sum.divideScalar(n) : new THREE.Vector3(0, 0, minZ);
}

/**
 * Fits a weapon model to the hand: cfg.rot points the long axis down -Z, a uniform
 * scale brings the z length to cfg.length, then a translation puts the rear end at
 * z=back, which leaves the grip at the origin. x and y are centred.
 */
function normalizeWeapon(model: THREE.Object3D, cfg: WeaponAsset): { group: THREE.Group; tip: THREE.Vector3 } {
  model.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
  const group = new THREE.Group();
  group.add(model);

  const box = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  box.setFromObject(group);
  group.scale.setScalar(cfg.length / (box.max.z - box.min.z));

  group.updateWorldMatrix(true, true);
  box.setFromObject(group);
  group.position.set(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    cfg.back - box.max.z,
  );
  return { group, tip: findTip(group) };
}

/** Replaces the primitive when a weapon model exists; otherwise the primitive quietly stays. */
async function loadWeapon(kind: WeaponKind): Promise<string> {
  const cfg = WEAPON_ASSETS[kind];
  let gltf;
  try {
    gltf = await gltfLoader.loadAsync(cfg.url);
  } catch {
    return `${kind}: file missing → primitive model`;
  }
  const { group, tip } = normalizeWeapon(gltf.scene, cfg);
  equipWeaponModel(kind, group, kind === 'musket' ? tip : undefined);
  const s = group.scale.x;
  return `${kind}: loaded (scale x${s.toFixed(2)} · tip z=${tip.z.toFixed(2)})`;
}

/**
 * Loads the chest and stands it on the floor at PROP_ASSETS.chest.height.
 * Rejected unless the lid node is present — a chest that cannot open is worse
 * than the primitive one, and the failure would otherwise show up only in play.
 */
async function loadChest(): Promise<string> {
  const cfg = PROP_ASSETS.chest;
  let gltf;
  try {
    gltf = await gltfLoader.loadAsync(cfg.url);
  } catch {
    return 'chest: file missing → primitive model';
  }
  const root = gltf.scene;
  if (!root.getObjectByName(cfg.lidNode)) {
    return `chest: no "${cfg.lidNode}" node to hinge → primitive model`;
  }

  const box = new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(cfg.height / (box.max.y - box.min.y));
  root.position.y = -new THREE.Box3().setFromObject(root).min.y;
  root.traverse((o) => {
    if (isMesh(o)) o.castShadow = false;
  });
  props.chest = root;
  return `chest: loaded (scale x${root.scale.x.toFixed(2)})`;
}

export async function loadAssets(onProgress: (msg: string) => void): Promise<void> {
  const log: string[] = [];

  for (const key of Object.keys(CREATURE_ASSETS) as CreatureKey[]) {
    const cfg = CREATURE_ASSETS[key];
    onProgress(`Loading creature: ${key}`);
    const base = await tryLoadModel(`${cfg.dir}/idle`);
    if (!base) {
      log.push(`${key}: file missing → primitive model`);
      continue;
    }
    const root = base.root;

    // Normalise the size — Mixamo FBX is in centimetres, so 100x too large.
    // An idle.fbx downloaded "Without Skin" carries the skeleton but no mesh. Left
    // alone, the empty Box3 gives a scale of 0 and a NaN position, and the creature
    // vanishes without a word.
    const reason = unusableReason(root);
    if (reason) {
      log.push(`${key}: ${reason} → primitive model`);
      continue;
    }
    const { height } = measure(root);
    root.scale.multiplyScalar(cfg.height / height);
    // Drop it so the feet rest on the floor at y=0.
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
    log.push(`${key}: loaded [${Object.keys(clips).join(', ')}] · ${describeSkin(root)}`);
  }

  onProgress('Loading weapons');
  for (const kind of Object.keys(WEAPON_ASSETS) as WeaponKind[]) log.push(await loadWeapon(kind));

  onProgress('Loading props');
  log.push(await loadChest());

  onProgress('Loading textures');
  pbr.wall = await loadPBR(WALL_TEX_DIR, 1.5);
  pbr.floor = await loadPBR(FLOOR_TEX_DIR, GRID * 1.2);
  log.push(`wall texture: ${pbr.wall ? 'PBR' : 'procedural'} · floor texture: ${pbr.floor ? 'PBR' : 'procedural'}`);
  console.log('[assets]\n' + log.join('\n'));
}

export interface SpawnedCreature {
  mesh: THREE.Group;
  playback: MonsterPlayback | null;
  rig: CreatureRig | null;
}

/** Clones the external model when there is one, otherwise builds the procedural box model. */
export function spawnCreature(key: CreatureKey): SpawnedCreature {
  const t = templates[key];
  if (!t) {
    const { mesh, rig } = MAKERS[key]();
    return { mesh, playback: null, rig };
  }
  const wrap = new THREE.Group();
  const model = cloneSkinned(t.root);
  // Clone the materials so the hit flash is per creature.
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
  /** false plays once and holds on the last frame. */
  loop?: boolean;
  /** Crossfade duration, in seconds. */
  fade?: number;
  /** Restart from the top even if it is the same clip — back-to-back attacks, say. */
  force?: boolean;
  /** Where to start playback, in seconds. Varied per creature so the horde does not move as one. */
  startAt?: number;
  /** Playback rate. The walk clip is retimed per frame instead; this is for one-shots. */
  speed?: number;
}

/** Does nothing when the same clip is already playing, unless force is set. */
export function setAnim(pb: MonsterPlayback, name: ClipName, opts: SetAnimOptions = {}): void {
  const { loop = true, fade = 0.15, force = false, startAt = 0, speed = 1 } = opts;
  const clip = pb.clips[name];
  if (!clip || (pb.animName === name && !force)) return;

  const a = pb.mixer.clipAction(clip);
  const prev = pb.action;
  a.reset();
  a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  a.clampWhenFinished = !loop;
  a.enabled = true;
  a.timeScale = speed;
  a.time = startAt;
  a.setEffectiveWeight(1);
  a.fadeIn(fade).play();
  // Restarting the same action must not fade that action out against itself.
  if (prev && prev !== a) prev.fadeOut(fade);
  pb.action = a;
  pb.animName = name;
}

/** Clip duration in seconds, or null when there is no such clip. */
export function clipDuration(pb: MonsterPlayback, name: ClipName): number | null {
  return pb.clips[name]?.duration ?? null;
}

/** Renders the hit flash on an external-model creature through emissive. */
export function flashLoadedMesh(mesh: THREE.Object3D, on: boolean): void {
  mesh.traverse((o) => {
    if (!isMesh(o) || !o.material) return;
    for (const m of materialsOf(o)) {
      const emissive = (m as THREE.MeshStandardMaterial).emissive;
      emissive?.setHex(on ? 0x7a1a1a : 0x000000);
    }
  });
}
