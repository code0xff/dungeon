import { FINAL_STAGE, GUIDE_KEY } from './config';
import { initAudio } from './audio';
import { el } from './dom';
import { closeGuidePanel, openGuidePanel } from './guide';
import { progress, resetProgress } from './progress';
import { closeLobbyPanel, leaveLobby, openLobbyPanel } from './net/lobby';
import { coop } from './net/session';
import { closeShop } from './shop';
import { state } from './state';
import { startTutorial } from './tutorial';
import { lockFromClick } from './input';
import { guideBtn, guideCloseBtn, lockHintEl, overlayEl } from './ui';
import { buildWorld } from './world';
import { pickMode } from './mode';

/**
 * The pause menu, on GUIDE_KEY.
 *
 * That key used to open the control list directly, which made the only thing
 * you could reach mid-run a reference card — there was no way to abandon a run
 * and start over short of clearing the browser's storage. The controls are now
 * one entry inside this rather than the whole of it.
 *
 * It owns `state.paused` and the panel stack. The guide is a child screen: its
 * Back returns here rather than to the game, so there is one way out and it is
 * always the same key.
 *
 * This module registers its own key and touch handlers instead of being driven
 * from input.ts. input.ts is imported by world.ts, and this needs buildWorld()
 * for New game — going through input.ts would have made that a cycle.
 */
const menuEl = el('menu');
const statusEl = el('menuStatus');
const resumeBtn = el('menuResume');
const guideItem = el('menuGuide');
const newBtn = el('menuNew');
const coopItem = el('menuCoop');
const tutorialItem = el('menuTutorial');
const titleEl = el('title');
const titleContinue = el('titleContinue');
const titleNew = el('titleNew');
const titleTutorial = el('titleTutorial');
const coopCloseBtn = el('coopClose');
const coopPanelEl = el('coop');

/** Whether New game has been clicked once and is waiting for confirmation. */
let armed = false;
let guideOpen = false;
/** New game on the title has been clicked once and is waiting for confirmation. */
let titleArmed = false;
/**
 * The guide or the lobby was opened from the title screen, so Back returns
 * there rather than to the pause menu — which a player who has not started a
 * game yet has never seen.
 */
let fromTitle = false;

/**
 * Read from the panel rather than tracked alongside it.
 *
 * A second boolean went out of sync the moment anything but this module opened
 * or closed the panel — and two things do: the lobby closes it on the host's
 * start, and the end-of-run screen reopens it. Whichever one moved without
 * telling the menu left Escape and the menu key acting on the wrong screen.
 */
function coopOpen(): boolean {
  return coopPanelEl.style.display === 'flex';
}

function disarm(): void {
  armed = false;
  newBtn.classList.remove('arm');
  newBtn.textContent = 'New game';
}

/**
 * Kept in step with the panels on every transition.
 *
 * input.ts reads it instead of importing this module: menu.ts already registers
 * its own listeners to avoid a cycle through world.ts, and a flag on `state`
 * keeps that arrangement intact.
 */
function syncUi(): void {
  state.uiOpen = isMenuOpen();
}

export function isMenuOpen(): boolean {
  return state.title || menuEl.style.display === 'flex' || guideOpen || coopOpen();
}

export function openMenu(): void {
  // The title is its own screen; the menu is for a game in progress.
  if (state.title) return;
  disarm();
  guideOpen = false;
  fromTitle = false;
  closeGuidePanel();
  closeLobbyPanel();
  // Not while the end-of-run overlay is up: the loop is already stopped there,
  // and pausing on top of it would leave `paused` set when the next run starts.
  // Solo only. In co-op the dungeon belongs to everyone: freezing it here would
  // stop the creature simulation for the whole party if this client happens to
  // be the one running it, and their creatures would go stale and vanish. It
  // would also be an exploit — reading the menu while a brute walks up.
  if (!state.gameOver && !coop.active) state.paused = true;
  // Reading needs the cursor back; the click that re-locks it is harmless.
  if (document.pointerLockElement) document.exitPointerLock();
  // New game wipes the solo bank and rebuilds the world. In a co-op run that is
  // destroying a save this run has nothing to do with, and then starting a
  // dungeon the host never announced — so it is not offered here at all.
  // Hidden rather than disabled: a greyed button invites a second click.
  newBtn.style.display = coop.active ? 'none' : 'block';
  // The lesson is a solo thing: starting it from a co-op run would build a
  // room the party never announced.
  tutorialItem.style.display = coop.active ? 'none' : 'block';
  statusEl.textContent = state.tutorial
    ? 'Tutorial'
    : coop.active
      ? `Multiplayer  ·  level ${coop.level}`
      : `${progress.hard ? 'Hard  ·  ' : ''}Stage ${progress.stage}  ·  Bank ${progress.bankGold} G`;
  el('menuNote').textContent = coop.active
    ? 'A multiplayer run banks nothing and changes nothing you have saved. The dungeon does not stop while you read this.'
    : 'A new game wipes the bank and starts again at stage 1.';
  menuEl.style.display = 'flex';
  syncUi();
}

export function closeMenu(): void {
  disarm();
  guideOpen = false;
  closeGuidePanel();
  closeLobbyPanel();
  menuEl.style.display = 'none';
  state.paused = false;
  syncUi();
}

export function toggleMenu(): void {
  if (state.title) return;
  if (isMenuOpen()) closeMenu();
  else openMenu();
}

