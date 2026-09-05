import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

/**
 * A short hash of everything under assets/.
 *
 * The bundle filenames are content-hashed by vite, so a code change reaches
 * everyone automatically. The models and textures are not — their names are
 * fixed, so a returning player's service worker kept serving the old bytes and
 * a swapped model silently did not appear. This is the version that goes on
 * their URLs and on the service worker's cache name, so changing an asset
 * changes what is asked for.
 *
 * Deliberately one hash for the whole folder rather than one per file: it is a
 * few lines instead of a manifest, and assets change rarely enough that
 * re-fetching all of them on the runs where they do is the cheaper trade.
 */
function hashAssets(dir: string): string {
  const h = createHash('sha1');
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        h.update(name);
        h.update(readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 8);
}

export default defineConfig({
  define: { __ASSET_VERSION__: JSON.stringify(hashAssets('assets')) },
  // Build with relative paths so dist/ can be served from any sub-path,
  // which is what makes the GitHub Pages project URL work unchanged.
  base: './',
  // assets/ is used directly as the static directory, so the folder layout the
  // README describes (assets/creatures/..., assets/textures/...) stays as written.
  // The cost is that runtime URLs drop the leading 'assets/' — 'creatures/zombie/idle.fbx'.
  publicDir: 'assets',
  // host: true binds 0.0.0.0, so a phone or tablet on the same network can connect.
  //
  // The port is pinned off vite's 5173 because that is every vite project's
  // default, so a second one running collides and silently walks up to 5174 —
  // and then the phone on the network is pointed at whichever project won the
  // race. strictPort makes that a startup error instead of a quiet reassignment,
  // which is the whole point: an address printed once should stay true.
  server: { host: true, open: false, port: 5847, strictPort: true },
  build: { outDir: 'dist', target: 'es2022' },
});
