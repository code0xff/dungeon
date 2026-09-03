// Service worker. Lives in assets/, so vite copies it verbatim and it is served
// from the site root alongside index.html — which is what gives it a scope
// covering the whole game.
//
// Strategy, and why:
//
//   navigation  network first, cache fallback
//               A new deploy has to be picked up. Serving a cached index.html
//               first would pin players to an old bundle until the cache expired.
//
//   everything  stale-while-revalidate
//   else        Serve from cache instantly, refresh in the background. This is
//               what makes the ~6MB of models and textures load like a local
//               game on a second visit, and it self-heals: nothing here has to
//               be version-bumped by hand when an asset is regenerated.
//
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

self.addEventListener('install', (e) => {
  // addAll rejects the whole batch if one entry 404s, so failures are per-URL.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

/**
 * Drops asset entries left over from an older version.
 *
 * Only entries carrying a ?v= are touched, so the shell and the content-hashed
 * bundles are left alone — they are already self-versioning, and deleting them
 * here is what would cost the game its offline copy.
 */
async function pruneOldAssets() {
  const cache = await caches.open(CACHE);
  const stale = (await cache.keys()).filter((req) => {
    const v = new URL(req.url).searchParams.get('v');
    return v !== null && v !== ASSET_VERSION;
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

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    // Offline: the last good copy, or the shell for a deep link.
    return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  // A cache hit answers immediately; the refresh continues without blocking it.
  return hit || (await fetching) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Only same-origin GETs. A POST or a cross-origin request is left alone.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  e.respondWith(request.mode === 'navigate' ? networkFirst(request) : staleWhileRevalidate(request));
});
