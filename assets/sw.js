// Service worker. Lives in assets/, so vite copies it verbatim and it is served
// from the site root alongside index.html — which is what gives it a scope
// covering the whole game.
//
// Strategy, and why:
//
//   install     precache everything
//               precache.json, written by the build, lists every file the game
//               can request. All of it is fetched before the worker takes over,
//               so one online visit is enough to play offline — not only the
//               models one session happened to load.
//
//   navigation  network first, with a timeout, cache fallback
//               A new deploy has to be picked up. Serving a cached index.html
//               first would pin players to an old bundle. But a connection that
//               is up and not answering would hold the loading screen forever,
//               so after NAV_TIMEOUT the cached page is served and the network
//               copy still lands in the cache when it arrives.
//
//   everything  stale-while-revalidate
//   else        Serve from cache instantly, refresh in the background.

// The bundle filenames are content-hashed by vite, so a stale entry for those
// simply stops being requested. The GLB and webp files are not, so they carry a
// ?v= built from a hash of assets/ instead — same effect, one hash for the whole
// folder rather than one per file. That query is what makes a changed model a
// different URL, and so a cache miss, and so actually reach the player.

// github.io is one origin for every project page on the account, so the Cache
// Storage here is shared with any other PWA published under it. Names are
// prefixed and the activate sweep only ever touches this prefix — deleting by
// "not the current cache" would wipe a neighbouring app's offline copy.
const PREFIX = 'dungeon-';

/**
 * Every cache lookup ignores Vary. A server that sends Vary: Origin (vite
 * preview does) stores each response keyed to the precache's Origin-less
 * request, and the page's module script, which sends Origin, then never
 * matched it: offline, the bundle failed to load and the game sat on its
 * loading screen. Nothing here varies by header in a way that matters.
 */
const MATCH = { ignoreVary: true };
const CACHE = `${PREFIX}v1`;

/**
 * The asset version, put on this script's URL by main.ts. It is a hash of
 * assets/, so it moves only when a model or texture actually changes.
 *
 * It is not part of the cache name, and that is deliberate. Naming the cache
 * after it looked tidier and broke offline: the page's requests are served by
 * whichever worker is already in control, so on the load after a deploy they are
 * cached under the *old* name, and the new worker's activate sweep then deletes
 * them — bundle included. The game came back from that with a loading screen and
 * no error. One durable cache, pruned by version below, has no such window.
 */
const ASSET_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';

/** Enough to open the game offline after one visit. The rest arrives by use. */
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

/** Milliseconds a navigation waits on the network before the cached page is served. */
const NAV_TIMEOUT = 3000;

/** Files fetched at once during precache: all fourteen megabytes in parallel stalls a phone. */
const PRECACHE_CONCURRENCY = 6;

/**
 * Fetches everything in precache.json that is not already cached. Failures are
 * per URL — addAll rejects the whole batch if one entry 404s — and a failed
 * file is simply cached later, on first use, as before.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
  let urls = [];
  try {
    const res = await fetch('./precache.json', { cache: 'no-store' });
    if (res.ok) {
      urls = (await res.json()).urls || [];
      // Kept for pruneOldAssets, which has to know what the game still uses.
      await cache.put('./precache.json', new Response(JSON.stringify({ urls })));
    }
  } catch {
    return; // Offline at install, or a dev build with no list: use-driven caching only.
  }
  const todo = [];
  for (const u of urls) if (!(await cache.match(u, MATCH))) todo.push(u);
  const worker = async () => {
    for (let u = todo.pop(); u !== undefined; u = todo.pop()) await cache.add(u).catch(() => {});
  };
  await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, worker));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

/**
 * Drops asset entries left over from an older version.
 *
 * The shell is never touched. A content-hashed bundle goes only when the
 * current precache list is known and no longer names it; deleting bundles
 * without that list is what once cost the game its offline copy.
 *
 * And an old copy goes only once the current one is in the cache. Pruning by
 * version alone deleted every old model at activate, and a player who lost the
 * connection before the new ones arrived was left with primitive stand-ins;
 * now the old model stays the offline fallback until its replacement lands.
 * A file the current build no longer lists at all (a model that was removed)
 * has no replacement coming, so it goes too.
 */
async function pruneOldAssets() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const current = new Set(keys
    .filter((req) => new URL(req.url).searchParams.get('v') === ASSET_VERSION)
    .map((req) => new URL(req.url).pathname));
  const listed = await cache.match('./precache.json', MATCH);
  const wanted = listed
    ? new Set(((await listed.json()).urls || []).map((u) => new URL(u, self.location.href).pathname))
    : null;
  const shell = new Set([...SHELL, './precache.json'].map((u) => new URL(u, self.location.href).pathname));
  const stale = keys.filter((req) => {
    const url = new URL(req.url);
    const v = url.searchParams.get('v');
    // Unversioned: the shell, and bundles whose names vite hashed. An old bundle
    // is never asked for again, so once the list is known it is just weight.
    if (v === null) return wanted !== null && !wanted.has(url.pathname) && !shell.has(url.pathname);
    if (v === ASSET_VERSION) return false;
    return current.has(url.pathname) || (wanted !== null && !wanted.has(url.pathname));
  });
  await Promise.all(stale.map((req) => cache.delete(req)));
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(pruneOldAssets)
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, network) {
  const cache = await caches.open(CACHE);
  const cached = async () => (await cache.match(request, MATCH)) || (await cache.match('./index.html', MATCH));
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT, 'timeout'));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
    // Slow, not down: the cached page if there is one, else keep waiting.
    return (await cached()) || (await network);
  } catch {
    // Offline: the last good copy, or the shell for a deep link.
    return (await cached()) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, MATCH);
  const fetching = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const res = await fetching;
  if (res) return res;
  // Offline, and this exact version was never cached: any version beats a
  // primitive stand-in. Only reached when the network has already failed.
  return (await cache.match(request, { ...MATCH, ignoreSearch: true })) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Only same-origin GETs. A POST or a cross-origin request is left alone.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const network = fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    });
    // Keeps the worker alive to finish caching a response that lost the race.
    // waitUntil has to be called during dispatch: after an await it throws,
    // and the navigation fails with it.
    e.waitUntil(network.catch(() => {}));
    e.respondWith(networkFirst(request, network));
    return;
  }
  e.respondWith(staleWhileRevalidate(request));
});
