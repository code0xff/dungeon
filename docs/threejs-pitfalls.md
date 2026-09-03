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

**The same rule bites again across characters.** Mixamo numbers the rig per
export, so the same bone is `mixamorig5:Hips` on one download and `mixamorig:Hips`
on another. Identical skeletons, 52 identical bones, and 0 of 53 tracks bound —
the mixer plays happily and the creature stands in its bind pose. `MIXAMO_NS` in
`assets.ts` strips the number from bones and tracks alike, which took it to 53 of
53 and is what lets the brute wear the zombie's body.

Two things make this hard to spot. Nothing throws, and the names differ again by
container: GLTFLoader runs node names through `PropertyBinding.sanitizeNodeName`,
which strips `.:/[]`, so the bone that is `mixamorig5:Hips` out of an FBX is
`mixamorig5Hips` out of a GLB. Any pattern matching these names has to allow for
both. The `[assets]` log now prints the worst binding rate per creature so a
mismatch shows up as a warning rather than as a puzzled look.

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

## A character walks out of its own collision circle

**Cause.** A Mixamo clip downloaded without **In Place** carries root motion: the
hips translate across the cycle and snap back. Collision only ever tests the
group's position, so the body travels outside its own circle and through walls.
This project's walk clip moved 1.38m over a 4s cycle — three times the 0.45m
body radius.

**Fix.** `stripRootMotion()` in `src/assets.ts` flattens the X and Z of the hips
position track on every clip at load. Y is left alone so the body still rises and
falls. The rule it enforces: **the game owns where a creature is, the clip owns
only how it is posed.**

The drift it removed is reported in the `[assets]` log, because a clip with root
motion is a download mistake that otherwise surfaces only as a creature walking
through a wall.

It is also worth measuring rather than discarding: the drift divided by the clip
duration is the speed the walk was authored at, which is exactly the number the
foot-slide retiming needs. The hand-set constant said 1.45 m/s where the clip was
a 0.35 m/s shamble.

## Limbs reach far outside the collision radius

**Cause.** A capsule or circle sized to the torso says nothing about where the
arms go. This zombie's body radius is 0.45m while its skinned vertices reach
1.00m from the origin mid-attack, so it could stand close enough to a wall to put
an arm through it.

**Fix.** `CreatureType.clearance` is a separate, larger radius used only for
creature-versus-wall tests. `r` stays the body, because that is what the player's
attack cone is sized against.

**Measure it per creature, and do not derive it.** The obvious shortcuts are both
wrong. Scaling `clearance` from `r` ignores that the arms, not the torso, set the
number; scaling it from height says the brute at 1.27x the zombie needs 1.27x the
room, when measurement puts the two at 1.02m and 1.00m — the figure comes from the
pose the clip happens to strike. Bone positions understate it too, because the
skinned vertices are what gets drawn.

Stepping every vertex through every clip with `SkinnedMesh.applyBoneTransform()`
is how those numbers were found, and it is worth doing per clip: the death clip
throws an arm out to 1.24m, but a dying creature does not move, so it is walk and
attack that set the clearance. Add the 1.08 top of `SCALE_VARIANCE` and round up.

Check the pathing after raising it. A 4m corridor leaves `CELL - 2 * clearance`
of usable width, and even at 1.6 all 279 floor cells and all 346 adjacent links
still pass.

**Measure it, do not guess.** Bone positions understate the reach; the skinned
vertices are what gets drawn. `SkinnedMesh.applyBoneTransform()` gives the posed
position of a vertex, and stepping the mixer through a clip while tracking the
extreme is how the 0.82m above was found.

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
