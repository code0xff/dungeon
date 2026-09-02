import { loadAssets } from './assets';
import { el } from './dom';
import { animate } from './loop';
import { buildWorld } from './world';
// Imported for side effects: keyboard/mouse/touch listeners and the audio unlock.
import './input';

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
