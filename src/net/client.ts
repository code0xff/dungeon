import { PROTOCOL_VERSION, parseMsg } from './protocol';
import type { ClientMsg, LobbyPlayer, ServerMsg } from './protocol';

/**
 * The client half of the co-op socket: connect, join, and hand messages up.
 *
 * It owns the connection and nothing else. What a lobby looks like is in
 * lobby.ts, and what a run does with a seed is in world.ts — this file must not
 * grow either, or the next transport change touches the game.
 */

/** Everything the UI needs to know about where we are. */
export type NetPhase = 'offline' | 'connecting' | 'lobby' | 'run';

export interface NetState {
  phase: NetPhase;
  /** Our own id once the host has welcomed us. 0 while offline. */
  id: number;
  host: boolean;
  players: LobbyPlayer[];
  level: number;
  /** True while at least one player is inside a dungeon, us or not. */
  running: boolean;
  /** Which dungeon we are in, 0 when we are not in one. */
  runId: number;
  /** Why the last attempt ended, for the panel to show. Empty when fine. */
  error: string;
}

export const net: NetState = {
  phase: 'offline', id: 0, host: false, players: [], level: 1, running: false, runId: 0, error: '',
};

let sock: WebSocket | null = null;

/** Called whenever anything above changes, so the panel can redraw. */
let onChange: (() => void) | null = null;
/** Called on the host's go, with the seed and level to build from. */
let onStart: ((seed: number, level: number, players: LobbyPlayer[]) => void) | null = null;

export function onNetChange(fn: () => void): void {
  onChange = fn;
}

export function onNetStart(fn: (seed: number, level: number, players: LobbyPlayer[]) => void): void {
  onStart = fn;
}

function changed(): void {
  onChange?.();
}

/**
 * Turns whatever the player typed into a socket URL.
 *
 * Empty means "wherever this page came from", which is the LAN case: the host
 * reads out one http:// address, everyone opens it, and there is nothing to
 * type. Anything else is for the deployed build reaching a tunnel.
 *
 * The scheme follows the page rather than being assumed. A browser refuses
 * ws:// from an https:// page, and it does it with a console error the player
 * will never see — so guessing here would produce a connection that silently
 * never opens.
 */
export function resolveServer(input: string): string {
  const secure = location.protocol === 'https:';
  const raw = input.trim();
  if (!raw) return `${secure ? 'wss' : 'ws'}://${location.host}`;
  // A pasted tunnel address is usually an https:// one, because that is what
  // the tunnel prints. Accepting it and swapping the scheme is friendlier than
  // telling someone their URL is the wrong sort of URL.
  const swapped = raw.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  if (/^wss?:\/\//i.test(swapped)) return swapped;
  return `${secure ? 'wss' : 'ws'}://${swapped}`;
}

function send(msg: ClientMsg): void {
  if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
}

/** Leaves the lobby. Safe to call when not connected. */
export function disconnect(): void {
  const s = sock;
  sock = null;
  // Nulled first so the close handler below sees a socket that is no longer
  // ours and does not report a deliberate exit as a lost connection.
  s?.close();
  net.phase = 'offline';
  net.id = 0;
  net.host = false;
  net.players = [];
  net.running = false;
  net.runId = 0;
  changed();
}

export function connect(server: string, name: string): void {
  disconnect();
  net.error = '';
  net.phase = 'connecting';
  changed();

  let url: string;
  try {
    url = resolveServer(server);
    // Constructing it here rather than letting the WebSocket throw gives a
    // message naming the address instead of a DOMException.
    new URL(url);
  } catch {
    net.phase = 'offline';
    net.error = `Not an address: ${server}`;
    changed();
    return;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    // Thrown synchronously for a mixed-content block, which is the single most
    // likely failure: the Pages build pointed at a plain ws:// host.
    net.phase = 'offline';
    net.error = location.protocol === 'https:'
      ? 'This page is HTTPS, so the server needs an https address (a tunnel)'
      : `Could not open ${url}`;
    changed();
    return;
  }
  sock = ws;

  ws.addEventListener('open', () => {
    send({ t: 'join', v: PROTOCOL_VERSION, name });
  });

  ws.addEventListener('message', (e: MessageEvent<string>) => {
    const msg = parseMsg<ServerMsg>(typeof e.data === 'string' ? e.data : '');
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        net.id = msg.id;
        net.host = msg.host;
        net.phase = 'lobby';
        changed();
        break;
      case 'reject':
        net.error = msg.reason;
        // The host closes the socket right after this, so leaving phase alone
        // would show "connecting" under the reason until that arrived.
        net.phase = 'offline';
        changed();
        break;
      case 'lobby': {
        net.players = msg.players;
        net.level = msg.level;
        net.running = msg.running;
        // The roster is the authority on whether we are still underground. The
        // host clears it when we report a death, and reading it back here is
        // what puts a dead player into the lobby rather than leaving the panel
        // insisting they are in a dungeon they have already left.
        const meRow = msg.players.find((p) => p.id === net.id);
        net.host = meRow?.host ?? false;
        if (meRow && !meRow.inRun) {
          net.runId = 0;
          if (net.phase === 'run') net.phase = 'lobby';
        }
        changed();
        break;
      }
      case 'start':
        net.phase = 'run';
        net.level = msg.level;
        net.players = msg.players;
        net.runId = msg.runId;
        changed();
        onStart?.(msg.seed, msg.level, msg.players);
        break;
    }
  });

  ws.addEventListener('close', () => {
    if (sock !== ws) return;
    sock = null;
    // A reject already explains itself; anything else is the host going away.
    if (!net.error) net.error = 'Disconnected from the host';
    net.phase = 'offline';
    net.id = 0;
    net.host = false;
    net.players = [];
    changed();
  });

  // 'error' carries nothing useful in browsers by design — the detail is
  // withheld to stop pages port-scanning. 'close' always follows, so the
  // message is left to that handler rather than written twice.
  ws.addEventListener('error', () => {});
}

/** Host only; ignored by the server otherwise. */
export function setLevel(level: number): void {
  send({ t: 'level', level });
}

/** Host only; ignored by the server otherwise. */
export function startRun(): void {
  send({ t: 'start' });
}

/**
 * Reports that this player's dungeon is over — died or extracted.
 *
 * Without it a browser sitting on a death screen is indistinguishable from one
 * still fighting, and the lobby would never offer another run.
 */
export function leftRun(): void {
  if (net.runId === 0) return;
  net.runId = 0;
  send({ t: 'leftRun' });
}
