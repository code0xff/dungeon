import { loadAssets } from './assets';
import { loadProgress, setRunSeed } from './progress';
import { startTutorial, tutorialPref, wantsTutorial } from './tutorial';
import { pickMode } from './mode';
import { el } from './dom';
import { animate } from './loop';
import { buildWorld } from './world';
import { closeShop } from './shop';
import { coop } from './net/session';
import { openLobbyPanel, stopWatching } from './net/lobby';
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
  // In co-op there is nothing to outfit and no next stage to walk into: the run
  // is over and the only thing to do is go back to the lobby, still connected,
  // and wait for the host to open another one. Clearing `active` here is what
  // stops a later solo run being built at the party's level.
  if (coop.active) {
    coop.active = false;
    // Forgotten too, or a party total from that dungeon arriving later is
    // accepted in the middle of a solo run and writes over its death screen.
    coop.runId = 0;
    stopWatching();
    el('overlay').style.display = 'none';
    // The solo game is rebuilt rather than merely un-paused. Clearing
    // `gameOver` on its own left the co-op dungeon standing with its key in the
    // player's pack and its portal underfoot — and one frame later the solo
    // portal check banked a co-op run into the solo save, which is the one
    // thing this mode promises never to do. Leaving co-op means going back to
    // your own game, and this is what that means.
    buildWorld();
    openLobbyPanel();
    return;
  }
  // The shop wrote straight into progress, so buildWorld() picks up whatever
  // was bought without anything having to be handed across.
  closeShop();
  // Put back after a death renamed it.
  el('restart').textContent = 'Descend';
  buildWorld();
});

loadAssets((msg) => {
  loadMsgEl.textContent = msg + '...';
})
  .then(() => {
    loadingEl.style.display = 'none';
    // The first visit opens on the lesson. After that it is New game and the
    // menu that start it — a save that died and came back does not need to
    // learn the sword again.
    // The first visit: the lesson if it is wanted, then the mode, then stage
    // 1. A returning save has already answered both.
    const fresh = !tutorialPref.seen;
    if (fresh && wantsTutorial()) startTutorial(() => pickMode(buildWorld));
    else if (fresh) pickMode(buildWorld);
    else buildWorld();
    animate();
  })
  .catch((err: unknown) => {
    console.error(err);
    loadMsgEl.textContent = 'Load error — check the console (F12)';
  });
