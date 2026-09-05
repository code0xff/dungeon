/**
 * The co-op host: one process that serves the built game **and** the lobby
 * socket on the same port.
 *
 * Serving both from one origin is not tidiness, it is the only thing that makes
 * this work without certificates. A browser on an https:// page refuses a ws://
 * connection to a home machine, so the deployed GitHub Pages build can never be
 * the co-op client. Players load the page from the host over plain http on the
 * LAN and the socket goes back to where the page came from.
 *
 * Run it with:
 *
 *     npm run build && npm run host
 *
 * There is no database and no persistence. A restart is a new lobby, which is
 * correct: co-op carries nothing between runs by design (docs/coop.md).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  COOP_PORT, MAX_PLAYERS, NAME_MAX, PROTOCOL_VERSION, TICK_HZ,
  parseMsg,
  type ClientMsg, type LobbyPlayer, type PoseRow, type ServerMsg,
} from '../src/net/protocol.ts';
// The level cap is a game tunable, so it is read from config.ts rather than
// duplicated here — a server that clamped to a different number than the client
// offers would be a bug nobody notices until someone picks the top of the dial.
import { COOP_MAX_LEVEL } from '../src/config.ts';

const ROOT = resolve(import.meta.dirname, '..', 'dist');

// ---- Static file serving ----

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // decodeURIComponent throws URIError on a malformed escape — `GET /%zz` is
  // enough — and this is the request callback, so an uncaught throw here does
  // not return a 500, it terminates the process and every run inside it. One
  // stray link or port scanner on the network would end the session.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  // normalize() collapses '..' before it is joined, so a request for
  // /../../.ssh/id_rsa cannot escape dist/. This host listens on 0.0.0.0 on
  // someone's home network — everyone on that network can reach it.
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let path = join(ROOT, rel);
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');

  if (!path.startsWith(ROOT) || !existsSync(path)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}

// ---- Lobby state ----

interface Player {
  id: number;
  name: string;
  sock: WebSocket;
  host: boolean;
  inRun: boolean;
  /** Which dungeon they are in. 0 when they are in the lobby. */
  runId: number;
  /** Their last pose, or null until they send one. */
  pose: PoseRow | null;
}

const players = new Map<number, Player>();
let nextId = 1;
let level = 1;
let nextRunId = 1;

/**
 * The host is the longest-waiting player **in the lobby**, recomputed on every
 * change rather than granted once.
 *
 * Fixing it to the first connection meant the host closing their tab left a
 * lobby nobody could start. Keeping it on a player who has gone into a dungeon
 * is the same bug wearing a different hat: the people who need to open the next
 * run are the dead sitting in the lobby, and the original host may be alive
 * inside the last one for another twenty minutes.
 *
 * When everybody is inside a dungeon there is no host, which is correct —
 * there is nobody to start anything for.
 */
function recomputeHost(): void {
  let found = false;
  for (const p of players.values()) {
    p.host = !found && !p.inRun;
    if (p.host) found = true;
  }
}

/** True while at least one player is inside a dungeon. */
function anyInRun(): boolean {
  return [...players.values()].some((p) => p.inRun);
}

function roster(): LobbyPlayer[] {
  return [...players.values()].map((p) => ({
    id: p.id, name: p.name, host: p.host, inRun: p.inRun,
  }));
}

function send(sock: WebSocket, msg: ServerMsg): void {
  // OPEN is 1. Sending on a socket that is already closing throws, and one
  // player's tab dying during a broadcast must not abort the broadcast.
  if (sock.readyState === 1) sock.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMsg): void {
  for (const p of players.values()) send(p.sock, msg);
}

function broadcastLobby(): void {
  broadcast({ t: 'lobby', players: roster(), level, running: anyInRun() });
}

/**
 * Names are shown to other players, so they are clamped rather than trusted.
 * Control characters are stripped because a name with a newline in it can
 * rewrite the lobby list around itself.
 */
