import * as THREE from 'three';
import { ENV_INTENSITY, FOG_BASE, LIGHT_DIM, LIGHT_LIT, WALL_H } from './config';
import { el } from './dom';
import type { WeaponKind } from './types';

// ================= Renderer, scene, camera =================
export const scene = new THREE.Scene();
// The background comes from the renderer's clear colour, not scene.background.
// When scene.background is a Color, three sets forceClear on every render() and
// wipes the colour buffer regardless of autoClear=false — so the second pass (the
// weapons) erases the whole world and only the sword is left on screen.
// A clear colour is applied only by the clear() at the top of renderFrame().

/** Held at its concrete type so callers need not narrow scene.fog every time. */
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
// Automatic clearing is off because the weapons are drawn in a second pass.
renderer.autoClear = false;
el('game').appendChild(renderer.domElement);

export const canvasEl = renderer.domElement;

/**
 * A tiny environment map, built in code, purely so metal has something to reflect.
 *
 * Poly Haven's models are correct glTF: metalness and roughness sit at 1 and a
 * metalRoughness texture carries the real per-texel values. But a metal surface
 * has **no diffuse response at all** — everything it shows is reflection — so
 * with `scene.environment` unset a steel blade is lit only by whatever direct
 * specular the point light throws, and reads as a flat dark strip. That is what
 * made the sword look cheap; the same trap is why the chest's gold needed a
 * emissive fudge.
 *
 * It is not applied to `scene.environment`, because that would also add diffuse
 * IBL to every wall and creature and lift the whole dungeon out of the dark.
 * assets.ts puts it on the weapon and prop materials only — see applyEnvMap().
 *
 * The environment itself is a dark box with a warm panel overhead and a dimmer
 * bounce below: torchlight from above, stone underfoot. A neutral studio
 * environment (three's RoomEnvironment) would have put cold white highlights on
 * everything.
 */
function buildEnvironment(): THREE.Texture {
  const env = new THREE.Scene();
  const lit = (color: number, w: number, h: number, d: number): THREE.Mesh =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));

  const room = lit(0x0a0908, 12, 8, 12);
  room.geometry.scale(-1, 1, 1); // inside-out, so the box is the surroundings
  env.add(room);

  const above = lit(0xff7a2e, 7, 0.1, 7);
  above.position.y = 3.4;
  env.add(above);

  const below = lit(0x2a1a10, 9, 0.1, 9);
  below.position.y = -3.4;
  env.add(below);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.08);
  pmrem.dispose();
  return target.texture;
}

export const envMap = buildEnvironment();

// ================= Lighting =================
const ambient = new THREE.AmbientLight(0x141820, 0.55);
ambient.layers.enable(1);
scene.add(ambient);

/** The torchlight that follows the player. */
/** The light the player carries. A lit lantern widens and brightens it. */
export const playerLight = new THREE.PointLight(0xff7428, 1.9, 11, 2.0);
playerLight.layers.enable(1);
scene.add(playerLight);

// ================= Extraction portal =================
export const portalLight = new THREE.PointLight(0x3a6fd0, 2.0, 14, 1.6);
portalLight.layers.enable(1);
scene.add(portalLight);

export const portal = new THREE.Mesh(
  new THREE.TorusGeometry(1.1, 0.12, 12, 40),
  new THREE.MeshStandardMaterial({ color: 0x101a2a, emissive: 0x3a7fe0, emissiveIntensity: 1.3 }),
);
scene.add(portal);

/**
 * Whether the exit is unlocked, shown rather than only told.
 *
 * A sealed portal is dim and colourless; taking the key brings it up to full.
 * The player should be able to tell from across a room, because walking all the
 * way there to read a refusal is the worst version of this.
 */
export function setPortalOpen(open: boolean): void {
  portalLight.intensity = open ? 2.0 : 0.5;
  portalCore.material.color.setHex(open ? 0x1c4a9a : 0x2a2f38);
  const m = portal.material as THREE.MeshStandardMaterial;
  m.emissive.setHex(open ? 0x3a7fe0 : 0x2b3340);
  m.emissiveIntensity = open ? 1.3 : 0.5;
}

