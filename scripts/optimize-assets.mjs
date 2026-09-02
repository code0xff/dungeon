// raw/ 의 FBX 원본을 assets/ 의 GLB로 변환한다.
//
//   raw/creatures/<key>/{idle,walk,attack,death}.fbx   (원본, 서빙 안 됨)
//        ↓  npm run optimize-assets
//   assets/creatures/<key>/{idle,walk,attack,death}.glb
//
// idle 만 메시와 텍스처를 갖고, 나머지 셋은 애니메이션 커브만 남긴다.
// 게임 코드가 walk/attack/death에서 animations[0] 말고는 아무것도 안 쓰기 때문이다
// (src/assets.ts 의 loadAssets 참고). Mixamo의 "Without Skin" 다운로드를
// 받아온 파일에 직접 적용하는 셈이다.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

// FBX2glTF를 쓰는 이유: assimp는 FBX 피벗을 _$AssimpFbx$_Rotation 같은 헬퍼 노드로
// 쪼개서 내보내는데, 그러면 애니메이션 트랙이 실제 뼈가 아니라 헬퍼를 가리켜서
// 클립을 모델에 붙일 수 없다(156트랙 중 12개만 일치). FBX2glTF는 피벗을 뼈에 굽는다.
const fbx2gltf = createRequire(import.meta.url)('fbx2gltf');

const ROOT = resolve(import.meta.dirname, '..');
const RAW = join(ROOT, 'raw', 'creatures');
const OUT = join(ROOT, 'assets', 'creatures');
const TMP = join(ROOT, 'node_modules', '.cache', 'asset-opt');

/** 모델을 들고 있는 클립. 나머지는 애니메이션만 남긴다. */
const MODEL_CLIP = 'idle';
/** 텍스처 최대 변. 어두운 던전에서 화면상 300px 남짓이라 1K면 충분하다. */
const TEXTURE_SIZE = 1024;
/**
 * 살갗·천은 금속이 아니다. 그런데 FBX2glTF는 Phong의 specular 맵을
 * metallicRoughness 텍스처로 옮기고 metallicFactor를 glTF 기본값 1.0으로 둔다.
 * 그대로 두면 좀비 피부가 metalness 0.4로 잡혀 횃불빛에 금속처럼 번들거린다.
 */
const ROUGHNESS = 0.85;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const mb = (p) => (statSync(p).size / 1048576).toFixed(1);

/** FBX → GLB. 임베드 텍스처도 같이 넘어온다. */
async function fbxToGlb(src, dst) {
  await fbx2gltf(src, dst, ['--binary']);
}

/** 금속기를 걷어내고 거칠기를 고정한다. 쓰지 않게 된 ORM 텍스처는 prune이 치운다. */
function deMetallize(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(ROUGHNESS);
    mat.setMetallicRoughnessTexture(null);
  }
}

/** 애니메이션 커브만 남기고 메시·스킨·머티리얼·텍스처를 버린다. */
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
    // 키프레임을 곡선 단위로 줄인다. 모션 자체는 그대로다.
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
  // prune은 위 정리 뒤에 남은 고아 데이터를 걷어낸다.
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
  console.error(`원본이 없다: ${RAW}`);
  process.exit(1);
}

let totalBefore = 0, totalAfter = 0;
for (const key of keys) {
  console.log(`\n[${key}]`);
  for (const clip of ['idle', 'walk', 'attack', 'death']) {
    const r = await convert(key, clip);
    if (!r) { console.log(`  ${clip.padEnd(7)} 없음`); continue; }
    totalBefore += r.before;
    totalAfter += r.after;
    const pct = ((1 - r.after / r.before) * 100).toFixed(0);
    console.log(`  ${r.clip.padEnd(7)} ${String(r.before).padStart(6)} MB → ${String(r.after).padStart(6)} MB  (-${pct}%)`);
  }
}
console.log(`\n합계 ${totalBefore.toFixed(1)} MB → ${totalAfter.toFixed(1)} MB  (-${((1 - totalAfter / totalBefore) * 100).toFixed(0)}%)`);
