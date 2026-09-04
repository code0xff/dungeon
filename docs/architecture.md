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
scene  ui  shop  guide  textures  dungeon   presentation and generation
config  state  progress  creatures  audio     data and primitives
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
| 1 | first-person weapons and the lantern in hand | second, after `clearDepth()` |

The depth buffer is cleared between them so a held weapon is never clipped by a
wall it is standing inside. This is why `renderer.autoClear` is off, and why the
background colour comes from `renderer.setClearColor` rather than
`scene.background` — see [three.js pitfalls](threejs-pitfalls.md), which explains
what breaks if you move it back.

Anything added to the weapon groups must have its layer set:
`equipWeaponModel()` does this for loaded models, and `scene.ts` does it for the
primitives at module load.

## State

`src/state.ts` is one mutable object for the current run, and `buildWorld()`
resets all of it. Anything that has to outlive a run lives in
**`src/progress.ts`** instead, saved to localStorage:

| | Extraction | Death |
|---|---|---|
| `bankGold` | run gold added | kept |
| `swordDur` | carried as-is | back to full — a new blade |
| `stage` | +1 | back to 1 |
| `hp` | carried as-is | back to 100 |
| lantern fuel, ammo | carried into the next stage | lost |
| potions, lanterns, whetstones | carried into the next stage | lost |

The map is deliberately absent: it charts *this* dungeon, and the next stage
generates a new one, so carrying it would hand the player a plan of a maze they
are not standing in. The **key** is absent for the same reason and a stronger
one — it is the objective, so every stage has to be searched for its own.

Health is carried precisely because it makes stopping at the portal a decision
rather than a formality, and unspent potions and lanterns are carried because
walking out with a full pack is part of what extraction is worth.

**Bodies are solid.** `collides()` only ever knew about walls, so for a long
time nothing in the game compared two creature positions: they were *placed*
without overlapping and then all pathed to the same point — the player — and
converged into one another. `separateMonsters()` runs after everything has moved
and pushes overlapping pairs apart at `CREATURE_PUSH`, bucketed by the widest
creature's diameter so stage 12's 113 creatures cost a neighbour check rather
than 6,328 pairs.

It is a push and not a wall on purpose. Creatures that blocked each other
outright would cork the first corridor they entered and leave everything behind
them queueing, which makes being surrounded *safer*. The resting gap is where the
push balances the crowd still pressing inward at walking speed, so the number is
set by what it has to beat rather than by the body size.

The player is solid to creatures too, with two exemptions that are the whole
design:

- **A dodge shoulders through.** `config.ts` already called the dodge "what turns
  a blocked corridor from a death into a decision", and that is only true if it
  is the one thing that gets through a body. Solid creatures without it make
  being surrounded a cage rather than a threat.
- **You can always walk out of what walked into you.** The test is *entry*, not
  overlap: a move is refused only if it enters a creature the player is not
  already inside. Creatures walk into the player, so a plain occupancy test would
  pin them in place exactly where they can least afford it.

Shoves are checked against the player as well, one way only — a crowd cannot
push the player around, but it also cannot squirt one of its own through the
player's body and into the camera. Walking creatures never get that close on
their own; they all stop at `reach * 0.75`, which is wider than their radius plus
the player's, so only the shove needed the check.

Kill gold is **rolled per kill**, `REWARD_SPREAD` either side of the creature's
`reward`. A fixed payout meant you knew what a corridor was worth before walking
into it. The roll is returned by `killMonster()` rather than read back off the
type, so the message and the HUD cannot show different numbers.

## What a stage is worth

The stage number is the difficulty, and it moves **two** dials.

**The dungeon grows.** `dungeonSize()` ramps from `MAZE_CELLS_START` to
`MAZE_CELLS_PEAK` on the same schedule as the spawns: stage 1 is 76m a side and
about 173 floor cells, stage 12 is 124m and 505. The peak is exactly what every
stage used to be, so only the early game changed. Dungeons are no longer square
either — the aspect is rolled per run and the stretch is area-preserving, so a
long thin dungeon holds the same content and sits at the same point on the curve.

**And it fills up.** `SPAWN` gives each creature a count and a per-stage
increase, both written against `REF_FLOOR_CELLS` and multiplied by the area
actually carved. That scaling is the whole reason a smaller stage 1 is easier
rather than harder: the same 40 creatures in a third of the space would have been
three times the density. Measured across 14 runs a stage, the density curve is
unchanged at 12.5 floor cells per creature falling to 4.5, while the headcount
drops from 40 to 14 and the key sits 51m from the start instead of 92m. What a
short stage buys is less ground to search and less time exposed — the half of
stage-1 difficulty the spawn curve was never going to fix, because it was
already sparse.

Nothing may assume a compile-time grid size: `state.gw` and `state.gh` are the
dungeon's dimensions and change every stage. Floor and ceiling texture repeats
are set per build for the same reason — a fixed repeat stretches the cobbles by
whatever the stage changed the map to.

