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
- **Up to 4 players.** No joining a dungeon after it starts. The *lobby* does
  not close, though — see death, below.
- **Gold is one team total, and only what extracted players carry counts.** A
  player who dies contributes nothing, which is where the reason to keep each
  other alive comes from, given there is no revive.
- **Death is final for that run. Spectating is offered, never forced.** A dead
  player can watch an ally, or drop back to the lobby and be in the next run —
  or host their own.

  This is what keeps the dungeon full size. Forced spectating would have meant a
  bear trap in the first minute costing twenty minutes of watching, and the only
  answer to that would have been making runs short — paying for a death rule
  with the size of the game. Giving the dead somewhere to go is cheaper than
  shrinking the dungeon.

  It is why the lobby is a room that outlives a run rather than a screen on the
  way into one: the host's dungeon can still be going while the dead regroup.
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

## Where players connect

**Only the host runs a server.** Nobody else installs or starts anything. What
changes between setups is which address a player opens, and the reason is one
browser rule: an `https://` page may not open a plain `ws://` socket. The
GitHub Pages build is HTTPS and a home machine has no certificate, so the two
cannot be combined.

| Setup | What a player opens | What the host runs |
|---|---|---|
| Same network | `http://<host-lan-ip>:5848`, read out by the host | `npm run host` |
| Over the internet | the GitHub Pages build, plus the server address | `npm run host` and a tunnel |

A tunnel (ngrok, Cloudflare Tunnel, Tailscale Funnel) hands out an `https://`
address, and `wss://` to that address is allowed from an HTTPS page. So the
deployed build *is* usable for co-op — it just cannot reach an uncertificated
machine directly, and no amount of client code changes that.

Two consequences for the client:

- **The server address is never compiled in.** It defaults to wherever the page
  was served from, which makes the LAN case a single URL with nothing to type,
  and it can be overridden — a `?server=` parameter and a field in the lobby —
  which is what makes the Pages build work against a tunnel.
- **The scheme follows the page.** An HTTPS page uses `wss://`, an HTTP page
  uses `ws://`. Guessing wrong fails with a console error a player will never
  find.

Because the Pages build and the host can now be different versions of the game,
`PROTOCOL_VERSION` is doing real work rather than guarding a theoretical case.

## What is missing

- **The server.** Node, `ws`, in-memory, no database. It is a dependency the
  client bundle never sees; the alternative was hand-writing RFC 6455 framing,
  which is not a good use of anyone's time. It serves the built game too — see
  below.
- **Remote players.** Nothing is sent about where anyone is yet, so a co-op run
  is currently the same dungeon walked alone. This is the next piece.
- **Reporting gold to the host**, so the team total means something. Right now a
  co-op run's gold is only shown to the player who earned it.
- **A player avatar.** Other players are drawn as the existing lunatic mesh,
  tinted, until the netcode is proven worth an asset. The creature pipeline
  already has the right shape (rigged GLB per clip) and the budget has ~7.5MB
  spare, so adding a proper one later is not a rewrite.
