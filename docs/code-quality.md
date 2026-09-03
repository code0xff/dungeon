# Code quality

There is no linter. `npm run build` — `tsc --noEmit` then `vite build` — is the
whole automated gate, and it is not enough on its own. The rest is this document.

## The gate

```bash
npm run build     # must pass before every commit, no exceptions
```

TypeScript runs strict, with `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` and `verbatimModuleSyntax`. A build failure is never
"unrelated" — fix it or revert.

## Types

- **No `any`.** Not in a cast, not in a generic. If a Three.js type is awkward,
  write a type guard — `isMesh()` in `assets.ts` is the pattern.
- **`import type` for types.** `verbatimModuleSyntax` requires it.
- **Non-null `!` needs a stated reason.** Where `props.ts` writes
  `getObjectByName(...) as THREE.Object3D`, the line above says why it cannot be
  null: the loader already rejected models without that node. An unexplained `!`
  is a bug waiting for a different asset.
- **Domain types live in `src/types.ts`.** Not inline, not duplicated.
- **Widen deliberately.** `Chest.lid` is `Object3D` rather than `Group` because a
  glTF node carrying geometry arrives as a `Mesh`. Note that reasoning where the
  type is declared.

## Constants

**Every tunable number lives in `src/config.ts`.** Not inline, not spread across
modules.

This is the rule most often broken by accident. Ammo counts sat as `2`, `3` and
`5` across `world.ts` and `loot.ts`; the lid angle sat as `-1.9` inside the frame
loop. Both were found only when someone went looking to change them.

Two corollaries:

- **Derive user-facing text from the constant.** The musket pickup message
  computes its shot count from `MUSKET_AMMO`. A hardcoded `(6 shots)` becomes a
  lie the first time the value changes.
- **Give the constant a doc comment saying what it trades off**, not what it is.
  `SWING_IMPACT` explains that the downswing needs five frames at 60fps to read —
  that is what a future editor needs, and the number alone does not carry it.

## Comments

Comments explain **why**, and specifically why the obvious thing is wrong. The
codebase is dense with them by design; match that density.

Good:

```ts
// The background comes from the renderer's clear colour, not scene.background.
// When scene.background is a Color, three sets forceClear on every render() and
// wipes the colour buffer regardless of autoClear=false — so the second pass (the
// weapons) erases the whole world and only the sword is left on screen.
```

Useless:

```ts
// Set the clear colour
renderer.setClearColor(0x020304, 1);
```

Rules:

- **Everything is English** — comments, identifiers, log lines, UI strings, docs,
  commit messages.
- **A workaround must name what it works around.** If you discovered it by
  debugging, write down the measurement: "12 of 156 tracks matched" is worth more
  than "assimp does not work".
- **Delete comments that stop being true.** A stale comment is worse than none.

## Structure

- **One concern per module**, and imports flow downward through the layers in
  [architecture](architecture.md). No cycles.
- **Extract when a loop body grows a second job**, as `spawnOne()` was split out
  of `spawnMonsters()`.
- **Build shared geometry once at module load.** The coin heap and the fallback
  textures are built once and reused; ten copies of the same pile is ten times
  the cost for the same picture.
- **Do not reach into another module's object graph.** `openChest()` sets state
  flags; it does not go hunting through the chest's children. The one place that
  needs a specific node — the lid — gets it by a name declared in config.

## Failure handling

- **Fail loudly at the boundary, gracefully in the game.** `dom.ts` throws on a
  missing element, because that is a build mistake. Asset loaders fall back,
  because a missing file is a normal state.
- **Diagnostics name the fix.** See the fallback contract in [assets](assets.md).
- **Never swallow an error without a log line.** An empty `catch` is only
  acceptable where the next branch is the recovery, as in the extension loop of
  `tryLoadModel()` — and it carries a comment saying so.

## Commits

- English, imperative subject, no trailing period.
- The body says **why**, and carries the evidence when there is any: "a
  simulation of the old selection put at least one overlap in 58% of runs".
- Regenerated assets go in the same commit as the config change that produced
  them.
- `npm run build` passes.

## Review checklist

Before calling anything done:

- [ ] `npm run build` passes
- [ ] no `any`; every `!` or cast has a reason written next to it
- [ ] new tunable numbers are in `config.ts` with a doc comment
- [ ] no hardcoded string duplicates a constant's value
- [ ] comments say why, and no stale comment survives the change
- [ ] English throughout
- [ ] a new external asset has a fallback path and a `[assets]` log line
- [ ] both paths exercised — with the asset and without it
- [ ] anything visual was **looked at in the browser**, not just typechecked
      (see [testing](testing.md))
- [ ] the asset budget is still around 6MB
