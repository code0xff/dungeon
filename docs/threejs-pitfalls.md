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
on another. Identical skeletons, identical bone names underneath, and 0 of 53
tracks bound — the mixer plays happily and the creature stands in its bind pose.
`MIXAMO_NS` in `assets.ts` strips the number from bones and tracks alike, which
took it to 53 of 53. It is what lets a creature's four clips come off four
different characters, which the brute's do.

Two things make this hard to spot. Nothing throws, and the names differ again by
container: GLTFLoader runs node names through `PropertyBinding.sanitizeNodeName`,
which strips `.:/[]`, so the bone that is `mixamorig5:Hips` out of an FBX is
`mixamorig5Hips` out of a GLB. Any pattern matching these names has to allow for
both. The `[assets]` log now prints the worst binding rate per creature so a
mismatch shows up as a warning rather than as a puzzled look.

## A metal weapon renders as a flat dark stick

**Cause.** A metal surface has **no diffuse response at all** — everything it
shows is reflection. With `scene.environment` unset there is nothing to reflect,
so a steel blade is lit only by whatever direct specular a point light throws and
comes out as a dark silhouette. Poly Haven's glTF is not at fault: metalness and
roughness sit at 1 and a metalRoughness *texture* carries the real per-texel
values, which is exactly what the spec says to do.

**Fix.** `buildEnvironment()` in `scene.ts` builds a tiny environment in code —
a dark box with a warm panel above and a dimmer bounce below — and PMREMs it. No
asset, no dependency.

**Do not put it on `scene.environment`.** That also adds diffuse IBL to every
wall and creature and lifts the whole dungeon out of the dark, which is the one
thing this game cannot afford. `applyEnvMap()` in `assets.ts` sets it on the
weapon and prop materials only, at `ENV_INTENSITY` well below 1 — a blade that
mirrors a room which is not there stops looking like it is in the dark with you.

The primitives need it too, or removing a GLB swaps one dark shape for another.

## A first-person weapon looks like a stick

**Cause.** Not the model. `normalizeWeapon()` points a weapon's long axis down
-Z, which is straight away from the camera — so a blade is seen exactly edge-on,
and a blade edge is a line. The saber this happened to is a broad falchion when
you turn it side-on.

**Fix.** Yaw the rest pose until some of the flat faces the camera, and make it
big enough to read: length 1.05 to 1.24 and yaw -0.26 to -0.55 here. Past about
-0.6 the tip leaves the frame on a wide window, so there is a ceiling.

**The swing offsets are relative to the rest pose**, so they move with it. The
old windup added a further -0.2 of yaw to a rest that was already swung out and
put the pommel toward the camera. Re-check both extremes of an animation after
touching the pose it is measured from.

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

**Retime from the speed achieved, not the speed intended.** The other half of the
same bug. Collision is tested per axis, so a creature steering into a wall slides
along it at a fraction of its `speed` while the clip, scaled from `speed`, keeps
running the legs at full — which looks like marching on the spot. The brute shows
it worst: 14.8% of its walking frames have an axis blocked against the zombie's
1.5%, because its 1.6m clearance puts it against walls far more often. Measure
how far the creature actually moved this frame, smooth it, and drive the clip
from that.

## Limbs reach far outside the collision radius

**Cause.** A capsule or circle sized to the torso says nothing about where the
arms go. This zombie's body radius is 0.45m while its skinned vertices reach
1.03m from the origin mid-attack, so it could stand close enough to a wall to put
an arm through it.

**Fix.** `CreatureType.clearance` is a separate, larger radius used only for
creature-versus-wall tests. `r` stays the body, because that is what the player's
attack cone is sized against.

**Measure it per creature, and do not derive it.** Both shortcuts are wrong.
Scaling `clearance` from `r` ignores that the arms, not the torso, set the number.
Scaling it from height fails in both directions at once — measured across the
three creatures, the brute is 1.27x the zombie's height and reaches 1.4x as far,
while the lunatic is *shorter* than the zombie and reaches exactly as far:

| | height | worst moving reach |
|---|---|---|
| zombie | 1.85m | 1.03m |
| brute | 2.35m | 1.46m |
| lunatic | 1.78m | 1.00m |

The figure comes from the pose each creature's own attack clip strikes. Bone
positions understate it too — the skinned vertices are what gets drawn.

Stepping every vertex through every clip with `SkinnedMesh.applyBoneTransform()`
is how those numbers were found, and it is worth doing per clip: the brute's death
clip throws an arm out to 1.69m, but a dying creature does not move, so it is idle,
walk and attack that set the clearance. Add the 1.08 top of `SCALE_VARIANCE` and
round up.

**Then check the pathing, twice.** Geometry first: a 4m corridor leaves
`CELL - 2 * clearance` of usable width, and at the brute's 1.6 that is a 0.8m band
down the middle. Over 20 fresh mazes — 5,455 floor cells and 6,570 adjacent links
— nothing is blocked at either 1.1 or 1.6.

Geometry passing is not the same as moving, though, because collision is tested
per axis and a creature can slide into a corner and sit there. Simulating 250
chases per creature says it never happens: zero freezes, and the brute at 1.6
reaches its target as often as at 1.15. What separates them is speed, not
clearance.

Run that simulation against a **moving** target before drawing conclusions from
it. A flat-0.4s repath and a speed-scaled one look identical chasing a fixed
point, and they stay identical chasing a fleeing player too — which is how a
plausible-sounding "the fast one outruns its own waypoints" change was measured
and then dropped.

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

