import { COOP_MAX_LEVEL } from '../config';
import { el } from '../dom';
import { progress } from '../progress';
import { state } from '../state';
import { overlayEl } from '../ui';
import { buildWorld } from '../world';
import { connect, disconnect, net, onNetChange, onNetStart, setLevel, startRun } from './client';
import { MAX_PLAYERS, NAME_MAX } from './protocol';
import { coop } from './session';

/**
 * The co-op lobby panel: name, server address, who is here, and — for the host
 * — the level dial and the button that starts the run.
 *
 * It is a child screen of the pause menu, the same as the controls, so there is
 * one way in and one way back out.
 */
const panelEl = el('coop');
const nameEl = el('coopName') as HTMLInputElement;
const serverEl = el('coopServer') as HTMLInputElement;
const connectBtn = el('coopConnect');
const listEl = el('coopList');
const statusEl = el('coopStatus');
const levelRow = el('coopLevelRow');
const levelEl = el('coopLevel');
const levelDown = el('coopLevelDown');
const levelUp = el('coopLevelUp');
const startBtn = el('coopStart');
const formEl = el('coopForm');

/** Remembered between visits so rejoining is one click rather than retyping. */
const NAME_KEY = 'dungeon.coop.name';
const SERVER_KEY = 'dungeon.coop.server';

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    // Private mode throws rather than returning null. A forgotten name is not
    // a reason to refuse to show the panel.
    return '';
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // As above: nothing here is worth failing over.
  }
}

nameEl.maxLength = NAME_MAX;
nameEl.value = load(NAME_KEY);
serverEl.value = load(SERVER_KEY);

function render(): void {
  const connected = net.phase === 'lobby' || net.phase === 'run';
  formEl.style.display = connected ? 'none' : 'block';
  connectBtn.textContent = net.phase === 'connecting' ? 'Connecting...' : 'Connect';
  levelRow.style.display = connected && net.host ? 'flex' : 'none';
  startBtn.style.display = connected && net.host ? 'block' : 'none';

  listEl.textContent = '';
  for (const p of net.players) {
    const row = document.createElement('div');
    row.className = 'guideRow';
    const l = document.createElement('span');
    l.className = 'guideLabel';
    // textContent, not innerHTML: these names came off the network. The host
    // strips control characters, but it is not the only thing that could ever
    // be on the other end of this socket.
    l.textContent = p.name + (p.id === net.id ? ' (you)' : '');
    const k = document.createElement('span');
    k.className = 'guideKeys';
    k.textContent = p.host ? 'host' : p.inRun ? 'in the dungeon' : 'waiting';
    row.append(l, k);
    listEl.append(row);
  }

  levelEl.textContent = `Level ${net.level}`;

  const waiting = net.players.filter((p) => !p.inRun).length;
  if (net.error) statusEl.textContent = net.error;
  else if (net.phase === 'offline') statusEl.textContent = 'Not connected.';
  else if (net.phase === 'connecting') statusEl.textContent = 'Connecting...';
  else if (net.running) {
    // A run being underway does not block anything for the people out here —
    // it only means the party would be smaller. Saying how many are waiting is
    // the number that decides whether to start now or hold on.
    statusEl.textContent = net.host
      ? `A dungeon is running. ${waiting} waiting here.`
      : `A dungeon is running. ${waiting} waiting here for the next one.`;
  } else if (net.host) {
    statusEl.textContent = `You are the host. ${net.players.length}/${MAX_PLAYERS} here.`;
  } else {
    statusEl.textContent = `Waiting for the host to start. ${net.players.length}/${MAX_PLAYERS} here.`;
  }

  // Named by who it takes in, because it does not take everyone: players still
  // underground are left where they are. That is how the dead get a second run
  // without waiting for the first to finish.
  startBtn.textContent = net.running && waiting < net.players.length
    ? `Start a run for the ${waiting} waiting`
    : 'Start the run';
}

onNetChange(render);

onNetStart((seed, level) => {
  coop.active = true;
  coop.seed = seed;
  coop.level = level;
  // The end-of-run overlay and the pause both belong to whatever came before.
  // Leaving either set would drop the party into a dungeon that is already
  // stopped, which looks exactly like the game failing to load.
  overlayEl.style.display = 'none';
  state.gameOver = false;
  state.paused = false;
  closeLobbyPanel();
  buildWorld();
});

connectBtn.addEventListener('click', () => {
  const name = nameEl.value.trim();
  const server = serverEl.value.trim();
  save(NAME_KEY, name);
  save(SERVER_KEY, server);
  connect(server, name);
});

// Enter in either field connects, so the whole panel is reachable from the
// keyboard the player already has their hands on.
for (const field of [nameEl, serverEl]) {
  field.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') connectBtn.click();
    // Otherwise WASD in the name field walks the player through the dungeon
    // behind the panel, and the pause menu key closes the menu mid-word.
    e.stopPropagation();
  });
}

levelDown.addEventListener('click', () => setLevel(Math.max(1, net.level - 1)));
levelUp.addEventListener('click', () => setLevel(Math.min(COOP_MAX_LEVEL, net.level + 1)));
startBtn.addEventListener('click', startRun);

export function openLobbyPanel(): void {
  // The solo bank is shown nowhere in here on purpose: co-op neither reads it
  // nor adds to it, and putting it on screen would imply otherwise.
  if (!nameEl.value) nameEl.value = `Delver ${progress.seed % 100}`;
  render();
  panelEl.style.display = 'flex';
}

export function closeLobbyPanel(): void {
  panelEl.style.display = 'none';
}

/** Leaves the lobby entirely — the menu's Back does this, not just hide. */
export function leaveLobby(): void {
  disconnect();
  net.error = '';
  closeLobbyPanel();
}
