import * as THREE from 'three';
import type { CreatureKey, CreatureRig } from './types';

/** 원점이 위쪽 끝(어깨/골반)에 오도록 매단 팔·다리. 회전축이 관절이 된다. */
function limb(w: number, h: number, d: number, mat: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = -h / 2;
  pivot.add(m);
  return pivot;
}

export const ironMat = new THREE.MeshStandardMaterial({ color: 0x3f4145, metalness: 0.7, roughness: 0.5 });

/** 폴백 크리처 하나. 메시와, 애니메이션이 만질 리그를 함께 돌려준다. */
export interface ProceduralCreature {
  mesh: THREE.Group;
  rig: CreatureRig;
}

/** assets/creatures/zombie 에 FBX/GLB가 없을 때 쓰는 박스 모델. */
function makeZombie(): ProceduralCreature {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x5c6863, roughness: 0.95 });
  const rag = new THREE.MeshStandardMaterial({ color: 0x24201b, roughness: 1 });

  const torso = new THREE.Group();
  torso.position.y = 0.85;
  torso.rotation.x = 0.38;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), skin);
  chest.position.y = 0.35;
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.36, 0.34), rag);
  shirt.position.y = 0.18;
  torso.add(chest, shirt);

  const head = new THREE.Group();
  head.position.set(0, 0.72, 0.05);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), skin);
  skull.position.y = 0.23;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a0f0c, roughness: 1 }));
  jaw.position.set(0, 0.08, 0.22);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), eyeMat);
  eL.position.set(-0.11, 0.3, 0.24);
  const eR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), eyeMat);
  eR.position.set(0.12, 0.28, 0.24);
  const glow = new THREE.PointLight(0xff5a10, 0.35, 2.4, 2);
  glow.position.set(0, 0.28, 0.3);
  head.add(skull, jaw, eL, eR, glow);
  torso.add(head);

  const armL = limb(0.17, 0.66, 0.17, skin);
  armL.position.set(-0.37, 0.62, 0);
  const armR = limb(0.17, 0.56, 0.17, skin);
  armR.position.set(0.37, 0.62, 0);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 12), ironMat);
  shackle.rotation.x = Math.PI / 2;
  shackle.position.y = -0.58;
  armL.add(shackle);
  torso.add(armL, armR);

  const legL = limb(0.2, 0.82, 0.2, rag);
  legL.position.set(-0.15, 0.85, 0);
  const legR = limb(0.2, 0.82, 0.2, rag);
  legR.position.set(0.15, 0.85, 0);
  g.add(torso, legL, legR);

  const rig: CreatureRig = { mats: [skin, rag], armL, armR, legL, legR, head, torso, armBase: [-0.45, -0.25], limp: 0.7 };
  return { mesh: g, rig };
}

export const MAKERS: Record<CreatureKey, () => ProceduralCreature> = {
  zombie: makeZombie,
};
