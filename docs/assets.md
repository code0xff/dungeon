# Assets

Two sources, two pipelines, one rule: **the game runs without any of them.**

## Layout

```
raw/          Mixamo FBX sources. Git-ignored, never served, 100MB+ per file.
assets/       Everything the game loads. Committed. Served from the site root.
```

`publicDir: 'assets'` in `vite.config.ts` serves `assets/` from the root, so the
URLs in `src/config.ts` drop the leading `assets/`: the file
`assets/creatures/zombie/idle.glb` is loaded as `creatures/zombie/idle.glb`.

`assets/` is committed on purpose. It is about 6MB of baked derivatives, and
committing it is what lets a fresh clone run the real game rather than the box
models. `raw/` is not, both for size and because Mixamo forbids redistributing
the FBX files themselves.

## The two pipelines

| | Mixamo | Poly Haven |
|---|---|---|
| What | creature models and animations | textures, weapons, props |
| Account | Adobe, free | none |
| Sources kept | `raw/`, git-ignored | none — refetch from the API |
| Command | `npm run optimize-assets` | `npm run fetch-assets` |
| Licence | free to ship, **no FBX redistribution** | CC0, no attribution |

`fetch-assets` is fully reproducible: the ids live in `PICKS` at the top of
`scripts/fetch-assets.mjs`, and rerunning it rebuilds every file. `optimize-assets`
needs `raw/` to be populated by hand first.

## The fallback contract

**A missing asset must never break the game, and must never fail silently.**
Every loader:

1. Returns a primitive fallback when the file is absent.
2. Pushes a line to the `[assets]` console summary saying which path it took.
3. Says what to *do* when the reason is fixable — `no mesh (re-download idle
   with "With Skin")`, not `load failed`.

Rule 3 is not decoration. A silently invisible zombie took far longer to
diagnose than a log line would have.

Validate before accepting, not after. `loadChest()` rejects a model with no
`lidNode` and falls back, because a chest that renders but cannot open is worse
than an honest box.

## Normalising models

Source models arrive at arbitrary scale, origin and axis. Normalisation is data
in `src/config.ts`, not code.

**Weapons** (`WEAPON_ASSETS`) — the loader applies these in order:

| Field | Meaning |
|---|---|
| `rot` | rotation that points the model's long axis down -Z |
| `length` | total z length after a uniform scale, in metres |
| `back` | how far it reaches behind the origin, which puts the grip at the origin |

The muzzle is **found, not configured**: `findTip()` averages the frontmost 2cm
of vertices, so the flash and smoke place themselves. Prefer deriving a value
from the model over adding a constant someone has to keep in sync.

**Props** (`PROP_ASSETS`) — `height` in metres, plus any node names the game
needs to drive, such as the chest's `lidNode`.

Creature sizing is in `CREATURE_ASSETS.height` and is measured from bones, not
the bounding box. See [three.js pitfalls](threejs-pitfalls.md).

## Budget

Roughly 6MB total, and it should stay in that range — this ships to phones.

| | |
|---|---|
| creatures | 2.6MB (idle carries the skin and textures; the other clips are curves only) |
| weapons | 1.2MB |
| props | 0.9MB |
| textures | 1.4MB |

Rules of thumb that got it there:

- **1K textures.** 2K is invisible in a dark dungeon and heavy on mobile.
- **webp everywhere**, quality 80, except normal maps at 90.
- **Only one clip carries the mesh.** Walk, attack and death are stripped to
  animation curves, because the game reads nothing but `animations[0]` from them.
- **Decimate what there are many of.** Ten chests are on screen at once, so the
  chest is simplified to a fifth of its triangles.

Before adding a megabyte, check whether the source has a smaller variant, whether
the texture can be halved, and whether the mesh can be decimated.

## Swapping an asset

1. Change the id in `PICKS` (`scripts/fetch-assets.mjs`) or drop new FBX into
   `raw/`.
2. Run the matching npm script.
3. Reload and read the `[assets]` line.
4. Look at it in the browser. Size, orientation and material are all things that
   typecheck perfectly and still come out wrong.
5. Adjust `WEAPON_ASSETS` / `PROP_ASSETS` / `CREATURE_ASSETS` if it does not sit
   right, then commit the regenerated file alongside the config change.
