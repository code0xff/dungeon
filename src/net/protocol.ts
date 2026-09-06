/**
 * The co-op wire protocol: every message that crosses the socket, defined once.
 *
 * This file is imported by **both** the browser client and the Node host, which
 * is the whole point — a protocol described in two places is a protocol that
 * drifts. The host runs under `node --experimental-strip-types` so it can import
 * this .ts directly; that is why `server/host.ts` imports it with an explicit
 * `.ts` extension while the rest of the codebase imports without one. Node
 * requires the extension, and a build step for one file was the worse trade.
 *
 * Constraints that shaped it:
 *
 * - JSON, not a binary format. At 4 players and 20Hz the bandwidth is
 *   irrelevant, and being able to read a session in the network tab is worth
 *   more than the bytes.
 * - Nothing here carries the dungeon. The client generates it from the seed —
 *   see src/rng.ts. That is what keeps `start` a few dozen bytes instead of a
 *   few hundred kilobytes.
 * - Every message has a `t` discriminant so a switch over it is exhaustive.
 *
 * See docs/coop.md for who is allowed to decide what.
 */

/**
 * Bumped on any change to the shapes below.
 *
 * The host and the page are served from the same process, so in the normal case
 * they cannot disagree. They can if someone leaves a tab open across a restart
 * or joins from a stale bookmark — and a mismatched client that gets to join is
 * a client that desynchronises silently ten minutes later. It is rejected at
 * the handshake instead.
 */
export const PROTOCOL_VERSION = 1;

/** The port the host listens on for both the game page and the socket. */
export const COOP_PORT = 5848;

/** Snapshots per second. */
export const TICK_HZ = 20;

/** How many players one dungeon holds. */
export const MAX_PLAYERS = 4;

/** Longest allowed player name, in characters. */
export const NAME_MAX = 16;

/** A player as everyone else sees them in the lobby. */
export interface LobbyPlayer {
  id: number;
  name: string;
  /**
   * The one player who may set the level and start a run.
   *
   * It is the longest-waiting player *in the lobby*, not the process owner and
   * not whoever connected first — because the player who needs to start the
   * next dungeon is one of the dead sitting in the lobby, and the original host
   * may still be alive inside the last one.
   */
  host: boolean;
  /** True once they are in the dungeon. Players who died or extracted are false. */
  inRun: boolean;
  /**
   * Which dungeon they are in, 0 in the lobby.
   *
   * Sent so every client can work out for itself who simulates the creatures:
   * the lowest id still in your run. Deriving it beats being told — there is no
   * election message to lose, and everyone recomputes the same answer from the
   * same roster the moment somebody leaves.
   */
  runId: number;
}

// ---- Client to host ----

/** First message on the socket. The host answers `welcome` or `reject`. */
export interface CJoin {
  t: 'join';
  v: number;
  name: string;
}

/** Host only. Sets the level the next run is generated at. */
export interface CLevel {
  t: 'level';
  level: number;
}

/** Host only. Takes everyone waiting in the lobby into a new dungeon. */
export interface CStart {
  t: 'start';
}

/**
 * "My run is over" — sent when a player dies or extracts.
 *
 * Without it the host has no way to know a dungeon emptied out: a browser that
 * is still connected looks identical whether the player is fighting or sitting
 * on a death screen, and the lobby would never offer another run.
 */
export interface CLeftRun {
  t: 'leftRun';
  /** Gold carried at the end. Counted only when `out` is true. */
  gold: number;
  /** True if they walked out through the portal, false if they died. */
  out: boolean;
}

/**
 * Where this player is, sent TICK_HZ times a second while in a dungeon.
 *
 * Short field names because this is the only message that repeats: at 4 players
 * and 20Hz it is sent 80 times a second and relayed 320, and `x` instead of
 * `positionX` is most of the difference between a readable JSON protocol and a
 * wasteful one.
 *
 * There is no timestamp. The receiver interpolates between the last two
 * snapshots it actually got, so a clock it cannot trust buys nothing — see
 * remote.ts.
 */