Growth stops at `SPAWN_PEAK_STAGE`, and the **stage** is clamped rather than the
total. Capping the sum would have silently changed the mix at the top by
dropping whichever creature was counted last; clamping the input keeps the ratio
the formula intended.

The ratio moves on purpose. Brutes and lunatics grow faster than zombies, from
65% zombies down to 56%, because a deeper stage should change *what* kills you
and not only how much of it there is.

## Pausing

`state.paused` is set only by the guide. The frame loop still renders — the panel
sits over a dungeon that looks alive — but nothing advances, so reading the
controls cannot get the player killed. Input is gated to match: with the guide
open, only the keys that close it or change the sound do anything, or Space
would swing the sword at a frozen dungeon.

It is deliberately separate from `gameOver`. That one means the run is over and
the shop is up; this one means the world is on hold and will carry on.

## Gold has a sink

`src/shop.ts` is the outfitting screen between stages, and it exists because
`bankGold` had nothing to spend on — it was a score, which meant there was no
reason to extract rather than push until something killed you.

It works on **`progress`, never on `state`**. By the time it is on screen the run
is over and `buildWorld()` has not run yet, so `progress` is the only thing that
reaches the next dungeon; buying into `state` would be spending gold on a run
about to be overwritten. Nothing has to be handed across as a result — the shop
writes, `buildWorld()` reads.

It opens after death as well as after extraction. The bank survives death, and
being able to kit out a fresh stage 1 with it is what turns banking into a
decision.

Prices rise with the stage and flatten at `SPAWN_PEAK_STAGE`, the same point the
spawns do — income stops growing there, so prices that kept climbing would
eventually outrun any possible run. The rate is set below the rate income grows
at, so progress still feels like progress; it just stops being free.

The sword's durability is the recurring bill that keeps the sink open. It wears
per creature *cut*, not per swing, so a cleave that catches two costs two, and
one thorough run roughly blunts a blade.

## The shape of a run

`CHEST_ITEMS` puts exactly one key in the dungeon and the portal refuses to open
without it, so a run is a search rather than a crossing. The key sits a median
51m from the start on stage 1 and 72m by stage 12, as the dungeon grows. That is
what makes the map worth finding: it marks which chests are still shut.

The minimap draws the whole dungeon fitted to its canvas, one scale on both axes
so a lopsided map is drawn lopsided. A player-centred window would have been the
obvious answer to a map that grows, and is the wrong one: the map is the single
item whose entire value is *seeing the layout*, and the sizes never make it
unreadable — 19 to 31 cells a side is 7.9 to 4.8 pixels a cell on a 150px canvas,
against the 4.8 the old fixed size always gave.

Looting is the other cost. `startLoot()` alerts everything within
`CHEST_ALERT_RADIUS` the moment the lid creaks — not when it finishes opening,
which is where it used to be. Those are `LOOT_TIME` apart, and since moving
cancels a loot, charging at the end meant the whole cost landed after the risk
had already been taken. Alerting on the sound is what makes the progress bar mean
something: they are already coming and you have to stand still anyway, and
backing out cancels the loot but not the noise.

The radius is absolute while creature counts scale with floor area, so map size
does not enter into how loud a chest is — only density does. Measured over 200+
chests a stage: a mean of 0.72 creatures hear one on stage 1 against 2.07 at
stage 12, and 46% of stage-1 chests are opened in silence against 13% at the
peak. That curve is the spawn curve, which is the intended shape.

## Traps

Traps here are **not a damage tax**, and that is the design rather than a
softening. HP is already what creatures spend and potions restore, so a hazard
that only subtracts from it adds a cost without adding a decision. `TRAP_DMG` is
10 — a third of a potion — and exists so the spring has a physical bite. What a
trap actually spends is the dungeon's attention: `TRAP_ALERT_RADIUS` is 24m
against the musket's 20m, deliberately the loudest thing in the game, because a
shot at least kills something and this buys nothing. It is the only noise you
make by accident.

`springTrap()` is shared by the floor traps and the trapped chests because they
are the same event. It returns its line rather than showing it — a trapped chest
is already about to announce what was inside, and the first version had that
overwrite the trap message a few milliseconds later, swallowing the only part
that mattered.

**Two systems get a second job out of this.**

The **lantern** was a timer: you lit it and waited for it to burn out. Traps are
pale, knee-high geometry lit by nothing but the player's own lamp, so spotting
distance is exactly `LIGHT_DIM.distance` against `LIGHT_LIT.distance` — 11m
against 19m. Lighting one is now a decision about a corridor. Nothing in code
hides or reveals a trap; it is only ever the light.

The **map** only ever said which chests were still shut. It now draws trapped
ones red, which is worth knowing before crossing a dungeon to reach one.

A chest trap fires when the lid comes open, not on the creak, so backing out of a
loot you have started still avoids it. That is what makes the tell on the lid
worth reading — seeing it only helps if there is still a choice left. The best
case is the key being in a trapped chest: then there is no decision at all, only
a price.

