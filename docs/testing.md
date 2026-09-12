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
npm run dev      # http://localhost:5847, also bound to 0.0.0.0
```

Reload and read the `[assets]` line first. It reports, per asset, whether the
real model loaded or the fallback took over, and — for models — the scale it was
normalised to and where its tip landed. Most "why does it look wrong" questions
are answered there before you open a screenshot.

The page opens on the **title screen** over a paused dungeon; Continue (Play on
a first visit) steps into it. Testing the first visit means clearing
`dungeon.progress.v1` from localStorage — copy it aside first and put it back
after, or the person whose browser it is loses their run.

## A clean build can still fail to load

TypeScript does not see the order modules are evaluated in. A new import can
make a cycle run in a different order and read an uninitialised binding at the
top level — `ReferenceError: Cannot access '…' before initialization`, and
nothing after it runs. After any change to imports, reload and read the console
for **errors**, not just the `[assets]` line. The rule that prevents it is in
[architecture](architecture.md#module-layers).

## Reproducing a dungeon

Every dungeon is a pure function of `(progress.seed, progress.stage)`. Pin the
seed on the URL to get the same one back:

```
http://localhost:5847/?seed=12345
```

The layout, spawns, chest contents, traps, props and sconces all come from that
seed; textures, audio, dust and torch flicker deliberately do not, so a dungeon
looks slightly different run to run while being the same dungeon to walk. The
console prints `[world] seed <run> stage <n> -> <world>` on every build.

This is what makes a bug report reproducible — quote the seed and the stage —
and it is the first piece of multiplayer: a host can send a number instead of a
map. Note that the stage is *not* pinned by the parameter, so `?seed=12345` on
stage 3 is not the stage 1 dungeon.

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

**Do not reset the field you are testing.** A probe that sets state up "cleanly"
before measuring can clear the very corruption it was meant to find. The walk
retiming was verified this way — the check set `m.groundSpeed = 0` first, read
back a perfect `timeScale === groundSpeed / clipSpeed`, and shipped a game where
every creature slid along frozen, because the real value was NaN from the first
frame. Read the untouched state first, then set up.

**`monster.type` is shared, not per creature.** It is the entry in `TYPES`, so
`m.type.aggro = 0` to quiet one zombie silently rewrites the config for every
zombie, for the rest of the page's life. A measurement taken after that reads the
value you poked in, not the one that ships — a density survey came back as a
clean column of zeros this way. Reload before measuring anything you have poked.

A plain `import('/src/scene.ts')` from the console does *not* work for this:
Vite's HMR query string can hand you a second module instance whose objects are
not the ones being rendered. Importing the **exact URL the page loaded** does,
and needs no hook — take it from the resource timing list:

```js
const u = (n) => performance.getEntriesByType('resource').map((e) => e.name).find((x) => x.includes(n));
const { state } = await import(u('/src/state.ts'));
```

After an edit, HMR reloads the page and the tab has to be found again.

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
- **Timers are throttled too.** A probe built on twenty 50ms `setTimeout` waits
  timed out at 45 seconds in a hidden tab. Wait once, not in a loop.
- **Step the loop yourself.** `animate()` is exported from `loop.ts` and runs one
  frame on the clock's `dt`. Patch `performance.now` to add 50ms per call and a
  second of game passes synchronously — the ward's 0.8s cast was checked that
  way. Restore it afterwards and reload when done: every call schedules another
  `requestAnimationFrame` chain, and all of them run once the tab is shown.

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

## Landmark and settings checks

- Survey seeded maps at stages 1, 6 and 12: three distinct landmark footprints,
  all room tiles open, all floor reachable from the start, and identical grid
  and next RNG value with and without the metadata output.
- Rebuild normal-mode worlds and check creature/chest/trap cells for overlaps.
  Confirm one key, a potion in the store, and a guard in the watch room. Hard
  still has one key chest and no extra supplies.
- Change settings from the title and pause menu. Reload to check persistence;
  restore defaults afterwards. Verify that co-op keeps running with input
  suppressed while settings are open.
- Check the settings panel at portrait and landscape phone sizes, including
  scrolling to Back, and inspect each lit room with actual creatures visible.
- Check an ordinary hit, blocked hit, kill and directional damage cue, with
  loaded models and with creature/weapon requests blocked for fallback testing.
- Check audio routing separately from audibility: a headless browser may leave
  its audio clock stopped. Pan and wall-filter targets can still be inspected,
  but audible timing and device performance require an actual player session.

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