## A NaN timeScale freezes an animation without any error

**Cause.** `AnimationAction.timeScale = NaN` makes `action.time` NaN on the next
mixer update, and a clip sampled at NaN simply stops advancing. Nothing throws
and nothing warns; the creature keeps moving in whatever pose it was last in.

The NaN came from `THREE.Clock.getDelta()`, which returns **exactly 0** on its
first call — it auto-starts and reports no elapsed time — so a per-frame
`distance / dt` was `0 / 0` on frame one and poisoned every creature at once,
permanently, because `NaN + anything` stays NaN.

**Fix.** Guard the division: `if (dt > 0)`. Nothing can have moved in a
zero-length frame, so skipping it is exact rather than approximate.

**Clamps do not save you.** `Math.max(lo, Math.min(hi, NaN))` is NaN — `Math.min`
and `Math.max` propagate it. A range clamp reads like a safety net and is not one.

## A flex row overflows instead of shrinking

**Cause.** A flex item is `min-width: auto`, which means its minimum is its
*content* — and with `white-space: nowrap` that is the full string. It will not
shrink below it, so on a narrow screen it pushes its siblings out of the
container rather than giving way. The shop's buy button was shoved 29px past the
panel's right edge below 320px, which reads as the text punching through it.

**Fix.** `min-width: 0` on whatever should give way, and let it wrap. Equal row
heights are worth less than never overlapping.

## A full-screen cover lets everything show through it

**Cause.** `opacity` applies to the whole element, its background included. The
loading screen was an opaque `#020304` panel dimmed to `opacity: .6` to soften
its text — which made the *backdrop* 60% transparent, so the HUD, the objective
panel and the click-to-lock card all bled through and collided with the message.
It reads as two things overlapping rather than as a transparency bug, which is
what makes it hard to spot from a screenshot.

**Fix.** Dim the colour, not the element: `color: rgba(...)`. Reach for
`opacity` only when you mean the whole box, backdrop and all.

## An overlay taller than the screen cannot be scrolled to

**Cause.** Two of them, and both have to be fixed or nothing scrolls.

`justify-content: center` on a scrollable flex column puts the overflow *above*
the scroll origin, where it is unreachable — the end-of-run panel is ~460px tall
and a landscape phone is ~390px, so the title and the Descend button were both
cut off with no way to reach either. The fix is `flex-start` plus `margin-top:
auto` on the first child and `margin-bottom: auto` on the last: centred when
there is room, scrollable when there is not.

Then, on touch, `body { touch-action: none }` and a `touchmove` handler that
calls `preventDefault()` unconditionally will swallow the scroll however the
panel is styled. The overlay needs `touch-action: pan-y`, and the game's touch
handlers need to bail out while it is open.

## A held object looks like it is floating beside your head

**Cause.** Nothing in a first-person view holds anything — there is no hand and no
arm, only a model parented to the camera. Weapons get away with it because their
grips run off the bottom of the frame and the edge implies the hand. An object
fully inside the frame with clear air around it has nothing to imply, and reads as
floating. The carried lantern did exactly this.

**Fix, in two parts.** Push it out until the frame corner crops it, and give it
motion that only a held thing would have — the lantern swings on a lag behind the
stride, ramping in and out over 0.38s rather than snapping on with the keypress.
The eye reads a swinging weight long before it notices the missing hand.

**Add that motion on a parent, not on the object.** The sword's swing writes
absolute rotations and the musket's recoil and reload write absolute positions, so
a bob written to the same properties would be overwritten by whichever animation
ran last. `gearBob` is an empty Group between the camera and both weapons: it
carries the stride and composes with everything below it for free. `sword.position`
still reads exactly `SWORD_REST` mid-walk, which is the check that it is working.

**Hung and gripped do not move alike.** The lantern hangs, so it rolls and lags.
The weapons are gripped, so they ride the body in a small figure of eight with the
vertical term at twice the rate — both feet land per cycle. Giving the sword the
lantern's motion made it look like it was dangling from a strap.

**Position by crop is aspect-dependent.** three keeps the vertical fov fixed and
widens horizontally, so a model tuned to sit half-cropped on a 2:1 desktop window
is fully off screen on a portrait phone. Decide whether that is acceptable for the
object in question — for the lantern it is, because the touch move stick occupies
the same corner — but never tune it against a single window size.

## Every creature in the level is drawn, even the ones behind you

**Cause.** A skinned mesh's bounding volume is its **bind pose**, so three culls
animated characters at the wrong moment — they vanish while still on screen. The
usual fix is `frustumCulled = false`, which this loader applies to every creature.
That trades one bug for a bill: nothing is ever culled, so all 40 creatures are
submitted every frame from anywhere in the dungeon. Measured at 1.51M triangles a
frame against 165K for the room itself.

**Fix.** Cull by distance instead, in the frame loop, where the game already knows
how far away each creature is: `mesh.visible = dist < CREATURE_DRAW_DISTANCE`.
Correct by construction, because the number comes from the fog — `FogExp2` at the
lit density of 0.08 is fully opaque by about 27m, so a 30m cut is past anything
that could be seen. It took the same scene to 225K triangles and 359 draw calls
from 441.

They still path, animate and attack out there. Only the drawing stops.

## A camera-child object disappears at the screen edge

**Cause.** Frustum culling misjudges objects parented to the camera.

**Fix.** `frustumCulled = false` on loaded weapon meshes. A held weapon is always
on screen, so there is nothing to save.
