# Verifying changes

There is no test suite. Everything in this project is either a type error, a
number, or a picture — and the last two need eyes and evidence.

## The three levels

| Level | Tool | Catches |
|---|---|---|
| Types | `npm run build` | signatures, unused code, bad imports |
| Behaviour | browser console, `[assets]` log | wrong branch taken, missing files |
| Appearance | a screenshot | size, orientation, material, timing |

A change that typechecks tells you almost nothing about a render or an
animation. **Look at it.**

## Starting a session

```bash
npm run dev      # http://localhost:5173, also bound to 0.0.0.0
```

Reload and read the `[assets]` line first. It reports, per asset, whether the
real model loaded or the fallback took over, and — for models — the scale it was
normalised to and where its tip landed. Most "why does it look wrong" questions
are answered there before you open a screenshot.

## Exercising both paths

Any change to a loader must be tried with the asset **and without it**:

```bash
mv assets/props /tmp/hidden      # reload: expect "chest: file missing → primitive model"
mv /tmp/hidden assets/props      # reload: expect "chest: loaded (scale x1.00)"
```

The fallback path has no other coverage. It breaks quietly and only for people
who cloned without the assets.

## Reaching game state you cannot easily play to

To inspect a chest or a creature without hunting for one, add a temporary hook in
`main.ts` after `animate()`:

```ts
Object.assign(window, { __dbg: { state: __state, scene: __scene } });
```

Then drive it from the console — teleport to `state.chests[0]`, force a weapon,
set a pose. **Remove the hook before committing.**

A dynamic `import('/src/scene.ts')` from the console does *not* work for this:
Vite's HMR query string can hand you a second module instance whose objects are
not the ones being rendered.

## Background tabs freeze the game

`requestAnimationFrame` does not fire in a backgrounded tab, so `state` stops
advancing and any timing measurement reads as zero. This has repeatedly looked
like a broken feature when the feature was fine.

Two ways through it:

- **Interleave screenshots.** Each one wakes the renderer for a moment. A short
  animation completes across a handful of them.
- **Watch the value, not the clock.** `dt` is clamped to 0.05s, so progress per
  frame is bounded and deterministic; sample the state field rather than
  measuring wall-clock milliseconds.

## Probabilistic bugs

For anything driven by random placement or chance, measure the rate. Lift the
selection logic into a standalone script and run it thousands of times, before
and after.

The spawn-overlap fix was verified this way: 58.5% of runs had at least one
overlap before, 0% after. A single reload would have shown nothing either way,
and "looks fine now" would have been wrong more often than right.

Then confirm in the real game — 30 rebuilds through the restart button, checking
for duplicate grid cells — because the simulation only proves the model you
extracted, not the code that shipped.

## Deployment

Pushing to `dev` runs `.github/workflows/deploy.yml`, which typechecks, bundles
and publishes. Verify the live URL after anything that touches paths or the
build, since a sub-path deployment can break in ways local dev never shows:

```bash
gh run watch <id> --exit-status
curl -s -o /dev/null -w '%{http_code}\n' https://code0xff.github.io/dungeon/
```

To test sub-path behaviour before pushing, serve a build under a nested folder
and load it — that is how the relative-`base` assumption was checked.
