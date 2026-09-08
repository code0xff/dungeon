# Co-op

A hosted, session-only co-op mode: one player runs a WebSocket server on their
machine, the others join, and everyone walks the same dungeon. The menu calls
it **Multiplayer**; this document says co-op because the design fact it records
is that the mode is cooperative and not PvP, and that is the word for it.

This is the design and the decisions behind it, kept current with the code so
the code can be reviewed against something. The player-facing how-to is in
[README.md](../README.md#2-multiplayer).

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

- **The host picks the mode as well as the level.** Hard mode travels with
  the start message: one chest with the key, no pack items in the kit, the
  same as solo hard. It is the run's mode, not anyone's save.
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
- **Death is final for that run. Watching is offered, never forced.** The end
  screen has a Watch button when somebody is still down there: the overlay goes
  away, the dungeon stays on screen, and none of it can be touched. There is no
  free camera — you watch from where you fell, because a camera that could fly
  through the maze would be a map. The alternative is dropping back to the
  lobby and being in the next run, or hosting one.

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

The one that has actually been used, and works without an account:

```bash
cloudflared tunnel --url http://localhost:5848
```

Measured through it: the page served over HTTPS, a `wss://` join and a run
start, 113ms round trip via Cloudflare's edge. The first real-network play was
over this and found a bug five loopback reviews had not.

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

## Hosting needs Node 22.6

`npm run host` runs the server straight from TypeScript with
`--experimental-strip-types`, which older Node does not have — on Node 20 the
command exits before it binds the port. package.json says so in `engines`. Only
the host needs it; joining is a browser.

## What is not done

Everything the mode describes above is built. These are the holes that are known
and left open, not oversights:

- **The authority is trusted about the creatures.** Only the derived authority
  may send creature snapshots, kills or creature blows — the host checks, since
  it can derive the same lowest-id rule — but *what* it sends is not checked
  against anything. Poses are validated against the maze; creature positions are
  not.
- **World events are taken on trust.** A client in the run can say it opened
  chest 3 or sprang trap 7 without having been near either, and the party
  applies it. The host holds the maze but not the chests — it cannot rebuild
  them without three.js — so it can check *which* kinds of event exist and not
  whether one happened. Same root as the gold, below.
- **A late watcher sees the dungeon as it started.** Watching subscribes to
  what happens next; nothing replays what already did. A player who waits on
  the end screen before pressing Watch sees chests that are already open as
  closed. Creatures are fine — they arrive whole in every snapshot.
- **Extracted gold is taken on trust.** The host does not own the loot, so it
  cannot tell 400 G that was carried out from 400 G that was typed in. Closing
  that means the host owning chests and their contents, which is a different
  design from the one where the seed does.
- **Handover jolts.** When the simulating client leaves, the next one takes over
  from its own interpolated copies and the party sees the creatures jump once.
  The alternative was ending everyone's run because one person closed a tab.
- **A chest can pay twice inside one round trip.** The claim is a lease: take a
  chest, get pulled off it by a zombie without opening it, and the lease expires
  on the host while somebody else takes it for real. Their grant reaches you and
  your client drops the chest — but if your own bar happened to complete while
  that message was still in flight, you both opened it. Closing the last of that
  needs the two clients to agree before either pays, and a lease that can expire
  is the price of a chest never becoming unopenable.
- **Nothing is persisted.** A host restart is a new lobby with nothing carried,
  which is correct for the mode but means a crash mid-run ends it.
- **No text or voice between players.** The lobby list and the names over the
  bodies are the whole of the communication the game provides.
- **Not played over a real network.** All of it has been exercised on one
  machine — loopback, no latency, no packet loss. The parry window is 0.35s and
  the interpolation constants were chosen for a link nobody has measured.

## The score

Gold is one team total per run, and only what walks out counts. It is counted by
the host, because only the host sees everyone finish: a client reports its gold
when its run ends and says whether it extracted or died, and the running total
comes back to everyone still in that dungeon.

A death is announced too, with nothing added. "Nobody is bringing that 400 G
back" is what the rest of the party wants to know at the moment it happens, and
it is the only thing that makes going in deeper a decision anyone else feels.

The total is written into the end screen while it is open, so a player reading
their own result sees it move when an ally gets out.

## The dungeon

Chests, the key, the map and the floor traps are kept in step by events, not by
state: everyone generated the same dungeon from the same seed, so both sides
already know what chest 3 holds and where trap 7 is. An event is two numbers and
the receiver looks the rest up locally.

Who gets what follows from the mode. Gold and pack items go to the player who
opened the chest — they took the risk of standing still. The key and the map do
not: there is one portal, so one key opens it for everyone, and a map only one
player could read would have two people in the same corridor disagreeing about
whether they know where they are.

Noises carry their own position. A creaking lid or a sprung trap wakes the
creatures standing near *it*, not near whoever is listening.

A chest is claimed when someone starts opening it, and the host decides who
gets it — first asker wins. Not the creature authority: every message reaches
the host in an order, and "who asked first" is a question only something with
an order can answer. The claim is a lease, not a fact, because a client that
dies mid-loot never says so and a chest nobody can ever open again is worse
than a rare double payout.

## Where the host does not trust the client

Poses are checked against the maze. The host rebuilds it from the same seed and
level the players did — `dungeon.ts` and `rng.ts` are pure, no three.js and no
DOM — and drops any pose that lands in a wall cell. Dropped, not corrected:
the nearest open cell may be on the other side of the wall, and teleporting
someone there for one bad packet is a worse bug than their body pausing until
the next pose arrives.

Authority and validation are different things. The host simulates nothing; it
only refuses the impossible.

## The creatures

One client in each dungeon simulates them and everyone else draws what they are
told. Two clients running the same AI from the same seed drift apart within
seconds — they see different players in different places — and then you and your
ally are swinging at a zombie that is metres apart on your two screens.

**The authority is the lowest player id still in your run, derived and never
announced.** There is no election message to lose, and when somebody leaves,
every remaining client recomputes the same answer from the same roster in the
same instant. Solo is a party of one and is always the authority, which is what
keeps this one code path instead of two.

The handover is not seamless and cannot be. The client taking over has been
drawing creatures from snapshots, so its copies are wherever the last packet
left them: the party sees the creatures jump, once. That is the price of not
ending everyone's run because one person closed a tab.

**Creatures chase the nearest player, not the one simulating them.** Without
that the whole dungeon converges on the authority while everyone else walks an
empty maze.

**Followers animate from the wire, not from simulation state.** animLoaded()
reads local state — it treats `attackT > 0` as "startAttack already began the
clip, leave it alone" — and a follower never calls startAttack. Choosing the
clip from the reported animation is what stops a creature standing idle while
its blows land.

**A snapshot is partial, so silence is how a creature goes away.** The host
drops anything past MOB_INTEREST from the recipient, and walking away from a
creature produces no message at all. A followed creature that has not been
reported for MOB_STALE is dropped and hidden — without that it would stand at
its last reported spot forever, drawn and counted as something nearby.

**Hits are drawn immediately and applied remotely.** A swing flashes the
creature, plays the sound and wears the blade on the spot, because waiting a
round trip to show a hit makes every swing feel broken. The hp is not touched:
the report goes to the authority, and the corrected hp comes back in the next
snapshot. A kill is announced by the authority with the roll already made — four
clients rolling REWARD_SPREAD for one corpse would show four different numbers —
and the gold is paid to whoever swung, not to whoever is simulating.

**A creature's blow is sent, not applied.** The authority says which creature
hit which player for how much; whether it was blocked or parried is decided on
the machine holding that shield. This is where the reason for co-op over PvP
actually gets spent.

**The host trims the snapshot per recipient.** It already holds everyone's pose,
so it drops creatures further than MOB_INTEREST from each player — at level 15
there are over a hundred and most are nowhere near anybody.

## The bodies

Other players are drawn as a Mixamo knight — sword and shield, the same kit the
player carries — through the same loader the creatures use, and the same
fallback rule: without the file you get a coloured capsule and co-op still
works.

Each carries their name on a sprite above their head, drawn into a canvas so it
lives in the world rather than on top of it: it shrinks with distance and a wall
hides it. That last part is deliberate — a name floating through stone would
tell you where an ally is at the moment the game has decided you cannot see
them.

Each is tinted by an emissive at REMOTE_TINT, which both says which ally it is
and lifts them off a dark wall. The value was found by looking: hard enough and
the knight is a flat coloured silhouette with no armour left, none at all and
dark plate in a dungeon lit the colour of rust is just another shadow.

Bodies are drawn and nothing else — no collision, no damage, no AI. A remote
body is a picture of a decision made on another machine.
