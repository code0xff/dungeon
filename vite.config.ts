import { defineConfig } from 'vite';

export default defineConfig({
  // Build with relative paths so dist/ can be served from any sub-path,
  // which is what makes the GitHub Pages project URL work unchanged.
  base: './',
  // assets/ is used directly as the static directory, so the folder layout the
  // README describes (assets/creatures/..., assets/textures/...) stays as written.
  // The cost is that runtime URLs drop the leading 'assets/' — 'creatures/zombie/idle.fbx'.
  publicDir: 'assets',
  // host: true binds 0.0.0.0, so a phone or tablet on the same network can connect.
  server: { host: true, open: false },
  build: { outDir: 'dist', target: 'es2022' },
});
