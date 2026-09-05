# Co-op

A hosted, session-only co-op mode: one player runs a WebSocket server on their
machine, the others join, and everyone walks the same dungeon.

Nothing here is built yet. This document is the decisions, so the code can be
reviewed against something.

## Why co-op and not PvP

The mode started as a PvP idea and was changed deliberately.

`PARRY_WINDOW` is 0.35s. Under host authority the joining player sees the
attack ~70ms late over the internet, so their parry is late by the same amount.
In PvP that is zero-sum — someone loses a fight to their connection and both
players know it, which is the end of the mode.

In co-op the same latency exists and stops mattering, because **the defender
decides**: if you blocked or parried on your own screen, you blocked. The host
takes your word for it. That is unthinkable in PvP (the opponent becomes
invulnerable), and in co-op the worst case is that somebody cheats themselves
out of the difficulty. There is no victim.

So the authority split is:

| Decided by | What |
|---|---|
| The client, for its own player | movement, guard, parry, drinking, dodging — anything about its own body |
| The host | creature AI and HP, chest contents, trap springs, gold, who died |

The host still validates movement against the maze, or a modified client walks
through walls. Validation is not the same as authority: the host clamps, it
does not simulate.

## The mode

- **No stages, no bank, no carried save.** A player brings nothing in and takes
  nothing out. `progress.ts` is untouched by co-op — solo progression and co-op
  never read each other.
- **The host picks a level** in the lobby. It feeds `dungeonSize()` and the
  spawn curve exactly where `progress.stage` does in solo, so level 8 co-op is a
  stage 8 dungeon.
- **Starting gear scales with the level.** Solo reaches stage 8 through eight
  visits to the shop; co-op has no shop, so a level 8 dungeon on a level 1 kit
  is not a difficulty setting, it is a wall. Potions, lanterns, whetstones and
  ammo are granted in proportion to the level.
- **Up to 4 players.** No joining after the run starts — the lobby closes.
- **Gold is one team total, and only what extracted players carry counts.** A
  player who dies contributes nothing, which is where the reason to keep each
  other alive comes from, given there is no revive.
- **Death is final for that run, and the dead spectate.** The known cost is that
  a bear trap in the first minute can mean twenty minutes of watching; it is
  accepted, and it is the reason the run wants to stay short.
- **No friendly fire.** The sword cleaves through allies without touching them
  and musket balls pass through. Corridors here are one cell wide — with
  friendly fire everyone backs off and fights alone, which is the opposite of
  the point.
- **Shared: the key, the map, the lantern.** One key opens the one portal for
  everyone. A found map reveals the minimap for everyone. A lit lantern lights
  the dungeon for everyone — light is what the dungeon is *about*, and making it
  per-player would mean two people standing in the same corridor disagreeing
  about whether they can see.
- **Extraction is individual.** Walking into the portal takes you out and leaves
  the others in. Nobody is forced to leave, and nobody is forced to stay.

## What already exists for this

Seeded worldgen (`src/rng.ts`). A dungeon is a pure function of
`(seed, level)`, so the host sends two numbers instead of a map. See
`docs/testing.md` for the `?seed=` parameter.

## What is missing

- **The server.** Node, `ws`, in-memory, no database. It is a dependency the
  client bundle never sees; the alternative was hand-writing RFC 6455 framing,
  which is not a good use of anyone's time. It serves the built game too — see
  below.
- **The transport problem.** The GitHub Pages build is HTTPS, and a browser will
  not open `ws://` to a home machine from an HTTPS page. So the host serves the
  game *and* the socket from the same process over plain HTTP on the LAN, and
  players load the page from the host. Over the internet this needs a tunnel;
  that is a friends-only story and it is fine.
- **A player avatar.** Other players are drawn as the existing lunatic mesh,
  tinted, until the netcode is proven worth an asset. The creature pipeline
  already has the right shape (rigged GLB per clip) and the budget has ~7.5MB
  spare, so adding a proper one later is not a rewrite.
