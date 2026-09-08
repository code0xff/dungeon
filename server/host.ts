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
 *
 * **This file imports game source, and Node resolves imports differently from
 * vite.** protocol.ts, config.ts, dungeon.ts, rng.ts and types.ts are reachable
 * from here, and a *value* import added to any of them without a file
 * extension will start this process and kill it, while `npm run build` passes —
 * vite resolves extensionless specifiers and Node does not. Type-only imports
 * are erased by the stripper and are safe either way. Start the host after
 * touching those files; the build gate cannot see this.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  COOP_PORT, MAX_PLAYERS, NAME_MAX, PROTOCOL_VERSION, TICK_HZ,
  parseMsg,
  type ClientMsg, type LobbyPlayer, type MobRow, type PoseRow, type ServerMsg,
} from '../src/net/protocol.ts';
// The level cap is a game tunable, so it is read from config.ts rather than
// duplicated here — a server that clamped to a different number than the client
// offers would be a bug nobody notices until someone picks the top of the dial.
import {
  CELL, COOP_MAX_LEVEL, HIT_REPORT_MARGIN, LOOT_TIME, LUNGE_DMG, MOB_INTEREST, MUSKET_DMG,
} from '../src/config.ts';
// The host builds the same maze the players do, from the same seed, so it can
// tell a pose that is inside a wall from one that is not. dungeon.ts and rng.ts
// are pure — no three.js, no DOM — which is what makes this possible at all.
import { dungeonSize, generateDungeon } from '../src/dungeon.ts';
import { setSeed } from '../src/rng.ts';
import type { Maze } from '../src/types.ts';

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

  // A separator-aware boundary. `startsWith(ROOT)` alone let a request for
  // `/%2e%2e%2fdist-old/x` through, because a sibling called dist-old also
  // starts with the string "…/dist" — and this listens on somebody's LAN.
  if ((path !== ROOT && !path.startsWith(ROOT + sep)) || !existsSync(path)) {
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
  /**
   * A dungeon they are watching but not in, or 0.
   *
   * Told rather than guessed. "Out of a run" describes a watcher and a player
   * who went back to the lobby equally well, and they want opposite things.
   */
  watchRun: number;
}

const players = new Map<number, Player>();
let nextId = 1;
let level = 1;
let hard = false;
let nextRunId = 1;

/**
 * Per dungeon: the maze to check poses against, the party's banked gold, and
 * who has claimed which chest.
 *
 * Kept by runId because runs overlap. Entries are never deleted — a run holds a
 * maze and a few numbers, and a host that has been up long enough for that to
 * matter has been up for weeks.
 */
interface Run {
  maze: Maze;
  gold: number;
  /** chest index -> { player, when } — a lease, see SClaim. */
  claims: Map<number, { to: number; at: number }>;
  /**
   * Everyone who went in, whether or not they are still down there.
   *
   * The party total is sent to this rather than to the current occupants: a
   * player who extracted first has their end screen open and is watching the
   * number, and they are exactly the person who stops being in the run.
   */
  members: Set<number>;
}

const runs = new Map<number, Run>();

/**
 * The most damage one reported hit may carry: the biggest hit the game can
 * actually deal, plus rounding room.
 *
 * Derived from the same constants the client swings with — a lunge is
 * LUNGE_DMG times a fresh blade's 1.0, the musket is MUSKET_DMG — so this is
 * not a guess that drifts when they are tuned. A report above it is not a hit,
 * it is a forgery, and it is dropped rather than clamped: a modified client that
 * sends 200 to kill a brute outright should get nothing, not a free maximum.
 */
const MAX_REPORTED_HIT = Math.max(LUNGE_DMG, MUSKET_DMG) * HIT_REPORT_MARGIN;

/** Every valid world-event kind, for checking one off the wire. */
const WORLD_EVENTS: readonly string[] = ['creak', 'chest', 'trap', 'lantern', 'shot'];

/**
 * Rebuilds a dungeon's maze exactly as the clients do.
 *
 * The order matters and is not arbitrary: buildWorld() seeds, then asks for the
 * size, then carves. Doing any two of those in the other order draws different
 * numbers from the stream and produces a different maze — which would then
 * reject every player for standing in a wall that is not there.
 */
function buildMaze(seed: number, lvl: number): Maze {
  setSeed(seed);
  const { gw, gh } = dungeonSize(lvl);
  return generateDungeon(gw, gh);
}

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

