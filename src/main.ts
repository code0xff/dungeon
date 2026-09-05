import { loadAssets } from './assets';
import { loadProgress, setRunSeed } from './progress';
import { el } from './dom';
import { animate } from './loop';
import { buildWorld } from './world';
import { closeShop } from './shop';
// Imported for side effects: keyboard/mouse/touch listeners and the audio unlock.
import './input';
// Same: the pause menu registers its own key, click and touch handlers.
import './menu';

// Restore the bank and any carried gear before the first world is built.
loadProgress();

// ?seed=12345 pins the run seed, so a dungeon can be reproduced exactly — for a
// bug report, for testing, and eventually for two players sharing a world. It is
// applied after loadProgress() precisely so it wins over the saved seed, and it
// leaves the stage alone: the same seed on stage 3 is a different dungeon.
const seedParam = new URLSearchParams(location.search).get('seed');
if (seedParam !== null) {
  const n = Number(seedParam);
  // Rejecting rather than defaulting to 0: a typo that silently produced a
  // valid-but-different dungeon would be worse than being told it was ignored.
  if (Number.isFinite(n)) setRunSeed(n);
  else console.warn(`[world] ignoring ?seed=${seedParam} — not a number`);
}

// Production only: a caching worker in dev would serve stale modules and make
// HMR lie about what is running.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    // The version on the URL is what makes the browser re-install the worker when
    // an asset changes, which is what lets it start a clean cache.
    navigator.serviceWorker.register(`./sw.js?v=${__ASSET_VERSION__}`).catch((err: unknown) => {
      // Not fatal — the game just will not work offline.
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}

const loadingEl = el('loading');
// The progress line is its own element: writing textContent on the wrapper would
// take the title out with it on the first asset loaded.
const loadMsgEl = el('loadMsg');

el('restart').addEventListener('click', () => {
  // The shop wrote straight into progress, so buildWorld() picks up whatever
  // was bought without anything having to be handed across.
  closeShop();
  buildWorld();
});

loadAssets((msg) => {
  loadMsgEl.textContent = msg + '...';
})
  .then(() => {
    loadingEl.style.display = 'none';
    buildWorld();
    animate();
  })
  .catch((err: unknown) => {
    console.error(err);
    loadMsgEl.textContent = 'Load error — check the console (F12)';
  });
