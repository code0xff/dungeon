// Poly Haven(CC0)에서 벽·바닥 PBR 텍스처와 1인칭 무기 모델을 받아 assets/ 에 넣는다.
//
//   npm run fetch-assets
//        ↓
//   assets/textures/{wall,floor}/{diffuse,normal,rough}.jpg
//   assets/weapons/{sword,musket}.glb
//
// 좀비와 달리 Poly Haven은 계정 없이 공개 API로 바로 받을 수 있어서 raw/ 원본을
// 따로 두지 않는다. 다시 받고 싶으면 아래 PICKS의 ID만 바꾸고 재실행하면 된다.
// 후보 ID는 https://polyhaven.com/textures, /models 에서 고르면 된다.
import { mkdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const TMP = join(ROOT, 'node_modules', '.cache', 'polyhaven');
const API = 'https://api.polyhaven.com';

/** 어떤 에셋을 쓸지. 여기만 고치면 된다. */
const PICKS = {
  textures: {
    // 거친 중세 석축 / 어두운 자갈 바닥.
    // castle_brick_* 계열은 붉은 벽돌이라 던전보다 굴뚝·지하실처럼 보인다.
    wall: 'medieval_blocks_05',
    floor: 'cobblestone_floor_08',
  },
  models: {
    sword: 'wooden_handle_saber',
    // 머스킷/플린트락 모델이 Poly Haven에 없어서 볼트액션 소총을 쓴다.
    // 코드상 이름은 musket 그대로다(src/scene.ts).
    musket: 'bolt_action_rifle_7_62',
  },
};

/** 받을 해상도. 던전은 어둡고 1인칭 무기도 화면을 크게 안 채워서 1K면 충분하다. */
const RES = '1k';
/** 무기 텍스처 최대 변. 손에 든 물건이라 벽보다 가깝지만 화면 점유가 작다. */
const WEAPON_TEXTURE_SIZE = 512;

/**
 * Poly Haven 텍스처 맵 이름 → 우리 파일명과 webp 품질.
 * normal은 반드시 nor_gl(OpenGL)이어야 한다. nor_dx는 요철이 뒤집힌다.
 *
 * 노멀맵 품질만 높게 주는 이유: 픽셀값이 색이 아니라 법선 벡터라
 * 압축으로 뭉개지면 빛 반사 방향이 통째로 틀어진다. 색·거칠기는
 * 조금 뭉개져도 어두운 던전에선 티가 안 난다.
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
    if (!entry) throw new Error(`${id}: ${phName} ${RES} jpg 없음`);
    const jpg = await fetchBuffer(entry.url);
    const dst = join(dir, `${name}.webp`);
    await sharp(jpg).webp({ quality }).toFile(dst);
    before += jpg.length;
    after += statSync(dst).size;
    // 예전에 jpg로 받아둔 게 있으면 치운다. 로더가 webp를 먼저 보므로
    // 그냥 두면 안 쓰는 파일이 저장소에 남는다.
    rmSync(join(dir, `${name}.jpg`), { force: true });
  }
  rmSync(join(dir, '여기에_텍스처_넣기.txt'), { force: true });
  return `${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`;
}

async function fetchModel(slot, id) {
  const files = await json(`${API}/files/${id}`);
  const entry = files.gltf?.[RES]?.gltf;
  if (!entry) throw new Error(`${id}: gltf ${RES} 없음`);

  // .gltf는 .bin과 텍스처를 상대경로로 참조한다. 통째로 받아야 읽힌다.
  const work = join(TMP, id);
  rmSync(work, { recursive: true, force: true });
  const gltfPath = join(work, `${id}.gltf`);
  await download(entry.url, gltfPath);
  for (const [rel, inc] of Object.entries(entry.include ?? {})) {
    await download(inc.url, join(work, rel));
  }

  const doc = await io.read(gltfPath);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [WEAPON_TEXTURE_SIZE, WEAPON_TEXTURE_SIZE] }),
    dedup(),
    prune(),
  );

  const dst = join(ROOT, 'assets', 'weapons', `${slot}.glb`);
  mkdirSync(dirname(dst), { recursive: true });
  await io.write(dst, doc);
  rmSync(work, { recursive: true, force: true });

  const before = Object.values(entry.include ?? {}).reduce((n, i) => n + i.size, entry.size);
  return `${Math.round(before / 1024)}KB → ${kb(dst)}KB`;
}

for (const [slot, id] of Object.entries(PICKS.textures)) {
  console.log(`[텍스처] ${slot.padEnd(6)} ${id.padEnd(24)} ${await fetchTexture(slot, id)}`);
}
for (const [slot, id] of Object.entries(PICKS.models)) {
  console.log(`[모델]   ${slot.padEnd(6)} ${id.padEnd(24)} ${await fetchModel(slot, id)}`);
}
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
console.log('\n완료. 라이선스: Poly Haven CC0 (출처 표기 불필요, 재배포·상업 이용 가능)');
