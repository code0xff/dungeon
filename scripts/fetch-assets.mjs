// Pulls wall and floor PBR textures plus the first-person weapon models from
// Poly Haven (CC0) into assets/.
//
//   npm run fetch-assets
//        |
//   assets/textures/{wall,floor}/{diffuse,normal,rough}.webp
//   assets/weapons/{sword,musket}.glb
//   assets/props/{chest,lantern}.glb
//
// Unlike the zombie, Poly Haven serves these through a public API with no account,
// so no copy is kept under raw/. To swap an asset, change its id in PICKS below and
// run this again. Browse candidates at https://polyhaven.com/textures and /models.
import { mkdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const TMP = join(ROOT, 'node_modules', '.cache', 'polyhaven');
const API = 'https://api.polyhaven.com';

/** Which assets to use. This is the only place to edit. */
const PICKS = {
  textures: {
    // Rough medieval stonework over dark cobbles.
    // The castle_brick_* family is red brick, which reads as a basement or a
    // chimney flue rather than a dungeon.
    wall: 'medieval_blocks_05',
    floor: 'cobblestone_floor_08',
  },
  // dir is where the GLB lands under assets/; texture is the longest edge to
  // re-bake at; simplify keeps that fraction of the triangles (omit to keep all).
  models: {
    // Poly Haven's only broad blade. antique_estoc has a far better hilt but its
    // blade is a thrusting needle, which reads as thinner still in the hand.
    sword: { id: 'wooden_handle_saber', dir: 'weapons', texture: 512 },
    // Poly Haven has no musket or flintlock, so a bolt-action rifle stands in.
    // The name stays `musket` throughout the code (see src/scene.ts).
    musket: { id: 'bolt_action_rifle_7_62', dir: 'weapons', texture: 512 },
    // The lid is its own node, so the open animation still has a hinge to turn.
    // Ten chests are in the dungeon at once and the source is 68k triangles, so
    // this one is decimated hard; at torchlight range the loss does not show.
    chest: { id: 'treasure_chest', dir: 'props', texture: 512, simplify: 0.2 },
    // Held in the left hand. Poly Haven has no medieval torch, and a lantern
    // with fuel suits a light source that burns down anyway. Decimated less
    // hard than the chest because it is held close to the camera.
    lantern: { id: 'Lantern_01', dir: 'props', texture: 512, simplify: 0.4 },
  },
};

/** Resolution to fetch. The dungeon is dark and even a held weapon covers little screen, so 1K suffices. */
const RES = '1k';

/**
 * Poly Haven map names mapped to our filenames and webp quality.
 * The normal must be nor_gl (OpenGL); nor_dx inverts the relief.
 *
 * Only the normal map gets the higher quality: its pixels are vectors, not colour,
 * so anything compression smears turns the lighting the wrong way. Colour and
 * roughness can smear a little and go unnoticed in a dark dungeon.
 */
const TEXTURE_MAPS = {
  Diffuse: { name: 'diffuse', quality: 80 },
  nor_gl: { name: 'normal', quality: 90 },
  Rough: { name: 'rough', quality: 80 },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const kb = (p) => Math.round(statSync(p).size / 1024);

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function download(url, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, await fetchBuffer(url));
}

async function fetchTexture(slot, id) {
  const files = await json(`${API}/files/${id}`);
  const dir = join(ROOT, 'assets', 'textures', slot);
  mkdirSync(dir, { recursive: true });

  let before = 0, after = 0;
  for (const [phName, { name, quality }] of Object.entries(TEXTURE_MAPS)) {
    const entry = files[phName]?.[RES]?.jpg;
    if (!entry) throw new Error(`${id}: no ${phName} ${RES} jpg`);
    const jpg = await fetchBuffer(entry.url);
    const dst = join(dir, `${name}.webp`);
    await sharp(jpg).webp({ quality }).toFile(dst);
    before += jpg.length;
    after += statSync(dst).size;
    // Clear out any jpg fetched by an earlier run. The loader looks for webp
    // first, so leaving it behind only parks a dead file in the repository.
    rmSync(join(dir, `${name}.jpg`), { force: true });
  }
  rmSync(join(dir, 'PUT_TEXTURES_HERE.txt'), { force: true });
  return `${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`;
}

async function fetchModel(slot, { id, dir, texture, simplify: ratio }) {
  const files = await json(`${API}/files/${id}`);
  const entry = files.gltf?.[RES]?.gltf;
  if (!entry) throw new Error(`${id}: no gltf at ${RES}`);

  // A .gltf references its .bin and textures by relative path, so fetch the lot.
  const work = join(TMP, id);
  rmSync(work, { recursive: true, force: true });
  const gltfPath = join(work, `${id}.gltf`);
  await download(entry.url, gltfPath);
  for (const [rel, inc] of Object.entries(entry.include ?? {})) {
    await download(inc.url, join(work, rel));
  }

  const doc = await io.read(gltfPath);
  const steps = [
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texture, texture] }),
    dedup(),
  ];
  // weld() first: simplify needs shared vertices to collapse edges across, and
  // these exports duplicate them along every UV and normal seam.
  if (ratio) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
  steps.push(prune());
  await doc.transform(...steps);

  const dst = join(ROOT, 'assets', dir, `${slot}.glb`);
  mkdirSync(dirname(dst), { recursive: true });
  await io.write(dst, doc);
  rmSync(work, { recursive: true, force: true });

  const before = Object.values(entry.include ?? {}).reduce((n, i) => n + i.size, entry.size);
  return `${Math.round(before / 1024)}KB → ${kb(dst)}KB`;
}

for (const [slot, id] of Object.entries(PICKS.textures)) {
  console.log(`[texture] ${slot.padEnd(6)} ${id.padEnd(24)} ${await fetchTexture(slot, id)}`);
}
for (const [slot, pick] of Object.entries(PICKS.models)) {
  console.log(`[model]   ${slot.padEnd(6)} ${pick.id.padEnd(24)} ${await fetchModel(slot, pick)}`);
}
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
console.log('\nDone. Licence: Poly Haven CC0 — no attribution required, redistribution and commercial use allowed.');
