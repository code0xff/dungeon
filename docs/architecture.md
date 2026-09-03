# Architecture

A single-page Three.js game. No framework, no router, no state library. One
module per concern, wired together by `main.ts`.

## Boot sequence

`src/main.ts` is the only entry point and does four things in order:

1. `loadAssets()` — fetch every external model and texture, reporting progress to
   the loading overlay. It never throws for a missing asset; it logs and falls back.
2. Hide the overlay.
3. `buildWorld()` — generate the maze, build geometry, spawn creatures, chests,
   props and sconces, and reset the run.
4. `animate()` — start the `requestAnimationFrame` loop.

`import './input'` is there purely for side effects: it registers the keyboard,
mouse and touch listeners and the audio unlock.

## Module layers

Imports flow strictly downward. Nothing in a lower layer may import from a
higher one, and there are no cycles.

```
main                        entry
loop                        frame loop, creature AI
world  input  combat  loot  weapons        systems
props                       world content built from assets
assets                      external model and texture loading
scene  ui  textures  dungeon               presentation and generation
config  state  creatures  audio            data and primitives
types  dom                  leaves, no internal imports
```

Two edges are worth knowing because they are easy to reverse by accident:

- **`assets` imports `scene`**, to hand a loaded weapon model to
  `equipWeaponModel()`. So `scene` must never import `assets`.
- **`props` imports `assets`**, to clone the loaded chest. So `assets` must never
  import `props`.

## Rendering

`renderFrame()` in `src/scene.ts` draws **two passes over the same scene**,
separated by layers:

| Layer | Contents | Pass |
|---|---|---|
| 0 | the world — walls, floor, creatures, chests, props | first |
| 1 | first-person weapons and the torch in hand | second, after `clearDepth()` |

The depth buffer is cleared between them so a held weapon is never clipped by a
wall it is standing inside. This is why `renderer.autoClear` is off, and why the
background colour comes from `renderer.setClearColor` rather than
`scene.background` — see [three.js pitfalls](threejs-pitfalls.md), which explains
what breaks if you move it back.

Anything added to the weapon groups must have its layer set:
`equipWeaponModel()` does this for loaded models, and `scene.ts` does it for the
primitives at module load.

## State

`src/state.ts` is one mutable object for the current run. `buildWorld()` resets
nearly all of it; **`bankGold` is the only field that survives a run**, because
that is the whole point of an extraction game.

There is no reactivity. Systems read and write `state` directly, and `ui.ts`
pushes to the DOM when something calls `updateHUD()`. If you add a field, reset
it in `buildWorld()` — a field that persists across runs by accident is a bug
that only shows up on the second run.

## Frame loop

`animate()` in `src/loop.ts`, in order: player, weapons, creatures, chests,
atmosphere, audio pacing, render.

`dt` is clamped to 0.05s. A backgrounded tab stops firing
`requestAnimationFrame`, and without the clamp the first frame back would deliver
several seconds at once and teleport everything. Anything you write that
integrates over `dt` must tolerate a frame that large.

## Coordinates and units

- **Metres.** Creature heights, weapon lengths and reach are all real-world
  scale. `CELL` is 4m, `WALL_H` is 3.4m, eye height is 1.55m.
- **The maze grid** is `maze[z][x]`, `0` floor and `1` wall, `GRID` cells square.
  World position is `cell * CELL`.
- **-Z is forward.** Weapon models are normalised so their long axis points down
  -Z; `facing()` in `combat.ts` returns the horizontal unit vector for the yaw.

## Fallbacks

Every external asset is optional. A missing model or texture logs a line in the
`[assets]` console summary and the game uses a primitive built in code:

| Asset | Fallback |
|---|---|
| creature model | box model from `creatures.ts` |
| weapon models | primitives in `scene.ts` |
| chest model | primitive chest in `props.ts` |
| wall/floor PBR | canvas textures from `textures.ts` |

This is a hard contract, not a nicety — it is what lets a fresh clone run and
lets assets be dropped in one at a time. See [assets](assets.md).
