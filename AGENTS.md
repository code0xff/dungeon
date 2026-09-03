# AGENTS.md

Ground rules for coding agents working on **Dungeon**, a first-person dungeon
crawler in TypeScript and Three.js. Read this file first; it is the premise. The
detail lives in `docs/`.

## Where things are

| Document | Read it when |
|---|---|
| [docs/architecture.md](docs/architecture.md) | touching module structure, the render passes, state or the frame loop |
| [docs/assets.md](docs/assets.md) | adding, swapping or resizing anything under `assets/` or `raw/` |
| [docs/code-quality.md](docs/code-quality.md) | writing any code — the standards and the review checklist |
| [docs/threejs-pitfalls.md](docs/threejs-pitfalls.md) | anything renders, animates or is sized wrongly |
| [docs/testing.md](docs/testing.md) | before claiming a change works |
| [README.md](README.md) | the player- and contributor-facing guide |

## The premises

**1. `npm run build` must pass before every commit.**
`tsc --noEmit && vite build` is the only automated gate there is. There is no
linter and no test suite, so nothing else will catch you.

**2. Everything is English.** Code, comments, identifiers, console output, UI
strings, docs, commit messages. The project was deliberately converted; do not
reintroduce another language.

**3. Every external asset is optional.** A missing model or texture falls back to
a primitive built in code and logs a line saying which path it took and how to
fix it. Never let a missing file break the game, and never let it fail silently.

**4. Tunable numbers live in `src/config.ts`** with a doc comment explaining the
trade-off, never inline. Text shown to the player derives from the constant
rather than repeating its value.

**5. Comments explain why the obvious thing is wrong.** This codebase is dense
with them on purpose — most encode a Three.js trap that cost hours. Match that
density, and delete comments that stop being true.

**6. Look at visual changes in a browser.** Size, orientation, material and
timing all typecheck perfectly while being completely wrong. A screenshot is
evidence; a passing build is not.

**7. Measure claims about frequency.** For anything random, run the selection
thousands of times before and after rather than reloading once and calling it
fixed.

**8. Strict types.** No `any`. Every `!` or cast carries a written reason.
Domain types belong in `src/types.ts`.

**9. `raw/` is never committed; `assets/` always is.** Mixamo forbids
redistributing the FBX sources, and the ~7MB of baked output is what lets a fresh
clone run the real game. Keep the asset budget near 7MB — this ships to phones.

**10. Do not add dependencies casually.** `three` is pinned to `0.152.2` with a
matching `@types/three`; upgrading is a deliberate task, not a side effect.

## Commands

```bash
npm install
npm run dev              # dev server, HMR, bound to 0.0.0.0
npm run build            # the gate: typecheck, then bundle to dist/
npm run typecheck        # types only
npm run preview          # serve the build
npm run fetch-assets     # re-pull textures, weapons and props from Poly Haven
npm run optimize-assets  # convert raw/ FBX into assets/ GLB
```

Pushing to `dev` deploys to <https://code0xff.github.io/dungeon/>. `dev` is the
default branch and the only one; there is no `main`.

## Before you finish

Run the checklist at the end of [docs/code-quality.md](docs/code-quality.md).
The two most often skipped: exercise the fallback path with the asset removed,
and actually look at the result.