The dodge is the other half of that: with every creature slower than the player,
the pressure has to come from being *surrounded*, and the dodge is what turns a
blocked corridor from a death into a decision. It takes its direction from the
movement keys rather than having its own, which is what keeps it to one finger.

Consumables are **carried, not applied**. Opening a chest puts a potion, a
lantern or a whetstone in the pack; `POTION_KEY`, `LANTERN_KEY` and
`WHETSTONE_KEY` spend one. All three refuse rather than waste — at full health
the potion stays in the pack, and a keen blade will not take a stone. The point
is that light, healing and a working edge become decisions about *when*, which
is the only way a resource is really a resource.

The whetstone exists because the shop is only open between stages. Before it, a
sword that went blunt halfway down stayed blunt for the rest of the run and the
only answer was to leave early — a resource problem with one legal move is not a
decision. It is deliberately *worse* gold-for-durability than the counter
repair: the premium buys the ability to spend it at the bottom.

**The lunge** is the one place attack timing matters. An attack pressed within
`LUNGE_WINDOW` of a *forward* dodge does `LUNGE_DMG`x damage — and costs
`LUNGE_DMG`x durability, so aggression has a bill rather than being free. It is
armed off the dodge direction, not the camera, so swinging the view around
mid-dodge earns nothing; and it is latched when the player presses rather than
read when the blade lands, because those are `SWING_IMPACT / SWING_SPEED` apart
and the window belongs to the input. Exactly one swing is bought: the flag is
cleared at the press, so the follow-up is an ordinary hit.

The window is **shown on the blade**, which glows and fades out over it. The
crosshair would have been the obvious place and is the wrong one — it is only
drawn for the musket. The sword is always on screen, it is the thing the bonus
applies to, and the fade *is* the countdown, so there is no second element to
read. On touch the attack button lights with it, because a thumb is nowhere near
the sword in the corner. Both are driven outside the paused/dead block in
`animate()`: frozen while the guide is open (correct — so is the window) and
extinguished on death, where a still-glowing sword behind the panel would read
as an effect that got stuck.

The split is the whole point of an extraction game — keep the two apart. A field
that should reset but lives in `progress` becomes a permanent buff; one that
should persist but lives in `state` is silently wiped every run.

`endRun()` captures the carry **before** `buildWorld()` runs, which is why it
banks at the end of the old run rather than at the start of the next one.

There is no reactivity. Systems read and write `state` directly, and `ui.ts`
pushes to the DOM when something calls `updateHUD()`. If you add a field to
`state`, reset it in `buildWorld()` — a field that persists across runs by
accident is a bug that only shows up on the second run. If you add one to
`progress`, handle it in both `bankRun()` and `loseRun()`, and read it back
defensively: `merge()` type-checks every stored field so a corrupt save
degrades to the default instead of poisoning a run with NaN.

## Offline and install

The game is a PWA. `assets/manifest.webmanifest` and `assets/sw.js` sit in
`publicDir`, so vite copies them verbatim to the site root and both use relative
paths — that is what lets the whole thing work under the `/dungeon/` project
sub-path without a build-time rewrite.

The worker is registered from `main.ts` **only in a production build**
(`import.meta.env.PROD`); a caching worker in dev would serve stale modules and
make HMR lie about what is running.

One trap worth stating outside the file: **`code0xff.github.io` is a single
origin for every project page on the account**, so Cache Storage, localStorage
and service worker registrations are shared with the other apps published there.
Cache names carry a `dungeon-` prefix and the activate sweep only deletes within
it; a sweep written as "delete everything that is not the current cache" wipes a
neighbouring app's offline copy. The localStorage key is namespaced for the same
reason.

Its caching strategy and the reasoning are documented at the top of `sw.js`.
The short version: navigations are network-first so a deploy is picked up, and
everything else is stale-while-revalidate so the ~8.5MB of assets loads instantly
on a second visit.

**Assets carry a version on their URL, and it is load-bearing.** Vite
content-hashes the bundle filenames, so code changes reach everyone by
themselves; models and textures keep fixed names, so they do not.
`creatures/brute/idle.glb` was the same URL before and after the model behind it
was replaced, and stale-while-revalidate answered from cache — a returning player
kept last deploy's creature, and because a model with no mesh falls back to the
box model, it looked like a regression rather than a stale cache. `hashAssets()`
in `vite.config.ts` hashes the whole `assets/` folder into `__ASSET_VERSION__`,
which goes onto every asset URL and onto the worker's own registration URL. A
changed asset is now a different URL, and so a cache miss.

The version is **not** part of the cache name, and that is the subtle half. It
was, briefly, and it broke offline: the page's requests are served by whichever
worker is already in control, so on the load after a deploy they land in the
*old* cache, and the new worker's activate sweep then deletes them — the JS
bundle included. The game came back from that with a loading screen and no error
in the console. One durable `dungeon-v1` cache, pruned on activate of entries
whose `?v=` no longer matches, has no such window: the shell and the
content-hashed bundles are never touched, only superseded assets are.

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
