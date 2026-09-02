import * as THREE from 'three';
import { FOG_BASE, WALL_H } from './config';
import { el } from './dom';
import type { WeaponKind } from './types';

// ================= 렌더러 / 씬 / 카메라 =================
export const scene = new THREE.Scene();
// 배경은 scene.background가 아니라 렌더러 clearColor로 준다.
// scene.background가 Color면 three가 render()마다 forceClear를 켜서
// autoClear=false를 무시하고 컬러 버퍼를 지운다 → 2패스(무기)가 월드를 통째로
// 지워버려 검만 보이게 된다. clearColor는 renderFrame() 맨 앞의 clear()에서만 적용된다.

/** scene.fog를 매번 좁히지 않아도 되게 구체 타입으로 들고 있는다. */
export const fog = new THREE.FogExp2(0x020304, FOG_BASE);
scene.fog = fog;

export const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 60);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x020304, 1);
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
// 무기를 2패스로 따로 그리므로 자동 clear를 끈다.
renderer.autoClear = false;
el('game').appendChild(renderer.domElement);

export const canvasEl = renderer.domElement;

// ================= 조명 =================
const ambient = new THREE.AmbientLight(0x141820, 0.55);
ambient.layers.enable(1);
scene.add(ambient);

/** 플레이어를 따라다니는 횃불. */
export const torch = new THREE.PointLight(0xff7428, 1.9, 11, 2.0);
torch.layers.enable(1);
scene.add(torch);

// ================= 탈출 포탈 =================
export const portalLight = new THREE.PointLight(0x3a6fd0, 2.0, 14, 1.6);
portalLight.layers.enable(1);
scene.add(portalLight);

export const portal = new THREE.Mesh(
  new THREE.TorusGeometry(1.1, 0.12, 12, 40),
  new THREE.MeshStandardMaterial({ color: 0x101a2a, emissive: 0x3a7fe0, emissiveIntensity: 1.3 }),
);
scene.add(portal);

export const portalCore = new THREE.Mesh(
  new THREE.CircleGeometry(0.95, 28),
  new THREE.MeshBasicMaterial({ color: 0x1c4a9a, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
);
scene.add(portalCore);

// ================= 1인칭 장비 =================
// ---- 검 (오른손) ----
export const sword = new THREE.Group();
/** 외부 모델이 없을 때 쓰는 프리미티브 검. 모델이 들어오면 통째로 교체된다. */
const swordFallback = new THREE.Group();
{
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.95), new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.85, roughness: 0.35 }));
  blade.position.z = -0.6;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.95), new THREE.MeshStandardMaterial({ color: 0xb0b5c0, metalness: 0.9, roughness: 0.2 }));
  edge.position.z = -0.6;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0x4a4a4e, metalness: 0.7, roughness: 0.4 }));
  guard.position.z = -0.12;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }));
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.02;
  swordFallback.add(blade, edge, guard, grip);
}
sword.add(swordFallback);
/** 검의 기본 자세. 휘두른 뒤 여기로 되돌린다. */
export const SWORD_REST = { pos: new THREE.Vector3(0.29, -0.2, -0.42), rot: new THREE.Euler(0.18, -0.26, 0.22) };
sword.position.copy(SWORD_REST.pos);
sword.rotation.copy(SWORD_REST.rot);
camera.add(sword);

// ---- 횃불 (왼손, 획득 시 표시) ----
export const handTorch = new THREE.Group();
{
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1 }));
  stick.position.y = -0.1;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 1 }));
  head.position.y = 0.14;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 7), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
  flame.position.y = 0.29;
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 6), new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.9 }));
  flameCore.position.y = 0.28;
  handTorch.add(stick, head, flame, flameCore);
}
handTorch.position.set(-0.34, -0.32, -0.45);
handTorch.rotation.set(0.25, 0, 0.2);
handTorch.visible = false;
camera.add(handTorch);

