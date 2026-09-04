import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  CLIP_NAMES, CREATURE_ASSETS, ENV_INTENSITY, FLOOR_TEX_DIR, PROP_ASSETS, WALL_TEX_DIR,
  WEAPON_ASSETS,
} from './config';
import { MAKERS } from './creatures';
import { envMap, equipLantern, equipWeaponModel } from './scene';
import type {
  ClipName, Clips, CreatureKey, CreatureRig, CreatureTemplate, MonsterPlayback, PBRMaps, WeaponAsset, WeaponKind,
} from './types';

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function materialsOf(o: THREE.Mesh): THREE.Material[] {
  return Array.isArray(o.material) ? o.material : [o.material];
}

/**
 * Stamps the asset version onto a URL.
 *
 * Model and texture filenames are fixed — `creatures/brute/idle.glb` is the same
 * URL before and after the model behind it is replaced — so a returning player's
 * service worker answered from its cache and the swap never reached them. It did
 * not fail loudly either: an idle.glb without a mesh reports `no mesh` and drops
 * to the box model, which reads as a regression rather than a stale cache.
 *
 * The version is a hash of assets/ computed at build time, so it only moves when
 * an asset actually does. See hashAssets() in vite.config.ts.
 */
function versioned(url: string): string {
  return `${url}?v=${__ASSET_VERSION__}`;
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
        const r = await fbxLoader.loadAsync(versioned(url));
        return { root: r, animations: r.animations };
      }
      const r = await gltfLoader.loadAsync(versioned(url));
      return { root: r.scene, animations: r.animations };
    } catch {
      // Try the next extension
    }
  }
  return null;
}

async function tryLoadTexture(url: string, srgb = false): Promise<THREE.Texture | null> {
  try {
    const t = await texLoader.loadAsync(versioned(url));
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
 * Mixamo numbers the rig per export: the zombie's bones are `mixamorig5:Hips`
 * while the brute's clips target `mixamorig:Hips`. Same skeleton, same 52 bones,
 * different namespace.
 *
 * three binds animation tracks to nodes **by name**, and a track that resolves to
 * nothing is skipped without a word — the creature simply stands in its bind pose
 * while the mixer reports a happily playing action. Measured with the brute clips
 * on the zombie skeleton: 0 of 53 tracks bound before this, 53 of 53 after.
 *
 * The colon is optional in the pattern because GLTFLoader runs node names through
 * PropertyBinding.sanitizeNodeName, which strips `.:/[]` — so the same bone is
 * `mixamorig5:Hips` out of an FBX and `mixamorig5Hips` out of a GLB. Dropping the
 * number from both forms puts every Mixamo asset here in one namespace, and any
 * clip then binds to any body.
 */
const MIXAMO_NS = /mixamorig\d*:?/g;

function normalizeBoneNames(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.name = o.name.replace(MIXAMO_NS, 'mixamorig');
  });
}

function normalizeTrackNames(clip: THREE.AnimationClip): void {
  for (const track of clip.tracks) track.name = track.name.replace(MIXAMO_NS, 'mixamorig');
}

/**
 * How many of a clip's tracks name a node that exists on the model.
 *
 * Reported per creature because a mismatched rig is invisible otherwise: the
 * animation plays, nothing moves, and there is no error to search for.
 */
function bindableTracks(root: THREE.Object3D, clip: THREE.AnimationClip): { hit: number; total: number } {
  const names = new Set<string>();
  root.traverse((o) => names.add(o.name));
  let hit = 0;
  for (const track of clip.tracks) {
    // Track names are "<node>.<property>", and the node part may itself be a path.
    const node = track.name.slice(0, track.name.lastIndexOf('.'));
    if (names.has(node.slice(node.lastIndexOf('/') + 1))) hit++;
  }
  return { hit, total: clip.tracks.length };
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
    gltf = await gltfLoader.loadAsync(versioned(cfg.url));
  } catch {
    return `${kind}: file missing → primitive model`;
  }
  const { group, tip } = normalizeWeapon(gltf.scene, cfg);
  applyEnvMap(group);
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
    gltf = await gltfLoader.loadAsync(versioned(cfg.url));
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
  applyEnvMap(root);
  props.chest = root;
  return `chest: loaded (scale x${root.scale.x.toFixed(2)})`;
}

