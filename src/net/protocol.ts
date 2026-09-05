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
}

export type ClientMsg = CJoin | CLevel | CStart | CLeftRun;

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

export type ServerMsg = SWelcome | SReject | SLobby | SStart;

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