export const portalCore = new THREE.Mesh(
  new THREE.CircleGeometry(0.95, 28),
  new THREE.MeshBasicMaterial({ color: 0x1c4a9a, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
);
scene.add(portalCore);

// ================= First-person gear =================
/**
 * Carries the walk bob for the held weapons.
 *
 * A container rather than bobbing the weapons directly: the swing writes
 * absolute rotations to `sword`, and recoil and reload write absolute positions
 * to `musket`. Bobbing a parent composes with all of that for free, where adding
 * it to the same properties would mean every animation having to know about it.
 */
export const gearBob = new THREE.Group();
camera.add(gearBob);

// ---- Sword (right hand) ----
export const sword = new THREE.Group();
/** Primitive sword used when no external model is present. Swapped out wholesale once one loads. */
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
// The primitives are metal too, so they need the same thing the loaded models
// get in assets.ts — otherwise removing the GLB swaps one dark shape for another.
swordFallback.traverse((o) => {
  const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
  if (!m || !('envMapIntensity' in m)) return;
  m.envMap = envMap;
  m.envMapIntensity = ENV_INTENSITY;
});
sword.add(swordFallback);
/**
 * Resting pose of the sword. Every swing returns here.
 *
 * The yaw is the important number. After normalisation the blade's length runs
 * down -Z and its thickness along X, so a sword pointed straight ahead is seen
 * exactly edge-on — a brown line in the corner, whatever the model. Swinging it
 * across the view turns some of the flat toward the camera; -0.55 is as far as
 * it goes before the tip leaves the frame on a wide window.
 */
export const SWORD_REST = { pos: new THREE.Vector3(0.26, -0.26, -0.30), rot: new THREE.Euler(0.20, -0.55, 0.30) };
sword.position.copy(SWORD_REST.pos);
sword.rotation.copy(SWORD_REST.rot);
gearBob.add(sword);

// ---- Lantern (left hand, shown while it has fuel) ----
/**
 * Empty until loadLantern() fills it. There is deliberately no primitive
 * fallback: the cones this replaced read as a paper triangle held against the
 * player's cheek, and an unlit hand with a working light is better than that.
 */
export const handLamp = new THREE.Group();
/**
 * Where it hangs at rest. Deliberately low and far left, so the bottom-left
 * corner of the frame cuts it: centred in clear air it read as an object
 * floating beside the player's head, because there is no hand or arm to hold it.
 * The weapons get away with the same trick only because their grips run off the
 * bottom of the screen, and the edge implies the hand.
 *
 * How much of it the crop takes depends on the viewport: three keeps the vertical
 * fov fixed and widens horizontally, so a narrow portrait phone pushes the lamp
 * off screen entirely. That is the right outcome there — the move stick sits in
 * that same corner — but it does mean this position cannot be tuned by looking at
 * one window size.
 */
export const LAMP_REST = { pos: new THREE.Vector3(-0.40, -0.48, -0.52), rot: new THREE.Euler(0.10, 0.62, 0.06) };
handLamp.position.copy(LAMP_REST.pos);
handLamp.rotation.copy(LAMP_REST.rot);
handLamp.scale.setScalar(0.9);
handLamp.visible = false;
camera.add(handLamp);

/** Puts the loaded lantern model in the player's left hand. */
export function equipLantern(model: THREE.Object3D): void {
  handLamp.add(model);
  model.traverse((o) => {
    o.layers.set(1);
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
  });
}

/**
 * Switches the player's light between unlit and lantern-lit, and hands back the
 * base intensity for the caller to store. It returns rather than writing to
 * state because scene.ts sits below state in the module layering.
 */
export function setLampLit(lit: boolean): number {
  const l = lit ? LIGHT_LIT : LIGHT_DIM;
  playerLight.distance = l.distance;
  fog.density = l.fog;
  handLamp.visible = lit;
  return l.intensity;
}

// ---- Musket (right hand, shown when swapped to) ----
export const musket = new THREE.Group();
/** Primitive musket used when no external model is present. */
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
/** Resting pose of the musket. Reloading moves y; recoil moves z and rotation.x. */
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
/** The smoke's resting y at the muzzle. It drifts up, then returns here. Swapping in a model updates it to that muzzle's height. */
export let SMOKE_REST_Y = 0.03;
smoke.position.set(0, SMOKE_REST_Y, -1.25);
musket.add(smoke);

export const flashLight = new THREE.PointLight(0xffc060, 0, 12, 1.5);
flashLight.layers.enable(1);
scene.add(flashLight);
gearBob.add(musket);

// Weapons live on layer 1: drawn over the world in their own pass so they never poke through walls.
sword.traverse((o) => o.layers.set(1));
musket.traverse((o) => o.layers.set(1));

/**
 * Swap a primitive weapon for an external model.
 *
 * The swing and recoil animations only touch position and rotation on the outer
 * group (sword/musket), so replacing what is inside leaves them working. The
 * muzzle flash and smoke are children of musket and survive too; passing `muzzle`
 * moves them to the new barrel end.
 */
export function equipWeaponModel(kind: WeaponKind, model: THREE.Object3D, muzzle?: THREE.Vector3): void {
  const group = kind === 'sword' ? sword : musket;
  group.remove(kind === 'sword' ? swordFallback : musketFallback);
  group.add(model);
  model.traverse((o) => {
    o.layers.set(1);
    // Culling misjudges children of the camera. A held weapon is always on screen, so turn it off.
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
  });
  if (kind === 'sword') cacheBladeMats();
  if (!muzzle) return;
  SMOKE_REST_Y = muzzle.y;
  muzzleFlash.position.set(muzzle.x, muzzle.y, muzzle.z - 0.12);
  smoke.position.set(muzzle.x, muzzle.y, muzzle.z - 0.06);
}
/**
 * Telling the player the lunge window is open, on the blade rather than in the
 * HUD.
 *
 * The crosshair would have been the obvious place and is the wrong one: it is
 * only drawn for the musket, and the lunge is a sword mechanic. The sword is
 * always on screen, it is the thing the bonus applies to, and — the part that
 * makes this work as a teaching cue — the *fade is the countdown*. There is no
 * second element to read; the light going out is the window closing.
 *
 * Every material on the equipped sword glows, not just the blade, because which
 * mesh is the blade is not knowable in an arbitrary GLB. Added to whatever
 * emissive the model already had rather than overwriting it, so a model with its
 * own glow keeps it at k=0.
 */
const LUNGE_GLOW = new THREE.Color(0xff2216);
/**
 * Where the colour goes past full charge.
 *
 * Pushing the red further just clips all three channels into a flat neon slab —
 * more saturation is not more brightness. A struck spark is white at the core,
 * so the discharge blends toward this instead and reads as heat rather than as
 * a light-up toy.
 */
const LUNGE_HOT = new THREE.Color(0xffd2a4);
/**
 * How much of that colour the blade takes at full.
 *
 * At 1 the emissive swamps the material: the sword goes a flat pale yellow with
 * no shading, no highlight and no silhouette, which reads as a rendering bug
 * rather than a hot edge.
 *
 * Red carries less than the orange this started as — the same fraction of a red
 * is a much darker pixel, and the dungeon it has to stand out against is already
 * warm — so the peak is higher than the 0.4 orange needed. Checked in a dark
 * corridor and against a lantern-lit wall a metre away, because a level that
 * looks right against black is barely visible against warm stone.
 */
const LUNGE_GLOW_PEAK = 0.55;
const glowTmp = new THREE.Color();
/** Cached: this runs every frame, and re-traversing to find four materials is waste. */
let bladeMats: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
let lastGlow = -1;

function cacheBladeMats(): void {
  bladeMats = [];
  lastGlow = -1;
  sword.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      // MeshBasicMaterial has no emissive at all, so this is a real filter.
      if (!m || !('emissive' in m)) continue;
      const mat = m as THREE.MeshStandardMaterial;
      bladeMats.push({ mat, base: mat.emissive.clone() });
    }
  });
}
cacheBladeMats();