// ---- 머스킷 (오른손, 획득 후 전환 시 표시) ----
export const musket = new THREE.Group();
/** 외부 모델이 없을 때 쓰는 프리미티브 머스킷. */
const musketFallback = new THREE.Group();
{
  const woodM = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
  const steelM = new THREE.MeshStandardMaterial({ color: 0x5a5e66, metalness: 0.85, roughness: 0.35 });
  const brassM = new THREE.MeshStandardMaterial({ color: 0x9a7a3a, metalness: 0.8, roughness: 0.4 });

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.15, 10), steelM);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.62);
  const forestock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.85), woodM);
  forestock.position.set(0, -0.01, -0.5);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.42), woodM);
  stock.position.set(0, -0.06, 0.12);
  stock.rotation.x = -0.18;
  const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.14), brassM);
  lockPlate.position.set(0.035, 0.02, -0.05);
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.03), steelM);
  hammer.position.set(0.04, 0.08, -0.03);
  hammer.rotation.x = -0.6;
  const band1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), brassM);
  band1.rotation.x = Math.PI / 2;
  band1.position.set(0, 0.01, -0.6);
  const band2 = band1.clone();
  band2.position.z = -0.88;
  musketFallback.add(barrel, forestock, stock, lockPlate, hammer, band1, band2);
}
musket.add(musketFallback);
/** 머스킷의 기본 자세. 장전 시 y, 반동 시 z·rotation.x가 여기서 벗어난다. */
export const MUSKET_REST = { x: 0.2, y: -0.3, z: -0.26, rotX: 0.03 };
musket.position.set(MUSKET_REST.x, MUSKET_REST.y, MUSKET_REST.z);
musket.rotation.set(MUSKET_REST.rotX, -0.13, 0.05);
musket.visible = false;

export const muzzleFlash = new THREE.Mesh(
  new THREE.ConeGeometry(0.09, 0.3, 7),
  new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.95 }),
);
muzzleFlash.rotation.x = -Math.PI / 2;
muzzleFlash.position.set(0, 0.03, -1.3);
muzzleFlash.visible = false;
musket.add(muzzleFlash);

export const smoke = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0x8a8a90, transparent: true, opacity: 0 }),
);
/** 연기의 총구 기준 y 위치. 퍼져 올라간 뒤 여기로 되돌린다. 모델을 갈아끼우면 총구 높이에 맞춰 갱신된다. */
export let SMOKE_REST_Y = 0.03;
smoke.position.set(0, SMOKE_REST_Y, -1.25);
musket.add(smoke);

export const flashLight = new THREE.PointLight(0xffc060, 0, 12, 1.5);
flashLight.layers.enable(1);
scene.add(flashLight);
camera.add(musket);

// 무기는 레이어 1: 월드 위에 별도 패스로 그려서 벽을 뚫지 않게 한다.
sword.traverse((o) => o.layers.set(1));
musket.traverse((o) => o.layers.set(1));

/**
 * 프리미티브 무기를 외부 모델로 갈아끼운다.
 *
 * 휘두르기·반동 애니메이션은 바깥 그룹(sword/musket)의 position·rotation만
 * 건드리므로 안쪽 내용물만 바꾸면 그대로 동작한다. 총구 화염과 연기도
 * musket의 자식이라 살아남고, muzzle을 주면 새 총구 위치로 옮겨진다.
 */
export function equipWeaponModel(kind: WeaponKind, model: THREE.Object3D, muzzle?: THREE.Vector3): void {
  const group = kind === 'sword' ? sword : musket;
  group.remove(kind === 'sword' ? swordFallback : musketFallback);
  group.add(model);
  model.traverse((o) => {
    o.layers.set(1);
    // 카메라 자식이라 컬링 판정이 어긋나기 쉽다. 무기는 항상 화면 안이니 끈다.
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
  });
  if (!muzzle) return;
  SMOKE_REST_Y = muzzle.y;
  muzzleFlash.position.set(muzzle.x, muzzle.y, muzzle.z - 0.12);
  smoke.position.set(muzzle.x, muzzle.y, muzzle.z - 0.06);
}
scene.add(camera);

// ================= 떠다니는 먼지 =================
export const DUST = 280;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 14;
  dustPos[i * 3 + 1] = Math.random() * WALL_H;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 14;
}
export const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xb8a888, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false })));

// ================= 월드 지오메트리 (buildWorld가 교체) =================
export const world: {
  wall: THREE.InstancedMesh | null;
  floor: THREE.Mesh | null;
  ceil: THREE.Mesh | null;
} = { wall: null, floor: null, ceil: null };

/** 월드(레이어 0) → 깊이 초기화 → 무기(레이어 1) 순서로 두 번 그린다. */
export function renderFrame(): void {
  renderer.clear();
  camera.layers.set(0);
  renderer.render(scene, camera);
  renderer.clearDepth();
  camera.layers.set(1);
  renderer.render(scene, camera);
  camera.layers.set(0);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
