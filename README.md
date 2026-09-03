# Dungeon

A first-person dungeon crawler in **TypeScript + Three.js**. Grab the loot, get out
through the blue portal — die and everything you picked up this run stays down there.

**▶ [Play it](https://code0xff.github.io/dungeon/)**

Extract and your health, lantern fuel and ammo carry into the next stage — the
map does not, because the next dungeon is a different one. Die and the run's
gold and everything you were carrying stays down there. Only the bank survives,
and it is saved to the browser.

The lantern is the clock: about two and a half minutes of light per pickup, and
whatever is left burns on into the next stage.

It installs as a PWA and plays offline after the first visit.

Creatures (FBX/GLB plus animations) and the wall/floor PBR textures load from
external files, and **anything missing falls back to a box model or a texture drawn
in code**. So the game runs on a fresh clone and you can drop assets in one at a
time and watch them appear.

```
dungeon/
├─ index.html
├─ package.json  tsconfig.json  vite.config.ts
├─ src/
│  ├─ main.ts        bootstrap: load assets → buildWorld → animate
│  ├─ config.ts      constants, creature stats (TYPES), asset paths
│  ├─ types.ts       domain types — Monster, Chest, CreatureRig …
│  ├─ state.ts       mutable state for one run
│  ├─ progress.ts    what survives a run — bank, stage, carried gear
│  ├─ scene.ts       renderer, camera, lights, first-person weapons
│  ├─ textures.ts    procedural fallback textures (stone, cobble, wood)
│  ├─ dungeon.ts     maze generation and BFS pathfinding
│  ├─ creatures.ts   procedural fallback creature model
│  ├─ props.ts       chests, bone piles, barrels, chains, sconces
│  ├─ assets.ts      FBX/GLB and PBR texture loading, with fallbacks
│  ├─ audio.ts       WebAudio ambience and sound effects
│  ├─ input.ts       keyboard, mouse (pointer lock), touch
│  ├─ ui.ts          HUD, messages, minimap, end-of-run overlay
│  ├─ weapons.ts     weapon swap and reload
│  ├─ combat.ts      sword, musket, taking damage
│  ├─ loot.ts        opening chests, picking things up
│  ├─ world.ts       collision and buildWorld
│  └─ loop.ts        creature AI/animation, frame loop
├─ scripts/
│  ├─ optimize-assets.mjs   raw/ FBX → assets/ GLB, textures shrunk
│  └─ fetch-assets.mjs      pull textures and weapons from Poly Haven
├─ raw/                     Mixamo FBX sources (never served, git-ignored)
│  └─ creatures/<key>/      idle.fbx  walk.fbx  attack.fbx  death.fbx
└─ assets/                  served assets (committed)
   ├─ creatures/zombie/     idle.glb  walk.glb  attack.glb  death.glb
   ├─ creatures/brute/      idle.glb  walk.glb  attack.glb  death.glb
   ├─ creatures/lunatic/    idle.glb  walk.glb  attack.glb  death.glb
   ├─ weapons/              sword.glb  musket.glb
   ├─ props/                chest.glb  lantern.glb
   ├─ icons/                PWA icons
   ├─ manifest.webmanifest
   ├─ sw.js                 service worker (offline cache)
   └─ textures/
      ├─ wall/              diffuse.webp  normal.webp  rough.webp
      └─ floor/             diffuse.webp  normal.webp  rough.webp
```

Three creatures, each built around one idea. Without a creature's files the game
falls back to a box model for it.

| | HP | Damage | Speed | Notices you | Reward | Per run |
|---|---|---|---|---|---|---|
| **Zombie** | 4 | 17 | 2.9 | 13m | 12 G | 43 |
| **Brute** | 9 | 32 | 2.0 | 13m | 55 G | 13 |
| **Lunatic** | 3 | 14 | 4.5 | 18m | 30 G | 16 |

Seventy-odd of them across a 124m dungeon, and standing still is how you die. **The sword cuts the two
nearest creatures in its arc, not everything in front of it**, so a crowd is a
crowd — the answer to being surrounded is the corridor behind you, or the musket
before they arrive. Every creature is slower than you even at the top of its
speed variance, so retreating always works; it just tends to back you into
something else.

Working on this with a coding agent? Start at [AGENTS.md](AGENTS.md) — the ground
rules, with the detail in [docs/](docs/). `CLAUDE.md` is a symlink to it.

| | |
|---|---|
| Move | `WASD` |
| Dodge | `Shift` — a 3.8m burst the way you are already moving |
| Look | move the mouse (click to lock the cursor, `Esc` to release) |
| Attack / fire | click or `Space` |
| Open chest | `E` |
| Swap weapon | `Q` |
| Drink potion / light lantern | `3` / `4` |

The dodge has no invulnerability frames. It gets you out of a creature's reach
before the blow lands, which is why 3.8m — the brute swings from 2.2m. On a 1.1s
cooldown, so spamming it averages 3.5m/s against a walk of 5.2: it is a way out
of a swing, never a way to cross the dungeon.

---

## 1. Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | dev server with HMR, bound to 0.0.0.0 |
| `npm run build` | typecheck, then bundle into `dist/` |
| `npm run preview` | serve the build |
| `npm run typecheck` | typecheck only |
| `npm run fetch-assets` | re-download textures and weapons from Poly Haven |
| `npm run optimize-assets` | convert `raw/` FBX into `assets/` GLB |

The console (F12) carries an `[assets]` line saying which creatures and textures
loaded and which fell back.

> **Asset paths.** `publicDir: 'assets'` in `vite.config.ts` serves the whole
> `assets/` folder from the site root. Files go where this README says —
> `assets/creatures/…`, `assets/textures/…` — but the URLs in `src/config.ts` drop
> the leading `assets/` (`creatures/zombie`). The build copies it all into `dist/`.

---

## 2. Deploying

Pushing to `dev` builds and publishes to GitHub Pages through
`.github/workflows/deploy.yml`. Nothing else to do.

The build uses a relative `base`, so `dist/` works from any sub-path — the project
URL, a custom domain, or a local `npx serve dist`.

---

## 3. Creatures — Mixamo

https://www.mixamo.com (free, needs an Adobe account)

### Pick a character

Search the **Characters** tab for `zombie` and select one.

### Download it with animations

With the character selected, go to the **Animations** tab and grab four clips:

| Filename | Search for |
|---|---|
| `idle.fbx` | `zombie idle`, `idle` |
| `walk.fbx` | `zombie walk`, `walk` — tick **In Place** if you can; the loader strips root motion either way and says so in the `[assets]` log |
| `attack.fbx` | `zombie attack`, `punch`, `swing` |
| `death.fbx` | `zombie death`, `dying`, `death` |

For the brute and the lunatic, a heavier and a leaner character and the same four
slots. The four do not have to come off one download: Mixamo numbers the rig
differently every time (`mixamorig5:Hips` on one, `mixamorig:Hips` on another)
and the loader strips the number, so any character's clips bind to any
character's skeleton.

**The filenames are slots, not descriptions.** `walk.fbx` is whatever the
creature does to cover ground — the lunatic's is a sprint. The loader measures
the clip's real speed from its root motion and retimes playback to match the
creature's `speed`, so a run and a shamble both go in the same slot.

**Download settings**

- Format: **FBX Binary (.fbx)**
- Skin: **With Skin** for `idle.fbx` only, **Without Skin** for the other three
  (a tenth of the size, and the model comes from idle anyway)
- Frames per Second: 30
- Keyframe Reduction: none

> **Choose a character on the Characters tab first.** Downloading straight from the
> Animations tab hands you Mixamo's default mannequin (`Beta_Surface` /
> `Alpha_Surface` — Y Bot and X Bot), which has no textures at all. A grey dummy in
> game is this; the `[assets]` log says so.
>
> An `idle.fbx` downloaded Without Skin has a skeleton but no mesh, so nothing
> renders. That shows up in the log as `no mesh (re-download idle with "With Skin")`
> and falls back to the box model.

