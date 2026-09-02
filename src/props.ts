import * as THREE from 'three';
import { WALL_H } from './config';
import { ironMat } from './creatures';
import { chestTex } from './textures';
import type { Chest, Prop, Sconce } from './types';

const boneMat = new THREE.MeshStandardMaterial({ color: 0x9a917c, roughness: 1 });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 1 });
const puddleMat = new THREE.MeshStandardMaterial({ color: 0x04060a, metalness: 0.95, roughness: 0.12 });

// ---- 상자 ----
/** 보물 상자. 뚜껑 피벗을 함께 돌려줘서 여는 애니메이션이 잡을 수 있게 한다. */
export function createChest(value: number): Omit<Chest, 'item'> {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ map: chestTex, roughness: 0.9 });
  const im = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.75, roughness: 0.45 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.55), woodMat);
  base.position.y = 0.225;

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.45, -0.285);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.22, 0.57), woodMat);
  lid.position.set(0, 0.11, 0.285);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.07, 0.6), im);
  band.position.set(0, 0.11, 0.285);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), im);
  lock.position.set(0, 0.02, 0.58);
  lidPivot.add(lid, band, lock);

  const gold = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.14, 0.38),
    new THREE.MeshStandardMaterial({ color: 0xd8a832, metalness: 0.9, roughness: 0.3, emissive: 0x2a1c00 }),
  );
  gold.position.y = 0.46;

  g.add(base, lidPivot, gold);
  return { mesh: g, lid: lidPivot, value, state: 'closed', openT: 0 };
}

// ---- 소품 ----
function makeSkull(): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), boneMat);
  s.position.y = 0.13;
  s.scale.z = 1.15;
  const j = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.12), boneMat);
  j.position.set(0, 0.05, 0.06);
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), dark);
  e1.position.set(-0.05, 0.15, 0.13);
  const e2 = e1.clone();
  e2.position.x = 0.05;
  g.add(s, j, e1, e2);
  g.rotation.y = Math.random() * 6.3;
  return g;
}

function makeBonePile(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4 + ((Math.random() * 3) | 0); i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.35 + Math.random() * 0.4), boneMat);
    b.position.set((Math.random() - 0.5) * 0.6, 0.03, (Math.random() - 0.5) * 0.6);
    b.rotation.y = Math.random() * 6.3;
    g.add(b);
  }
  if (Math.random() < 0.7) {
    const sk = makeSkull();
    sk.position.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
    g.add(sk);
  }
  return g;
}

function makeRubble(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3 + ((Math.random() * 4) | 0); i++) {
    const s = 0.12 + Math.random() * 0.28;
    const r = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s * 0.8), stoneMat);
    r.position.set((Math.random() - 0.5) * 0.9, s * 0.25, (Math.random() - 0.5) * 0.9);
    r.rotation.set(Math.random() * 0.4, Math.random() * 6.3, Math.random() * 0.4);
    g.add(r);
  }
  return g;
}

function makeBarrel(): THREE.Group {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.75, 10), new THREE.MeshStandardMaterial({ map: chestTex, roughness: 1 }));
  const g = new THREE.Group();
  g.add(m);
  if (Math.random() < 0.5) {
    // 쓰러진 통
    m.rotation.z = Math.PI / 2;
    m.position.y = 0.3;
    g.rotation.y = Math.random() * 6.3;
  } else {
    m.position.y = 0.375;
  }
  return g;
}

/** 천장에 매달린 사슬. 위상 오프셋을 함께 돌려줘서 흔들리게 한다. */
function makeChain(): { object: THREE.Group; swing: number } {
  const g = new THREE.Group();
  const len = 0.8 + Math.random() * 1.4;
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6), ironMat);
  c.position.y = WALL_H - len / 2;
  g.add(c);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 10), ironMat);
  hook.position.y = WALL_H - len - 0.06;
  g.add(hook);
  return { object: g, swing: Math.random() * 6.3 };
}

function makePuddle(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.5 + Math.random() * 0.5, 18), puddleMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  m.scale.x = 0.7 + Math.random() * 0.6;
  return m;
}

/** 확률 테이블대로 소품 하나를 뽑는다. 아무것도 안 나오면 null. */
export function rollProp(): Prop | null {
  const r = Math.random();
  if (r < 0.10) return { object: makeBonePile(), swing: null };
  if (r < 0.26) return { object: makeRubble(), swing: null };
  if (r < 0.31) return { object: makeBarrel(), swing: null };
  if (r < 0.41) return makeChain();
  if (r < 0.52) return { object: makePuddle(), swing: null };
  return null;
}

/** 벽에 붙는 초록 불꽃 촛대. */
export function makeSconce(): Sconce {
  const g = new THREE.Group();
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), ironMat);
  bracket.position.y = -0.15;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 7), new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.85 }));
  flame.position.y = 0.13;
  const light = new THREE.PointLight(0x38e070, 0.7, 6.5, 2.0);
  light.position.y = 0.2;
  light.layers.enable(1);
  g.add(bracket, flame, light);
  return { group: g, flame, light, seed: Math.random() * 6.3 };
}