export interface CPose {
  t: 'p';
  /** World position. y is not sent: everyone walks the same flat floor. */
  x: number;
  z: number;
  /** Facing, radians. */
  r: number;
  /** What the body is doing — one of the ANIM_* values. */
  a: number;
}

/**
 * Something happened to the dungeon itself.
 *
 * The dungeon is generated from a shared seed, so both sides already agree on
 * what chest 3 holds and where trap 7 is. That is what lets an event be two
 * numbers instead of a description: nothing here carries contents, positions or
 * damage, only which thing and which kind of thing happened to it.
 *
 * `i` indexes state.chests or state.traps, and those arrays are built in the
 * same order on every client because the seed builds them.
 */
/**
 * One creature, as the authority sees it.
 *
 * `i` indexes state.monsters, which every client built in the same order from
 * the seed. hp is sent because damage is resolved by the authority and the
 * others predict it — see docs/coop.md.
 */
export interface MobRow {
  i: number;
  x: number;
  z: number;
  r: number;
  /** 0 idle, 1 walking, 2 attacking, 3 dead. */
  a: number;
  hp: number;
}

export type WorldEvent =
  /** A lid started opening. The noise, not the contents — see LOOT_TIME. */
  | 'creak'
  /** A chest finished opening. */
  | 'chest'
  /** A floor trap went off. */
  | 'trap';

export interface CEvent {
  t: 'e';
  k: WorldEvent;
  i: number;
}

/**
 * The authority's view of the creatures, TICK_HZ times a second.
 *
 * Sent whole. The server, which already holds everyone's pose, is what trims it
 * per recipient — a creature nobody can see is not worth a packet, and the
 * authority would have to track four players' interest to work that out itself.
 */
export interface CMobs {
  t: 'm';
  m: MobRow[];
}

/**
 * "I hit creature i for d." Sent by a player who is not the authority.
 *
 * The hit is already drawn on their screen: waiting a round trip to flash a
 * creature would make every swing feel broken. This is the correction, not the
 * event — the authority owns whether it actually died.
 */
export interface CHit {
  t: 'h';
  i: number;
  d: number;
}

/**
 * The authority announcing a kill, and a creature's blow.
 *
 * Identical in shape to the SKill and SMobHit the others receive, because the
 * host relays them untouched — the authority is a player like any other, and
 * inventing a second spelling for the same fact would only be something to keep
 * in step.
 */
export type CKill = SKill;
export type CMobHit = SMobHit;
export type CClaim = SClaim;

export type ClientMsg =
  | CJoin | CLevel | CStart | CLeftRun | CPose | CEvent | CMobs | CHit | CKill | CMobHit | CClaim;

/**
 * What a remote body is doing, as one number.
 *
 * A string would cost more than the pose it decorates, and an enum of four
 * states is the whole animation vocabulary the loader has.
 */
export const ANIM_IDLE = 0;
export const ANIM_WALK = 1;
export const ANIM_ATTACK = 2;
export const ANIM_DEAD = 3;

// ---- Host to client ----

/** Accepted. `id` is how this player is named in every later message. */
export interface SWelcome {
  t: 'welcome';
  id: number;
  host: boolean;
}

/**
 * Refused, with a reason to show. Sent before the socket closes rather than
 * just closing: "the lobby is full" and "your tab is out of date" are different
 * problems and a bare disconnect looks identical for both.
 */
export interface SReject {
  t: 'reject';
  reason: string;
}

/** The lobby changed: someone joined, left, died, or extracted. */
export interface SLobby {
  t: 'lobby';
  players: LobbyPlayer[];
  level: number;
  /** True while at least one player is inside a dungeon. */
  running: boolean;
}