/** `k` is 0..1, the fraction of the lunge window left. */
export function setBladeGlow(k: number): void {
  // Quantised because this is called every frame and the common case is 0. The
  // ceiling is above 1 so a landed lunge can discharge brighter than the armed
  // glow ever gets — see LUNGE_HIT_GLOW.
  const q = Math.round(Math.max(0, Math.min(3, k)) * 40) / 40;
  if (q === lastGlow) return;
  lastGlow = q;
  // Up to 1 this is the armed charge reddening; past it, the discharge, which
  // goes hotter and whiter rather than redder.
  glowTmp.copy(LUNGE_GLOW);
  if (q > 1) glowTmp.lerp(LUNGE_HOT, Math.min(1, (q - 1) / 1.4));
  glowTmp.multiplyScalar(q * LUNGE_GLOW_PEAK);
  for (const { mat, base } of bladeMats) mat.emissive.copy(base).add(glowTmp);
}

scene.add(camera);

// ================= Floating dust =================
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

// ================= World geometry (replaced by buildWorld) =================
export const world: {
  wall: THREE.InstancedMesh | null;
  floor: THREE.Mesh | null;
  ceil: THREE.Mesh | null;
} = { wall: null, floor: null, ceil: null };

/** Two passes: world (layer 0), clear depth, then weapons (layer 1). */
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
