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
  COOP_PORT, MAX_PLAYERS, NAME_MAX, PROTOCOL_VERSION,
  parseMsg,
  type ClientMsg, type LobbyPlayer, type ServerMsg,
} from '../src/net/protocol.ts';

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
  // normalize() collapses '..' before it is joined, so a request for
  // /../../.ssh/id_rsa cannot escape dist/. This host listens on 0.0.0.0 on
  // someone's home network — everyone on that network can reach it.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
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
}

const players = new Map<number, Player>();
let nextId = 1;
let level = 1;
let running = false;

/**
 * The host is whoever is left holding the flag, not whoever started the process.
 *
 * If it were fixed to the first connection, the host closing their tab would
 * leave a lobby nobody can start. Promoting the oldest remaining player means
 * the process stays useful until the last person leaves.
 */
function ensureHost(): void {
  if ([...players.values()].some((p) => p.host)) return;
  const next = [...players.values()][0];
  if (next) next.host = true;
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
  broadcast({ t: 'lobby', players: roster(), level, running });
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
      me = { id, name: cleanName(msg.name, id), sock, host: players.size === 0, inRun: false };
      players.set(id, me);
      send(sock, { t: 'welcome', id, host: me.host });
      broadcastLobby();
      console.log(`[coop] ${me.name} joined (${players.size}/${MAX_PLAYERS})`);
      return;
    }

    // Everything below is for players who have joined, and all of it is for the
    // host alone. Checking here rather than inside each branch means a new
    // host-only message cannot be added without an authority check.
    if (!me || !me.host) return;

    switch (msg.t) {
      case 'level':
        // Clamped, not trusted: the level indexes the spawn and size curves, and
        // a negative or absurd one would generate a dungeon the client cannot
        // build.
        if (!Number.isFinite(msg.level)) return;
        level = Math.min(20, Math.max(1, Math.round(msg.level)));
        broadcastLobby();
        break;
      case 'start': {
        if (running) return;
        const roll = (Math.random() * 0xffffffff) >>> 0;
        running = true;
        for (const p of players.values()) p.inRun = true;
        broadcast({ t: 'start', seed: roll, level, players: roster() });
        console.log(`[coop] run started: seed ${roll}, level ${level}, ${players.size} players`);
        break;
      }
      default:
        break;
    }
  });

  sock.on('close', () => {
    if (!me) return;
    players.delete(me.id);
    console.log(`[coop] ${me.name} left (${players.size}/${MAX_PLAYERS})`);
    ensureHost();
    // The last player out ends the run, or a lobby nobody is in would stay
    // "running" forever and refuse to start the next one.
    if (players.size === 0) running = false;
    broadcastLobby();
  });

  // ws emits this instead of throwing. Without a handler a reset connection —
  // a phone going to sleep, in practice — takes the whole process down, and
  // everyone else's run is inside it.
  sock.on('error', (err) => {
    console.warn('[coop] socket error', err.message);
  });
});

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
