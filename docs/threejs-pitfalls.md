# Three.js pitfalls

Every entry here cost real debugging time in this project. They are written
symptom-first, because that is how you will meet them again.

## The world vanishes and only the weapon renders

**Cause.** `WebGLBackground.render()` sets `forceClear = true` whenever
`scene.background` is a `Color`. That overrides `renderer.autoClear = false`, so
the second pass — the one that draws the first-person weapon — clears the colour
buffer and erases everything the first pass drew.

**Fix.** The background is a renderer clear colour, never `scene.background`:

```ts
renderer.setClearColor(0x020304, 1);
renderer.autoClear = false;
```

A clear colour is only applied by the explicit `clear()` at the top of
`renderFrame()`, which is exactly the behaviour the two-pass setup needs.

**Do not** set `scene.background` to a Color in this project. It looks harmless
in isolation and breaks rendering completely.

## A skinned model is the wrong size, sometimes wildly

**Cause.** A skinned mesh has its vertices placed by the **bone matrices** at
draw time. `Box3.setFromObject()` reads the geometry's bind-pose bounds, which
can bear no relation to what appears on screen. An FBX2glTF export here measured
0.44 by its box while its bones spanned 1.49 — a factor of 3.4, which made the
zombie 6.4m tall after normalisation.

**Fix.** `measure()` in `src/assets.ts` walks the bones and uses their world
positions when there are at least two, falling back to `Box3` only for
unskinned models.

## A model loads but nothing appears, and the log says it succeeded

**Cause.** A Mixamo FBX downloaded "Without Skin" has the skeleton and no mesh.
The empty `Box3` gives `height = -Infinity`, and `-Infinity` is truthy, so a
`|| 1` guard does not catch it. Scale becomes `-0` and position `NaN`.

**Fix.** `unusableReason()` in `src/assets.ts` counts vertices and validates the
measured height before normalising, and names the reason in the `[assets]` log.
When you add a loader, make its failures say what to do about them.

## Skin, cloth or wood glints like polished metal

**Cause.** glTF's default `metallicFactor` is **1.0**, not 0. FBX2glTF also maps
Phong specular into a metallicRoughness texture. Together these gave the zombie
metalness 0.4 all over.

**Fix.** `deMetallize()` in `scripts/optimize-assets.mjs` pins metalness to 0 and
roughness to a constant for creature materials.

**But do not apply this blindly.** Poly Haven's weapon and chest models ship
correct PBR — their metalness *should* be 1 with a real ORM texture. Only the
FBX-derived creature path needs the correction.

## Gold, or any metal, renders nearly black

**Cause.** A `MeshStandardMaterial` at high metalness is almost entirely
reflection, and this scene has **no environment map** — only point lights. There
is nothing to reflect, so the surface goes black except for tiny specular hits.

**Fix.** Fake it with diffuse. The chest hoard is `metalness: 0.35` with a little
emissive, which reads as gold in torchlight. Adding an environment map would be
the physically correct answer and a much larger change.

## Animation clips do not bind to the model

**Cause.** `AnimationClip` tracks bind **by object name** (`mixamorigLeftArm.quaternion`).
assimp splits FBX pivots into helper nodes named `_$AssimpFbx$_Rotation`, so the
tracks point at helpers rather than real bones — 12 of 156 tracks matched.

**Fix.** Use `fbx2gltf`, which bakes pivots into the bones (53 of 53 matched).
`scripts/optimize-assets.mjs` uses it and the comment there says why.

The same name-binding rule is what lets a Without-Skin clip drive a With-Skin
model: the bone names match, so the tracks bind.

## Simplification barely reduces the triangle count

**Cause.** Exporters duplicate vertices along every UV and normal seam.
`simplify()` collapses edges between *shared* vertices, and there are few.

**Fix.** `weld()` before `simplify()`. `scripts/fetch-assets.mjs` does this.

## Normal-mapped surfaces light wrongly after compression

**Cause.** A normal map's pixels are vectors, not colour. Whatever lossy
compression smears becomes a wrong surface direction, and the lighting turns with
it.

**Fix.** `scripts/fetch-assets.mjs` bakes normal maps at webp quality 90 while
colour and roughness go at 80. Also: Poly Haven's `nor_gl` (OpenGL) is the
correct variant — `nor_dx` inverts the relief in Three.js.

## Cloned objects share materials, so a hit flash lights up the whole horde

**Cause.** `Object3D.clone()` shares geometry *and* materials by reference. That
sharing is what makes ten chests cheap, and it is also why a per-creature
emissive flash bleeds across every creature.

**Fix.** `spawnCreature()` clones the materials for creatures, which need
per-instance state. Chests deliberately do not, because nothing writes to a
chest material.

## A camera-child object disappears at the screen edge

**Cause.** Frustum culling misjudges objects parented to the camera.

**Fix.** `frustumCulled = false` on loaded weapon meshes. A held weapon is always
on screen, so there is nothing to save.
