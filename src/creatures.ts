import * as THREE from 'three';
import type { CreatureKey, CreatureRig } from './types';

/** A limb hung so its origin sits at the top end (shoulder/hip), making the rotation axis the joint. */
function limb(w: number, h: number, d: number, mat: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = -h / 2;
  pivot.add(m);
  return pivot;
}

export const ironMat = new THREE.MeshStandardMaterial({ color: 0x3f4145, metalness: 0.7, roughness: 0.5 });

/** One fallback creature: the mesh plus the rig the animation code drives. */
export interface ProceduralCreature {
  mesh: THREE.Group;
  rig: CreatureRig;
}

/**
 * The shape of one box creature. Everything here is in metres at scale 1; `bulk`
 * then widens the whole body without lengthening it, which is what separates a
 * brute from a tall zombie.
 */
interface Build {
  /** Skin colour. */
  skin: number;
  /** Clothing colour. */
  rag: number;
  /** Eye glow. */
  eye: number;
  /** Overall size multiplier. 1 is the zombie at 1.85m. */
  size: number;
  /** Width multiplier on top of `size`. Above 1 reads as heavy rather than tall. */
  bulk: number;
  /** Forward lean of the torso, in radians. */
  hunch: number;
  /** Resting x rotation of the arms, as [left, right]. */
  armBase: readonly [number, number];
  /** Swing multiplier for the right leg. Below 1 gives a limp. */
  limp: number;
  /** Whether the left wrist carries a shackle. */
  shackle: boolean;
}

/**
 * Box model used when a creature's folder under assets/creatures holds no usable
 * model. Deliberately crude: it exists so a fresh clone with no assets still
 * plays, and so a broken download is obvious on sight rather than invisible.
 */
function makeHumanoid(b: Build): ProceduralCreature {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: b.skin, roughness: 0.95 });
  const rag = new THREE.MeshStandardMaterial({ color: b.rag, roughness: 1 });
  const w = b.size * b.bulk, h = b.size;

  const torso = new THREE.Group();
  torso.position.y = 0.85 * h;
  torso.rotation.x = b.hunch;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56 * w, 0.62 * h, 0.3 * w), skin);
  chest.position.y = 0.35 * h;
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.6 * w, 0.36 * h, 0.34 * w), rag);
  shirt.position.y = 0.18 * h;
  torso.add(chest, shirt);

  const head = new THREE.Group();
  head.position.set(0, 0.72 * h, 0.05 * h);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.46 * w, 0.46 * h, 0.46 * w), skin);
  skull.position.y = 0.23 * h;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3 * w, 0.1 * h, 0.1 * w), new THREE.MeshStandardMaterial({ color: 0x1a0f0c, roughness: 1 }));
  jaw.position.set(0, 0.08 * h, 0.22 * w);
  const eyeMat = new THREE.MeshBasicMaterial({ color: b.eye });
  // The eyes are deliberately mismatched — a perfectly symmetrical face reads as a robot.
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.08 * w, 0.06 * h, 0.03 * w), eyeMat);
  eL.position.set(-0.11 * w, 0.3 * h, 0.24 * w);
  const eR = new THREE.Mesh(new THREE.BoxGeometry(0.06 * w, 0.06 * h, 0.03 * w), eyeMat);
  eR.position.set(0.12 * w, 0.28 * h, 0.24 * w);
  const glow = new THREE.PointLight(b.eye, 0.35, 2.4 * h, 2);
  glow.position.set(0, 0.28 * h, 0.3 * h);
  head.add(skull, jaw, eL, eR, glow);
  torso.add(head);

  const armL = limb(0.17 * w, 0.66 * h, 0.17 * w, skin);
  armL.position.set(-0.37 * w, 0.62 * h, 0);
  const armR = limb(0.17 * w, 0.56 * h, 0.17 * w, skin);
  armR.position.set(0.37 * w, 0.62 * h, 0);
  if (b.shackle) {
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.12 * w, 0.03 * w, 6, 12), ironMat);
    shackle.rotation.x = Math.PI / 2;
    shackle.position.y = -0.58 * h;
    armL.add(shackle);
  }
  torso.add(armL, armR);

  const legL = limb(0.2 * w, 0.82 * h, 0.2 * w, rag);
  legL.position.set(-0.15 * w, 0.85 * h, 0);
  const legR = limb(0.2 * w, 0.82 * h, 0.2 * w, rag);
  legR.position.set(0.15 * w, 0.85 * h, 0);
  g.add(torso, legL, legR);

  const rig: CreatureRig = { mats: [skin, rag], armL, armR, legL, legR, head, torso, armBase: b.armBase, limp: b.limp };
  return { mesh: g, rig };
}

export const MAKERS: Record<CreatureKey, () => ProceduralCreature> = {
  zombie: () => makeHumanoid({
    skin: 0x5c6863, rag: 0x24201b, eye: 0xff6a1a,
    size: 1, bulk: 1, hunch: 0.38, armBase: [-0.45, -0.25], limp: 0.7, shackle: true,
  }),
  // Taller, half again as wide and standing more upright, so the two are told
  // apart by silhouette alone — the box models have no texture to tell them by.
  brute: () => makeHumanoid({
    skin: 0x7d5147, rag: 0x1b1714, eye: 0xffc21a,
    size: 1.27, bulk: 1.45, hunch: 0.18, armBase: [-0.3, -0.3], limp: 1, shackle: false,
  }),
  // Thin, pale and pitched forward at a run, with no limp — the one silhouette
  // of the three that reads as coming at you rather than shambling.
  lunatic: () => makeHumanoid({
    skin: 0xd8d2c4, rag: 0x6b2230, eye: 0xff2a2a,
    size: 0.96, bulk: 0.78, hunch: 0.55, armBase: [-0.9, -0.9], limp: 1, shackle: false,
  }),
};