Rename the files as above and drop them in `raw/creatures/<key>/` — the folder
name is the key in `CREATURE_ASSETS` — then run `npm run optimize-assets`. No
Blender round-trip needed. `raw/` is git-ignored, so delete the FBX once the GLB
are baked; nothing reads them again.

### Checking it worked

- Reload and look for `zombie: loaded [idle, walk, attack, death]` in the console.
  A `⚠ only n/m tracks bind` on that line means the clips and the body came off
  rigs the loader could not reconcile.
- Wrong size? Adjust `height` (metres) in `CREATURE_ASSETS`, `src/config.ts`.
- Walking at you backwards? That character's origin faces the other way. Rare, but
  the fix is `model.rotation.y = Math.PI` in `spawnCreature()`, `src/assets.ts`.

---

## 4. Walls, floors and weapons — Poly Haven

```bash
npm run fetch-assets
```

Poly Haven (CC0) serves these from a public API with no account, so the files land
in `assets/` directly and nothing is kept under `raw/`. What gets fetched is the
`PICKS` table at the top of `scripts/fetch-assets.mjs`.

| Slot | Current asset | Browse |
|---|---|---|
| wall | `medieval_blocks_05` | https://polyhaven.com/textures (wall) |
| floor | `cobblestone_floor_08` | https://polyhaven.com/textures (floor) |
| sword | `wooden_handle_saber` | https://polyhaven.com/models |
| lantern | `Lantern_01` | https://polyhaven.com/models |
| musket | `bolt_action_rifle_7_62` | https://polyhaven.com/models |
| chest | `treasure_chest` | https://polyhaven.com/models |