/** Escape steps back one screen rather than dropping straight into the game. */
function back(): void {
  if (guideOpen) {
    guideOpen = false;
    closeGuidePanel();
    if (fromTitle) showTitle();
    else menuEl.style.display = 'flex';
    syncUi();
    return;
  }
  if (coopOpen()) {
    // Back out of the lobby drops the connection rather than hiding it. A
    // socket left open behind a closed panel is a player the host still counts
    // against the four, and nobody can see they are there.
    leaveLobby();
    if (fromTitle) showTitle();
    else menuEl.style.display = 'flex';
    syncUi();
    return;
  }
  if (state.title) return;
  closeMenu();
}

// ================= Title screen =================
/**
 * The first screen: the name, a line, the choices, and the rules in four
 * sentences over the dungeon itself.
 *
 * It replaced three things that used to happen to a player instead of being
 * chosen — the tutorial opening on its own on a first visit, a checkbox to
 * stop it doing so, and the mode question arriving out of nowhere after the
 * lesson. And its first click is the one the browser wants before it will
 * play a sound or take the cursor, so every way off this screen starts the
 * game properly instead of waiting for a click on the world.
 */
function showTitle(): void {
  titleEl.style.display = 'flex';
}

function titleDisarm(): void {
  titleArmed = false;
  titleNew.classList.remove('arm');
  titleNew.textContent = progress.started ? 'New game' : 'Play';
}

export function openTitle(): void {
  state.title = true;
  state.paused = true;
  fromTitle = false;
  titleDisarm();
  if (document.pointerLockElement) document.exitPointerLock();
  // The click-to-lock card is for a world being played. Behind the title it
  // showed through the backdrop between the buttons, and the title's own first
  // click takes the lock anyway.
  lockHintEl.style.display = 'none';
  // A save offers Continue first and biggest; a first visit offers the lesson.
  titleContinue.style.display = progress.started ? 'block' : 'none';
  titleContinue.textContent = `Continue  ·  Stage ${progress.stage}${progress.hard ? '  ·  Hard' : ''}`;
  titleContinue.classList.toggle('titlePrimary', progress.started);
  titleTutorial.classList.toggle('titlePrimary', !progress.started);
  el('titleBottom').textContent = `Stage ${FINAL_STAGE} is the bottom. Below it, everything grows.`;
  showTitle();
  syncUi();
}

/** Off the title and into play. Every exit that starts a game goes through here. */
function leaveTitle(): void {
  state.title = false;
  fromTitle = false;
  titleEl.style.display = 'none';
  state.paused = false;
  syncUi();
}

titleContinue.addEventListener('click', () => {
  initAudio();
  lockFromClick();
  leaveTitle();
  // The world behind the title is the save's own dungeon, already built; the
  // lock card it put up is moot now the click has asked for the lock.
  lockHintEl.style.display = 'none';
});

titleNew.addEventListener('click', () => {
  // Only asked when there is something to lose.
  if (progress.started && (progress.bankGold > 0 || progress.stage > 1) && !titleArmed) {
    titleArmed = true;
    titleNew.classList.add('arm');
    titleNew.textContent = `Erase ${progress.bankGold} G and stage ${progress.stage}?`;
    return;
  }
  resetProgress();
  leaveTitle();
  pickMode(buildWorld);
});

titleTutorial.addEventListener('click', () => {
  initAudio();
  lockFromClick();
  leaveTitle();
  // A first visit walks out of the lesson into choosing a mode; a save walks
  // back into the dungeon it was in.
  startTutorial(progress.started ? buildWorld : () => pickMode(buildWorld));
});

el('titleCoop').addEventListener('click', () => {
  fromTitle = true;
  titleEl.style.display = 'none';
  openLobbyPanel();
  syncUi();
});

el('titleGuide').addEventListener('click', () => {
  fromTitle = true;
  guideOpen = true;
  titleEl.style.display = 'none';
  openGuidePanel();
  syncUi();
});

resumeBtn.addEventListener('click', closeMenu);

coopItem.addEventListener('click', () => {
  disarm();
  menuEl.style.display = 'none';
  openLobbyPanel();
  syncUi();
});

coopCloseBtn.addEventListener('click', back);

guideItem.addEventListener('click', () => {
  disarm();
  guideOpen = true;
  menuEl.style.display = 'none';
  openGuidePanel();
  syncUi();
});

newBtn.addEventListener('click', () => {
  if (!armed) {
    armed = true;
    newBtn.classList.add('arm');
    // The bank is named because it is the only thing that survives death, so it
    // is the only thing this destroys that the player would miss.
    newBtn.textContent = `Erase ${progress.bankGold} G and start over?`;
    return;
  }
  resetProgress();
  closeShop();
  overlayEl.style.display = 'none';
  state.gameOver = false;
  closeMenu();
  // Straight to the mode, then stage 1. The lesson is its own item now, here
  // and on the title, rather than something a new game opens on.
  state.tutorial = false;
  pickMode(buildWorld);
});

tutorialItem.addEventListener('click', () => {
  closeShop();
  overlayEl.style.display = 'none';
  state.gameOver = false;
  closeMenu();
  startTutorial();
});


guideCloseBtn.addEventListener('click', back);
guideBtn.addEventListener('click', toggleMenu);

addEventListener('keydown', (e) => {
  // Auto-repeat would toggle the panel on every repeat, so holding the key made
  // the menu flicker open and shut and left the pause state wherever the release
  // happened to land.
  if (e.repeat) return;
  if (e.code === `Key${GUIDE_KEY}`) {
    toggleMenu();
    return;
  }
  if (e.code === 'Escape' && isMenuOpen()) back();
});