function cleanName(raw: unknown, id: number): string {
  if (typeof raw !== 'string') return `Player ${id}`;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
  return s.length > 0 ? s : `Player ${id}`;
}

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (sock: WebSocket) => {
  let me: Player | null = null;

  sock.on('message', (raw: Buffer) => {
    const msg = parseMsg<ClientMsg>(raw.toString());
    if (!msg) return;

    if (msg.t === 'join') {
      // One join per socket. A second would hand the same connection two
      // identities and leave one of them un-removable on disconnect.
      if (me) return;
      if (msg.v !== PROTOCOL_VERSION) {
        send(sock, { t: 'reject', reason: 'This page is out of date — reload it' });
        sock.close();
        return;
      }
      // A dungeon cannot be joined once it starts, but the lobby stays open —
      // it is where the dead wait for the next run. So the full check counts
      // everyone in the lobby, and a running dungeon is reported rather than
      // used as a reason to refuse the connection.
      if (players.size >= MAX_PLAYERS) {
        send(sock, { t: 'reject', reason: 'The lobby is full' });
        sock.close();
        return;
      }
      const id = nextId++;
      me = { id, name: cleanName(msg.name, id), sock, host: false, inRun: false, runId: 0, pose: null };
      players.set(id, me);
      recomputeHost();
      send(sock, { t: 'welcome', id, host: me.host });
      broadcastLobby();
      console.log(`[coop] ${me.name} joined (${players.size}/${MAX_PLAYERS})`);
      return;
    }

    if (!me) return;

    // Leaving a run is the one thing a player says about themselves, so it is
    // handled before the host gate below — everything past that point is an
    // instruction about the whole lobby and belongs to the host alone.
    if (msg.t === 'leftRun') {
      if (!me.inRun) return;
      me.inRun = false;
      me.runId = 0;
      // Dropped with the run, so a body does not stay standing in a dungeon its
      // player has already left.
      me.pose = null;
      recomputeHost();
      broadcastLobby();
      return;
    }

    // The hot path: 20 a second per player. Kept above the host gate and
    // deliberately silent — a pose from someone in the lobby is not an error
    // worth logging 20 times a second, it is a message in flight from a run
    // that has just ended.
    if (msg.t === 'p') {
      if (!me.inRun) return;
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z) || !Number.isFinite(msg.r)) return;
      me.pose = { id: me.id, x: msg.x, z: msg.z, r: msg.r, a: (msg.a | 0) & 3 };
      return;
    }

    // Checking authority here rather than inside each branch means a new
    // host-only message cannot be added without one.
    if (!me.host) return;

    switch (msg.t) {
      case 'level':
        // Clamped, not trusted: the level indexes the spawn and size curves, and
        // a negative or absurd one would generate a dungeon the client cannot
        // build.
        if (!Number.isFinite(msg.level)) return;
        level = Math.min(COOP_MAX_LEVEL, Math.max(1, Math.round(msg.level)));
        broadcastLobby();
        break;
      case 'start': {
        // Everyone waiting, and nobody who is already underground: a running
        // dungeon must not be interrupted by the dead opening the next one.
        const group = [...players.values()].filter((p) => !p.inRun);
        if (group.length === 0) return;
        const roll = (Math.random() * 0xffffffff) >>> 0;
        const runId = nextRunId++;
        for (const p of group) {
      p.inRun = true;
      p.runId = runId;
      p.pose = null;
    }
        const start: ServerMsg = {
          t: 'start', seed: roll, level, runId,
          players: group.map((p) => ({ id: p.id, name: p.name, host: p.host, inRun: true })),
        };
        // Sent only to the group. Broadcasting it would drag players out of the
        // dungeon they are still in and into a fresh one.
        for (const p of group) send(p.sock, start);
        recomputeHost();
        broadcastLobby();
        console.log(`[coop] run ${runId}: seed ${roll}, level ${level}, ${group.length} players`);
        break;
      }
      default:
        break;
    }
  });

  sock.on('close', () => {
    if (!me) return;
    players.delete(me.id);
    // Nothing else to clean up: the next snapshot is built from who is in the
    // map, so the body stops being sent the moment the player is gone.
    console.log(`[coop] ${me.name} left (${players.size}/${MAX_PLAYERS})`);
    recomputeHost();
    broadcastLobby();
  });

  // ws emits this instead of throwing. Without a handler a reset connection —
  // a phone going to sleep, in practice — takes the whole process down, and
  // everyone else's run is inside it.
  sock.on('error', (err) => {
    console.warn('[coop] socket error', err.message);
  });
});

/**
 * Snapshots, one per dungeon.
 *
 * A single interval rather than a timer per player: at 4 players it is the same
 * work and it guarantees everyone in a run sees the same tick, so two clients
 * can never be interpolating between different pairs of snapshots.
 *
 * Only players in the *same* run are gathered. Runs overlap by design, and a
 * body from someone else's dungeon appearing in yours would be a ghost walking
 * through your walls.
 */
setInterval(() => {
  const byRun = new Map<number, Player[]>();
  for (const p of players.values()) {
    if (!p.inRun) continue;
    const list = byRun.get(p.runId);
    if (list) list.push(p);
    else byRun.set(p.runId, [p]);
  }
  for (const group of byRun.values()) {
    // Alone in a dungeon there is nothing to say, and this is the common case
    // for a solo host testing — no reason to send 20 empty frames a second.
    if (group.length < 2) continue;
    const poses = group.map((p) => p.pose).filter((x): x is PoseRow => x !== null);
    if (!poses.length) continue;
    for (const p of group) {
      // Everyone else's, not their own: a client that received its own pose
      // back would have to filter it out anyway, and one round trip late.
      const others = poses.filter((row) => row.id !== p.id);
      if (others.length) send(p.sock, { t: 'snap', p: others });
    }
  }
}, 1000 / TICK_HZ);

const http = createServer(serve);
http.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

if (!existsSync(ROOT)) {
  console.error('[coop] dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

http.listen(COOP_PORT, () => {
  console.log(`[coop] hosting on port ${COOP_PORT}`);
  // The LAN address is the whole product here: it is what the host reads out to
  // the people joining, and hunting for it in ifconfig is a bad first minute.
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log(`[coop]   http://${ni.address}:${COOP_PORT}`);
    }
  }
  console.log(`[coop]   http://localhost:${COOP_PORT}`);
});