/**
 * Loads the lantern into the player's left hand, scaled to PROP_ASSETS.lantern.height
 * and stood on its own base so the hand position in scene.ts means the same thing
 * whatever model is swapped in. No fallback: the primitive it replaced looked worse
 * than an empty hand, and the light works either way.
 */
async function loadLantern(): Promise<string> {
  const cfg = PROP_ASSETS.lantern;
  let gltf;
  try {
    gltf = await gltfLoader.loadAsync(versioned(cfg.url));
  } catch {
    return 'lantern: file missing → nothing drawn in hand (the light still works)';
  }
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(cfg.height / (box.max.y - box.min.y));
  root.position.y = -new THREE.Box3().setFromObject(root).min.y;

  // The player's light sits at their centre, not inside the lantern, so without
  // this the thing lighting the dungeon reads as a cold lump of brass.
  root.traverse((o) => {
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      if (!/glass/i.test(m.name)) continue;
      const s = m as THREE.MeshStandardMaterial;
      s.emissive = new THREE.Color(0xffa542);
      s.emissiveIntensity = 1.6;
      s.transparent = true;
      s.opacity = 0.85;
    }
  });
  applyEnvMap(root);
  equipLantern(root);
  return `lantern: loaded (scale x${root.scale.x.toFixed(2)})`;
}

/**
 * Gives a loaded model something to reflect.
 *
 * Applied per material rather than through `scene.environment`, which would also
 * light every wall and creature diffusely and lift the dungeon out of the dark.
 * See buildEnvironment() in scene.ts for why metal needs this at all.
 */
function applyEnvMap(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!isMesh(o) || !o.material) return;
    for (const m of materialsOf(o)) {
      const std = m as THREE.MeshStandardMaterial;
      if (!('envMapIntensity' in std)) continue;
      std.envMap = envMap;
      std.envMapIntensity = ENV_INTENSITY;
      std.needsUpdate = true;
    }
  });
}

/** Stands a model on the floor at the given height, whatever transform it arrives with. */
function fitToHeight(root: THREE.Object3D, height: number): void {
  // measure() reads world matrices, so the transform has to be identity first or
  // whatever the file arrived with is folded into the result.
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.scale.setScalar(height / measure(root).height);
  // Drop it so the feet rest on the floor at y=0.
  root.position.y = -measure(root).minY;
}

