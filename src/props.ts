import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chestTemplate } from './assets';
import { PROP_ASSETS, WALL_H } from './config';
import { ironMat } from './creatures';
import { chestTex } from './textures';
import type { Chest, Prop, Sconce } from './types';

const boneMat = new THREE.MeshStandardMaterial({ color: 0x9a917c, roughness: 1 });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 1 });
const puddleMat = new THREE.MeshStandardMaterial({ color: 0x04060a, metalness: 0.95, roughness: 0.12 });
// Pale, so the player's lamp is the only thing that reveals a trap. See makeTrap().
const trapBoneMat = new THREE.MeshStandardMaterial({ color: 0xbdb49a, roughness: 0.85 });
const trapCordMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 1 });

// ---- Chest ----
/**
 * Gold with no environment map to reflect renders almost black at high metalness,
 * so this leans on diffuse and a little emissive instead of a mirror finish.
 */
const goldMat = new THREE.MeshStandardMaterial({
  color: 0xd9a93a, metalness: 0.35, roughness: 0.35, emissive: 0x3a2600,
});

/**
 * A heap of coins and ingots, merged into one geometry and built once.
 * A single flat slab read as a lid closing the chest rather than treasure in it,
 * and ten separate piles would be ten times the draw calls for the same look.
 */
const goldGeo = (() => {
  const coin = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10);
  const ingot = new THREE.BoxGeometry(0.1, 0.045, 0.06);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 24; i++) {
    const isIngot = i % 5 === 0;
    const g = (isIngot ? ingot : coin).clone();
    g.rotateY(Math.random() * Math.PI);
    g.rotateX((Math.random() - 0.5) * (isIngot ? 0.3 : 0.7));
    // Heaped toward the middle so the pile has a crown rather than a flat top.
    const t = Math.random();
    g.translate((Math.random() - 0.5) * 0.52, t * 0.06, (Math.random() - 0.5) * 0.26 * (1 - t * 0.4));
    parts.push(g);
  }
  coin.dispose();
  ingot.dispose();
  return mergeGeometries(parts, false);
})();

/** The hoard inside, hidden by the lid until the chest opens. */
function makeGold(y: number): THREE.Mesh {
  const gold = new THREE.Mesh(goldGeo, goldMat);
  gold.position.y = y;
  return gold;
}

/** Primitive chest, used when assets/props/chest.glb is absent. */
function primitiveChest(): { mesh: THREE.Group; lid: THREE.Object3D } {
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

  g.add(base, lidPivot, makeGold(0.4));
  return { mesh: g, lid: lidPivot };
}

/**
 * Treasure chest. Hands back the lid pivot so the open animation has something to turn.
 *
 * Every chest clones the same loaded model, and three.js clones share geometry and
 * materials, so ten chests cost draw calls rather than ten copies of the mesh.
 */
/**
 * A trapped chest has to be readable *before* it is opened or the trap is not a
 * decision, only a punishment. The tell is a pale wire strung across the lid
 * seam with a couple of iron teeth behind it — the same material logic as the
 * floor traps, so it is the lamp that shows it to you and not a HUD marker.
 */
function trapTell(): THREE.Group {
  const g = new THREE.Group();
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.78, 5), trapCordMat);
  wire.rotation.z = Math.PI / 2;
  wire.position.set(0, 0.36, 0.3);
  g.add(wire);
  for (let i = -1; i <= 1; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 4), trapBoneMat);
    tooth.position.set(i * 0.2, 0.42, 0.26);
    tooth.rotation.x = -0.5;
    g.add(tooth);
  }
  return g;
}

export function createChest(value: number, trapped: boolean): Omit<Chest, 'item'> {
  const template = chestTemplate();
  let mesh: THREE.Group;
  let lid: THREE.Object3D;

  if (template) {
    mesh = new THREE.Group();
    const model = template.clone(true);
    // Non-null: loadChest refuses a model without this node.
    lid = model.getObjectByName(PROP_ASSETS.chest.lidNode) as THREE.Object3D;
    // 0.34 is the interior floor of the Poly Haven chest.
    mesh.add(model, makeGold(0.34));
  } else {
    ({ mesh, lid } = primitiveChest());
  }
  if (trapped) mesh.add(trapTell());
  return { mesh, lid, value, state: 'closed', openT: 0, trapped };
}

// ---- Props ----
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
    // Toppled barrel
    m.rotation.z = Math.PI / 2;
    m.position.y = 0.3;
    g.rotation.y = Math.random() * 6.3;
  } else {
    m.position.y = 0.375;
  }
  return g;
}

/** Chain hanging from the ceiling. Hands back a phase offset so it sways out of step with the others. */
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

/** Rolls one prop off the probability table. null when nothing comes up. */
export function rollProp(): Prop | null {
  const r = Math.random();
  if (r < 0.10) return { object: makeBonePile(), swing: null };
  if (r < 0.26) return { object: makeRubble(), swing: null };
  if (r < 0.31) return { object: makeBarrel(), swing: null };
  if (r < 0.41) return makeChain();
  if (r < 0.52) return { object: makePuddle(), swing: null };
  return null;
}

// ---- Trap ----
/**
 * A ring of bone and a taut cord across it, low to the floor.
 *
 * Pale rather than dark, and that is the whole design of the thing. Nothing here
 * hides or reveals it in code: it is lit by the player's own lamp like any other
 * object, so how far ahead you can spot one is exactly LIGHT_DIM.distance
 * unlit against LIGHT_LIT.distance lit — 11m against 19m. That is the second job
 * the lantern never had. It was a timer you lit and waited out; now it buys
 * reaction distance in a specific corridor, which is a decision rather than a
 * drain.
 *
 * Kept under knee height so it never blocks the view of what is behind it. A
 * trap you cannot see past would be a wall, and the dungeon has those.
 */
export function makeTrap(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.045, 6, 16), trapBoneMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  // Three ribs across the ring, so it reads as rigged rather than dropped.
  for (let i = 0; i < 3; i++) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.04, 5), trapCordMat);
    cord.rotation.z = Math.PI / 2;
    cord.rotation.y = (i / 3) * Math.PI;
    cord.position.y = 0.14;
    g.add(cord);
  }
  const skull = makeSkull();
  skull.position.set(0, 0.04, 0);
  skull.scale.setScalar(0.85);
  g.add(skull);
  return g;
}

/** Wall sconce with a green flame. */
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