To change one, swap its id in `PICKS` and run the script again. Each model entry
also carries `dir` (where under `assets/` it lands), `texture` (longest edge to
re-bake at) and an optional `simplify` ratio.

- Everything is fetched at **1K**. 2K and up is heavy on mobile and invisible in a
  dark dungeon.
- The JPGs are re-baked as **webp**: walls and floors 3.8MB → 1.4MB, weapons
  7.7MB → 1.2MB. The loader checks webp first and falls back to jpg, so dropping
  Poly Haven's own JPGs into the folder still works.
- Only the normal map gets the higher quality (90 against 80). Its pixels are
  vectors rather than colour, so whatever compression smears turns the lighting the
  wrong way. Colour and roughness survive 80 unnoticed.
- Normals must be **`nor_gl`** (OpenGL). `nor_dx` inverts the relief in Three.js.
- Too bright? Turn down `AmbientLight` or `toneMappingExposure` in `src/scene.ts`.
- The chest is decimated to a fifth of its triangles — ten of them are in the
  dungeon at once and the source is 68k. At torchlight range the loss does not show.

### Swapping the chest

`PROP_ASSETS.chest` in `src/config.ts` names the node the open animation hinges on
(`lidNode`). A replacement model needs its lid as a separate node hinged at the
back, the same convention the primitive chest uses; without that node the loader
refuses it and falls back rather than shipping a chest that cannot open.

### When a weapon model does not sit right in the hand

Every model has its own origin and axes. `WEAPON_ASSETS` in `src/config.ts` fits it:

| Field | What it does |
|---|---|
| `rot` | turns the model's long axis down -Z, in front of the camera |
| `length` | total length after normalising, in metres |
| `back` | how far it reaches behind the origin. Shrink it when the grip runs off screen |

Where it sits on screen is `SWORD_REST` / `MUSKET_REST` in `src/scene.ts`. The
muzzle flash and smoke position themselves — the loader finds the barrel end.

The sword is raised, then brought down. `SWING_SPEED` (overall rate),
`SWING_WINDUP` (share of the cycle spent raising) and `SWING_IMPACT` (when damage
resolves) are in `src/config.ts`; the raised and cut-through poses are `SWING_UP` /
`SWING_DOWN` in `src/loop.ts`. Keep the downswing — `SWING_WINDUP` to
`SWING_IMPACT` — at five frames or more at 60fps, or the blade does not read as
passing through.

Poly Haven has **no musket or flintlock**, so a bolt-action rifle stands in. The
name stays `musket` throughout the code.

---

## 5. Licences

Mixamo characters and animations are free to use and ship inside a game, including
commercially, but **the FBX files themselves must not be redistributed**. So `raw/`
is git-ignored and only the baked `assets/creatures/**/*.glb` is committed.

Poly Haven assets — wall and floor textures, weapon models — are **CC0**: no
attribution, redistribution and commercial use allowed.

---

## 6. Ideas

- **Shadows** are off. `renderer.shadowMap.enabled = true` in `src/scene.ts` plus
  `castShadow` on the player's light turns them on, but there are a lot of walls, so check
  mobile performance.
- **Better props** — barrels, skulls, chains — from the Poly Haven Models tab.