/**
 * Go. Everyone builds the same dungeon from these two numbers.
 *
 * `players` is the roster the run started with, in join order, so the client can
 * assign each remote body before anyone has moved.
 */
export interface SStart {
  t: 'start';
  seed: number;
  level: number;
  /** Who went in. Only players who were waiting in the lobby are sent this. */
  players: LobbyPlayer[];
  /**
   * Which dungeon this is. Runs can overlap — the dead start another one while
   * the first is still going — so a message about a player needs to say which
   * dungeon it happened in.
   */
  runId: number;
}

/** One other player, as it appears in a snapshot. */
export interface PoseRow {
  id: number;
  x: number;
  z: number;
  r: number;
  a: number;
}

/**
 * Everyone else in your dungeon, TICK_HZ times a second.
 *
 * Sent per run rather than broadcast: two dungeons can be going at once, and a
 * player in one has no business seeing bodies from the other.
 *
 * A player who has sent no pose yet is simply absent from the list, which is
 * also how a body disappears when someone dies or leaves — there is no separate
 * "remove" message to lose.
 */
export interface SSnap {
  t: 'snap';
  p: PoseRow[];
}

/** A world event that happened to somebody else, with who did it. */
export interface SEvent {
  t: 'e';
  k: WorldEvent;
  i: number;
  by: number;
}

/**
 * The party's running total, sent whenever somebody extracts.
 *
 * Only what walks out counts, so a death sends this with nothing added — but it
 * is still sent, because "nobody is coming back with that 400 G" is news the
 * rest of the party wants at the moment it happens.
 */
export interface SParty {
  t: 'g';
  /** The whole run's banked total so far. */
  total: number;
  /** Who just finished, and with how much. */
  by: number;
  gold: number;
  out: boolean;
}

/**
 * Who owns a chest.
 *
 * A client asks for one when it starts looting; the host answers, and the first
 * asker wins. Settled by the host rather than by the creature authority because
 * this is exactly what a host is for — every message goes through it in an
 * order, and "who asked first" is a question only something with an order can
 * answer.
 *
 * The claim is a lease rather than a fact. A client that dies mid-loot never
 * says so, and a chest nobody can ever open again is worse than a rare double
 * payout.
 */
export interface SClaim {
  t: 'c';
  i: number;
  /** The player who may open it. */
  to: number;
}

/** A hit somebody else landed, for the authority to apply. */
export interface SHit {
  t: 'h';
  i: number;
  d: number;
  by: number;
}

/** Creature state from the authority, trimmed to what this player is near. */
export interface SMobs {
  t: 'm';
  m: MobRow[];
}

/** The authority says a creature died, and who gets paid for it. */
export interface SKill {
  t: 'k';
  i: number;
  by: number;
  gold: number;
}

/**
 * The authority says a creature landed a blow on a player.
 *
 * The damage is what the creature swung for, not what it costs: whether it was
 * blocked or parried is decided on the target's own machine, which is the whole
 * reason this mode is co-op and not PvP.
 */
export interface SMobHit {
  t: 'x';
  /** Which creature, so the defender can check their guard arc against it. */
  i: number;
  /** Who it hit. */
  p: number;
  d: number;
}

export type ServerMsg =
  | SWelcome | SReject | SLobby | SStart | SSnap | SEvent | SMobs | SKill | SMobHit | SHit
  | SParty | SClaim;

/**
 * Parses a message off the wire.
 *
 * Returns null rather than throwing on anything malformed. The host is talking
 * to browsers on someone's LAN, and one bad frame — a truncated send, a port
 * scanner, an old tab — must not take the process down with everyone else's run
 * inside it.
 */
export function parseMsg<T extends { t: string }>(data: string): T | null {
  try {
    const o: unknown = JSON.parse(data);
    if (typeof o !== 'object' || o === null) return null;
    if (typeof (o as { t?: unknown }).t !== 'string') return null;
    return o as T;
  } catch {
    return null;
  }
}