/**
 * The client simulating a given dungeon: the lowest id still inside it.
 *
 * The same rule the clients derive for themselves, which is what lets the host
 * check it. Creature snapshots, kills and creature blows are only accepted from
 * this player — without that, any peer could kill creatures, award itself the
 * gold, or damage somebody else in a mode with no friendly fire.
 */
function authorityOf(runId: number): number {
  let lowest = Infinity;
  for (const p of players.values()) {
    if (p.inRun && p.runId === runId && p.id < lowest) lowest = p.id;
  }
  return lowest;
}

/**
 * Whether a message about `runId` should reach this player.
 *
 * Everyone in that dungeon, plus anyone watching it. Used by every route that
 * carries something about a run — poses, creatures, kills, world events — so a
 * watcher cannot end up with allies fighting invisible creatures, or with
 * chests that never open.
 */
function inOrWatching(p: Player, runId: number): boolean {
  return p.runId === runId || p.watchRun === runId;
}

/** True while at least one player is inside a dungeon. */
function anyInRun(): boolean {
  return [...players.values()].some((p) => p.inRun);
}

function roster(): LobbyPlayer[] {
  return [...players.values()].map((p) => ({
    id: p.id, name: p.name, host: p.host, inRun: p.inRun, runId: p.runId,
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
  broadcast({ t: 'lobby', players: roster(), level, hard, running: anyInRun() });
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

/**
 * Whether a point is on a floor cell of that run's maze.
 *
 * The rounding matches collides() in world.ts, which is what makes this agree
 * with the client: a player hugging a wall is still nearer the centre of their
 * own cell than the wall's, so a legitimate pose never rounds into stone.
 *
 * A run with no maze — one started before this host knew how to build them —
 * passes everything, because refusing every pose is a worse failure than
 * trusting them.
 */
function onFloor(run: Run | undefined, x: number, z: number): boolean {
  if (!run) return true;
  const gx = Math.round(x / CELL), gz = Math.round(z / CELL);
  const row = run.maze[gz];
  if (!row || row[gx] === undefined) return false;
  return row[gx] === 0;
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
      me = {
        id, name: cleanName(msg.name, id), sock, host: false,
        inRun: false, runId: 0, pose: null, watchRun: 0,
      };
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
    if (msg.t === 'w') {
      // Only a run they were actually in, so nobody can subscribe to a dungeon
      // they were never part of and watch it through the walls.
      const wanted = Number.isInteger(msg.run) ? msg.run : 0;
      // Only from the lobby, and only a dungeon somebody is still in. A client
      // that is inside run 2 asking to watch run 1 would have run 1's kills and
      // events — which carry no run id — applied to run 2's chests and
      // creatures; and a dungeon everyone has left has nothing left to watch.
      const target = wanted !== 0 ? runs.get(wanted) : undefined;
      const alive = target !== undefined && [...players.values()].some((p) => p.inRun && p.runId === wanted);
      me.watchRun = me.runId === 0 && target?.members.has(me.id) && alive ? wanted : 0;
      return;
    }

    if (msg.t === 'leftRun') {
      if (!me.inRun) return;
      const run = runs.get(me.runId);
      const gold = Number.isFinite(msg.gold) ? Math.max(0, Math.round(msg.gold)) : 0;
      // Only what walks out counts. A death still announces itself, because
      // "nobody is bringing that back" is what the rest of the party wants to
      // know at the moment it happens.
      if (run && msg.out === true) run.gold += gold;
      if (run) {
        const total = run.gold;
        const from = me.runId;
        for (const p of players.values()) {
          // Everyone who went in, wherever they are now — a player watching
          // their end screen has left the run and is exactly who this is for.
          // Which score it belongs to travels with it, because the host cannot
          // tell "on run 1's end screen" from "on run 2's" and should not try.
          if (run.members.has(p.id)) {
            send(p.sock, { t: 'g', run: from, total, by: me.id, gold, out: msg.out === true });
          }
        }
      }
      me.inRun = false;
      me.runId = 0;
      // Not watching yet either — that is a separate thing the client asks for.
      me.watchRun = 0;
      // Dropped with the run, so a body does not stay standing in a dungeon its
      // player has already left.
      me.pose = null;
      recomputeHost();
      broadcastLobby();
      return;
    }

    // The creatures, from whoever is simulating them. Relayed rather than
    // stored: this arrives 20 times a second and the only thing the host does
    // with it is trim it per recipient, which it can do from the poses it
    // already holds.
    //
    // Not checked against who the authority is. Every client derives that from
    // the same roster, so a client sending this when it is not the authority is
    // a client that has been modified — and the cost is that its own party sees
    // odd creatures, which is the shape of every other trust decision here.
    if (msg.t === 'm') {
      if (!me.inRun || !Array.isArray(msg.m)) return;
      if (authorityOf(me.runId) !== me.id) return;
      // Checked before anything dereferences a row. A single `null` in this
      // array would throw out of the socket callback below and take the process
      // down with every run inside it — the same shape of failure as the
      // malformed URL escape, and worth being just as careful about.
      const rows = msg.m.filter((row: unknown): row is MobRow => (
        typeof row === 'object' && row !== null
        && Number.isFinite((row as MobRow).x) && Number.isFinite((row as MobRow).z)
        && Number.isFinite((row as MobRow).r) && Number.isInteger((row as MobRow).i)
      ));
      if (!rows.length) return;
      for (const p of players.values()) {
        if (!inOrWatching(p, me.runId) || p.id === me.id) continue;
        // Trimmed to what this player could plausibly care about. At level 15
        // there are over a hundred creatures and most of them are nowhere near
        // anybody; sending them all is bandwidth spent on things nobody can see.
        const near = p.pose
          ? rows.filter((row: MobRow) => {
            const dx = row.x - p.pose!.x, dz = row.z - p.pose!.z;
            return dx * dx + dz * dz < MOB_INTEREST * MOB_INTEREST;
          })
          : rows;
        if (near.length) send(p.sock, { t: 'm', m: near });
      }
      return;
    }

    // A hit landed by someone who is not simulating. Forwarded to the whole run
    // rather than addressed: the authority is derived, not registered, so the
    // host does not know which of them it is — and the others drop it.
    if (msg.t === 'h') {
      if (!me.inRun) return;
      // A hit is the one thing a non-authority may say about a creature, so it
      // is the one thing worth bounding here. Negative damage heals, and an
      // enormous one kills anything in the dungeon from anywhere in it — both
      // with the sender credited for the gold.
      if (!(msg.d > 0) || msg.d > MAX_REPORTED_HIT) return;
      if (!Number.isInteger(msg.i) || msg.i < 0) return;
      for (const p of players.values()) {
        if (inOrWatching(p, me.runId) && p.id !== me.id) send(p.sock, { t: 'h', i: msg.i, d: msg.d, by: me.id });
      }
      return;
    }

    // A kill, a creature's blow, or a parry going the other way. All three are
    // relayed to the run for the same reason the hit reports are: the authority
    // is derived by each client rather than registered here, so the host has no
    // idea which of them any of these concerns — and the ones it does not
    // concern drop them.
    if (msg.t === 'k' || msg.t === 'x' || msg.t === 'y') {
      if (!me.inRun) return;
      // A parry is a claim about yourself and anyone may make it. A kill or a
      // creature's blow is a claim about the simulation, and only the client
      // running it may say either — otherwise a modified peer awards itself
      // kills, or hurts an ally in a mode that has no friendly fire.
      if (msg.t !== 'y' && authorityOf(me.runId) !== me.id) return;
      // A parry is stamped with who actually sent it. The client fills `by`
      // in, and a modified one could name a different player and have the
      // authority rock the creature away from somebody who never parried.
      const out: ServerMsg = msg.t === 'y' ? { t: 'y', i: msg.i, by: me.id } : msg;
      for (const p of players.values()) {
        if (inOrWatching(p, me.runId) && p.id !== me.id) send(p.sock, out);
      }
      return;
    }

    // Something happened to the dungeon. Relayed untouched and unvalidated: the
    // host has no dungeon of its own to check an index against, and a bad index
    // costs the receiver a lookup that finds nothing.
    //
    // Sent to the rest of the run and never back to the sender, who has already
    // applied it — echoing it would open the same chest twice.
    if (msg.t === 'e') {
      if (!me.inRun) return;
      if (!Number.isInteger(msg.i) || msg.i < 0) return;
      // An unknown kind is not harmless: the client's handler falls through to
      // the chest branch, so `{k:'bogus'}` opens chest 0 for the whole party
      // and gives nobody its contents.
      if (!WORLD_EVENTS.includes(msg.k)) return;
      const out: ServerMsg = { t: 'e', k: msg.k, i: msg.i, by: me.id };
      for (const p of players.values()) {
        if (inOrWatching(p, me.runId) && p.id !== me.id) send(p.sock, out);
      }
      return;
    }

    // The hot path: 20 a second per player. Kept above the host gate and
    // deliberately silent — a pose from someone in the lobby is not an error
    // worth logging 20 times a second, it is a message in flight from a run
    // that has just ended.
    if (msg.t === 'p') {
      if (!me.inRun) return;
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z) || !Number.isFinite(msg.r)) return;
      // Checked against the maze, and dropped rather than clamped. A modified
      // client walking through walls would otherwise be visible to everyone as
      // a body gliding through stone, and worse, would pull the creatures after
      // it into places they cannot reach.
      //
      // Dropped, not corrected, because there is no correct answer: the nearest
      // open cell may be on the other side of the wall, and teleporting someone
      // there for one bad packet is a worse bug than their body pausing. The
      // last good pose simply stands until they send another.
      //
      // Authority and validation are different things. This does not simulate
      // anyone — it only refuses the impossible.
      if (!onFloor(runs.get(me.runId), msg.x, msg.z)) return;
      // & 7, not & 3: the animation codes ran past four the moment guarding
      // became reportable, and a two-bit mask would have turned every raised
      // shield into a walk.
      me.pose = { id: me.id, x: msg.x, z: msg.z, r: msg.r, a: (msg.a | 0) & 7 };
      return;
    }

    // Who gets the chest. A client asks for itself when it starts looting and
    // the host answers rather than relays: every message arrives here in an
    // order, and "who asked first" is a question only something with an order
    // can answer. The creature authority is not involved — it has no more
    // information about this than anyone else.
    if (msg.t === 'c') {
      if (!me.inRun) return;
      const run = runs.get(me.runId);
      if (!run || !Number.isInteger(msg.i)) return;
      if (msg.i < 0) return;
      // Claimed for yourself or not at all. Trusting `to` let a modified peer
      // reserve every chest in the dungeon to a player who does not exist and
      // keep everyone else's loot cancelled until each lease ran out.
      if (msg.to !== me.id) return;
      const held = run.claims.get(msg.i);
      // A lease, not a fact. The holder may have died mid-loot and will never
      // say so, and a chest nobody can open again is worse than a rare double
      // payout. Twice LOOT_TIME is comfortably longer than opening one takes.
      const fresh = held && Date.now() - held.at < LOOT_TIME * 2000;
      const to = fresh ? held.to : msg.to;
      if (!fresh) run.claims.set(msg.i, { to, at: Date.now() });
      for (const p of players.values()) {
        if (inOrWatching(p, me.runId)) send(p.sock, { t: 'c', i: msg.i, to });
      }
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
        hard = msg.hard === true;
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
      // Whatever they were watching, they are not now. The client sends w:0
      // when it stops, but a start that arrives first would otherwise leave an
      // old run's kills and world events flowing into a dungeon they index a
      // different set of chests and creatures in.
      p.watchRun = 0;
    }
        runs.set(runId, {
          maze: buildMaze(roll, level), gold: 0, claims: new Map(),
          members: new Set(group.map((p) => p.id)),
        });
        const start: ServerMsg = {
          t: 'start', seed: roll, level, hard, runId,
          players: group.map((p) => ({ id: p.id, name: p.name, host: p.host, inRun: true, runId })),
        };
        // Sent only to the group. Broadcasting it would drag players out of the
        // dungeon they are still in and into a fresh one.
        for (const p of group) send(p.sock, start);
        recomputeHost();
        broadcastLobby();
        console.log(`[coop] run ${runId}: seed ${roll}, level ${level}${hard ? ' hard' : ''}, ${group.length} players`);
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
  for (const [runId, group] of byRun) {
    const poses = group.map((p) => p.pose).filter((x): x is PoseRow => x !== null);
    if (!poses.length) continue;
    // Everyone still down there, plus anyone who went in and has not gone
    // anywhere else since. That second group is the spectators: death is final
    // but watching is offered, and cutting their snapshots would end it after
    // REMOTE_FADE with the bodies quietly fading out.
    //
    // They receive poses without contributing one, which is exactly right — a
    // spectator is not in the dungeon.
    for (const p of players.values()) {
      if (!inOrWatching(p, runId)) continue;
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
