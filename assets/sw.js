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
// simply stops being requested. The GLB and webp files are not hashed, which is
// exactly why they need the revalidate half rather than plain cache-first.

const CACHE = 'dungeon-v1';

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

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
