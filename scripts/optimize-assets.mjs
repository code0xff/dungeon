// Converts the FBX sources in raw/ into GLB files under assets/.
//
//   raw/creatures/<key>/{idle,walk,attack,death}.fbx   (sources, never served)
//        |  npm run optimize-assets
//   assets/creatures/<key>/{idle,walk,attack,death}.glb
//
// Only idle keeps its mesh and textures; the other three are stripped to animation
// curves, because the game reads nothing but animations[0] out of walk, attack and
// death (see loadAssets in src/assets.ts). It amounts to applying Mixamo's
// "Without Skin" option after the fact.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

// Why FBX2glTF and not assimp: assimp splits FBX pivots into helper nodes named
// like _$AssimpFbx$_Rotation, which leaves the animation tracks pointing at helpers
// instead of real bones, so no clip can bind to the model — 12 of 156 tracks
// matched. FBX2glTF bakes the pivots into the bones.
const fbx2gltf = createRequire(import.meta.url)('fbx2gltf');

const ROOT = resolve(import.meta.dirname, '..');
const RAW = join(ROOT, 'raw', 'creatures');
const OUT = join(ROOT, 'assets', 'creatures');
const TMP = join(ROOT, 'node_modules', '.cache', 'asset-opt');

/** The clip that carries the model. The rest keep animation only. */
const MODEL_CLIP = 'idle';
/** Longest texture edge. About 300px on screen in a dark dungeon, so 1K is plenty. */
const TEXTURE_SIZE = 1024;
/**
 * Skin and cloth are not metal. But FBX2glTF moves the Phong specular map into a
 * metallicRoughness texture and leaves metallicFactor at the glTF default of 1.0.
 * Untouched, zombie skin reads as metalness 0.4 and glints like metal in torchlight.
 */
const ROUGHNESS = 0.85;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const mb = (p) => (statSync(p).size / 1048576).toFixed(1);

/** FBX to GLB. Embedded textures come across too. */
async function fbxToGlb(src, dst) {
  await fbx2gltf(src, dst, ['--binary']);
}

/** Strips the metalness and pins the roughness. prune clears the now-unused ORM texture. */
function deMetallize(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(ROUGHNESS);
    mat.setMetallicRoughnessTexture(null);
  }
}

/** Keeps the animation curves and discards meshes, skins, materials and textures. */
function stripToAnimation(doc) {
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const list of [root.listMeshes(), root.listSkins(), root.listMaterials(), root.listTextures()]) {
    for (const item of list) item.dispose();
  }
}

async function convert(key, clip) {
  const src = join(RAW, key, `${clip}.fbx`);
  if (!existsSync(src)) return null;

  mkdirSync(TMP, { recursive: true });
  const tmp = join(TMP, `${key}-${clip}.glb`);
  await fbxToGlb(src, tmp);

  const doc = await io.read(tmp);
  const transforms = [
    // Thins keyframes curve by curve. The motion itself is unchanged.
    resample(),
    dedup(),
  ];

  if (clip === MODEL_CLIP) {
    deMetallize(doc);
    transforms.push(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
    );
  } else {
    stripToAnimation(doc);
  }
  // prune sweeps up whatever the steps above orphaned.
  transforms.push(prune());
  await doc.transform(...transforms);

  const out = join(OUT, key, `${clip}.glb`);
  mkdirSync(join(OUT, key), { recursive: true });
  await io.write(out, doc);
  rmSync(tmp, { force: true });

  return { clip, before: +mb(src), after: +mb(out) };
}

const keys = existsSync(RAW) ? readdirSync(RAW).filter((d) => statSync(join(RAW, d)).isDirectory()) : [];
if (!keys.length) {
  console.error(`no sources found: ${RAW}`);
  process.exit(1);
}

let totalBefore = 0, totalAfter = 0;
for (const key of keys) {
  console.log(`\n[${key}]`);
  for (const clip of ['idle', 'walk', 'attack', 'death']) {
    const r = await convert(key, clip);
    if (!r) { console.log(`  ${clip.padEnd(7)} missing`); continue; }
    totalBefore += r.before;
    totalAfter += r.after;
    const pct = ((1 - r.after / r.before) * 100).toFixed(0);
    console.log(`  ${r.clip.padEnd(7)} ${String(r.before).padStart(6)} MB → ${String(r.after).padStart(6)} MB  (-${pct}%)`);
  }
}
console.log(`\ntotal ${totalBefore.toFixed(1)} MB -> ${totalAfter.toFixed(1)} MB  (-${((1 - totalAfter / totalBefore) * 100).toFixed(0)}%)`);
