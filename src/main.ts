import { loadAssets } from './assets';
import { loadProgress } from './progress';
import { el } from './dom';
import { animate } from './loop';
import { buildWorld } from './world';
// Imported for side effects: keyboard/mouse/touch listeners and the audio unlock.
import './input';

// Restore the bank and any carried gear before the first world is built.
loadProgress();

// Production only: a caching worker in dev would serve stale modules and make
// HMR lie about what is running.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => {
      // Not fatal — the game just will not work offline.
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}

const loadingEl = el('loading');

el('restart').addEventListener('click', buildWorld);

loadAssets((msg) => {
  loadingEl.textContent = msg + '...';
})
  .then(() => {
    loadingEl.style.display = 'none';
    buildWorld();
    animate();
  })
  .catch((err: unknown) => {
    console.error(err);
    loadingEl.textContent = 'Load error — check the console (F12)';
  });