/** Loads one creature into `templates`, returning the line for the [assets] log. */
async function loadCreature(key: CreatureKey): Promise<string> {
  const cfg = CREATURE_ASSETS[key];
  const base = await tryLoadModel(`${cfg.dir}/idle`);
  if (!base) return `${key}: file missing → primitive model`;

  // Every clip is a separate download, idle included — it is the one that also
  // carries the body.
  const clips: Clips = {};
  if (base.animations[0]) clips.idle = base.animations[0];
  for (const name of CLIP_NAMES.slice(1) as ClipName[]) {
    const r = await tryLoadModel(`${cfg.dir}/${name}`);
    if (r?.animations[0]) clips[name] = r.animations[0];
  }
  for (const clip of Object.values(clips)) normalizeTrackNames(clip);

  const root = base.root;
  normalizeBoneNames(root);

  // Normalise the size — Mixamo FBX is in centimetres, so 100x too large.
  // An idle.fbx downloaded "Without Skin" carries the skeleton but no mesh. Left
  // alone, the empty Box3 gives a scale of 0 and a NaN position, and the creature
  // vanishes without a word.
  const reason = unusableReason(root);
  if (reason) return `${key}: ${reason} → primitive model`;
  fitToHeight(root, cfg.height);
  root.traverse((o) => {
    if (isMesh(o)) {
      o.frustumCulled = false;
      o.castShadow = false;
    }
  });

  // Named in the log because a clip with root motion is a download mistake the
  // player would otherwise only see as a creature walking through a wall.
  const drift = new Map<ClipName, number>();
  for (const [name, clip] of Object.entries(clips) as [ClipName, THREE.AnimationClip][]) {
    drift.set(name, stripRootMotion(clip));
  }
  const stripped = [...drift].filter(([, d]) => d > 0.05).map(([n, d]) => `${n} ${d.toFixed(2)}m`);

  // How fast the walk was authored to travel. Measuring it beats guessing: the
  // hand-set constant said 1.45 m/s where this clip is a 0.35 m/s shamble, and
  // the retiming that stops the feet sliding depends on getting it right.
  const walkDrift = drift.get('walk') ?? 0;
  const walkDur = clips.walk?.duration ?? 0;
  const walkClipSpeed = walkDrift > 0.05 && walkDur > 0 ? walkDrift / walkDur : null;

  templates[key] = { root, clips, walkClipSpeed };

  // Worst binding rate across the clips. Anything under 100% means this body and
  // these clips came off different rigs, and the creature will barely move.
  const bind = Object.values(clips).map((c) => bindableTracks(root, c));
  const worst = bind.reduce((a, b) => (a.hit / a.total <= b.hit / b.total ? a : b), bind[0]);
  const bindNote = worst && worst.hit < worst.total ? ` · ⚠ only ${worst.hit}/${worst.total} tracks bind` : '';

  const note = bindNote
    + (stripped.length ? ` · root motion removed: ${stripped.join(', ')}` : '')
    + (walkClipSpeed ? ` · walk authored at ${walkClipSpeed.toFixed(2)}m/s` : '');
  return `${key}: loaded [${Object.keys(clips).join(', ')}] · ${describeSkin(root)}${note}`;
}

export async function loadAssets(onProgress: (msg: string) => void): Promise<void> {
  const log: string[] = [];

  // In declaration order, because a creature may borrow an earlier one's skin.
  for (const key of Object.keys(CREATURE_ASSETS) as CreatureKey[]) {
    onProgress(`Loading creature: ${key}`);
    log.push(await loadCreature(key));
  }

  onProgress('Loading weapons');
  for (const kind of Object.keys(WEAPON_ASSETS) as WeaponKind[]) log.push(await loadWeapon(kind));

  onProgress('Loading props');
  log.push(await loadChest());
  log.push(await loadLantern());

  onProgress('Loading textures');
  pbr.wall = await loadPBR(WALL_TEX_DIR, 1.5);
  // The repeat is overwritten per dungeon in buildGeometry(); this is only a
  // sane starting value for maps that are never drawn before the first build.
  pbr.floor = await loadPBR(FLOOR_TEX_DIR, 1);
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
    playback: {
      mixer: new THREE.AnimationMixer(model),
      clips: t.clips,
      action: null,
      animName: null,
      walkClipSpeed: t.walkClipSpeed,
    },
    rig: null,
  };
}

/**
 * Flattens the horizontal root motion out of a clip, returning how much it took
 * out in metres.
 *
 * Mixamo's walk is only in place if "In Place" was ticked at download time, and
 * this one was not: the hips travelled 1.38m across the cycle and snapped back.
 * That carries the whole body out of its collision circle and through walls,
 * because collision only ever tests the group's position.
 *
 * The rule this enforces is that the game owns where a creature is and the clip
 * owns only how it is posed. Y is left alone so the body still rises and falls.
 */
function stripRootMotion(clip: THREE.AnimationClip): number {
  let drift = 0;
  for (const track of clip.tracks) {
    if (!/(hips|root)\.position$/i.test(track.name)) continue;
    const v = track.values;
    const [x0, , z0] = [v[0] ?? 0, 0, v[2] ?? 0];
    for (let i = 0; i < v.length; i += 3) {
      drift = Math.max(drift, Math.hypot((v[i] ?? 0) - x0, (v[i + 2] ?? 0) - z0));
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return drift;
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
