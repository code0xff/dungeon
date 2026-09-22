import { FINAL_STAGE, TRAINING_GOLD } from './config';
import { el } from './dom';
import { enterTraining, inTraining, leaveTraining, progress } from './progress';
import { openShop } from './shop';
import { state } from './state';

/**
 * Training: any stage, a full purse, and nothing kept.
 *
 * It is the real game — the same maze generator, the same spawn curve, the same
 * shop — with two things changed. The stage is chosen instead of earned, and
 * the purse is refilled to TRAINING_GOLD every time the outfitting screen opens,
 * so the question stops being what you can afford and becomes what you want to
 * take down there. Nothing is banked and nothing is saved: progress.ts shelves
 * the save for the duration (see `inTraining`), so a practice run cannot cost a
 * real one a single gold piece, and cannot advance it either.
 *
 * Dying here starts the same stage again. Walking out offers the next one down,
 * which is how a player works toward the stage they actually want to practise
 * without having to type it in each time.
 *
 * It imports nothing from ui.ts or input.ts on purpose. ui.ts imports this one
 * for trainingEnded(), and an import back would put input.ts inside that cycle
 * — where it reads ui.ts's buttons at module level, and so would read them
 * before ui.ts had defined them. The overlay is taken from the DOM directly and
 * the sound-and-cursor gesture is handed in by the caller. See "Module layers"
 * in docs/architecture.md.
 */

const panelEl = el('trainPick');
const stageEl = el('trainStage');
const noteEl = el('trainNote');
const hardEl = el('trainHard');

/** The stage the panel is showing. Kept between opens, so re-entering is one click. */
let stage = 1;
let hard = false;

/** Stages past the bottom exist and keep growing, so the picker goes a little beyond it. */
const MAX_STAGE = FINAL_STAGE + 6;

function draw(): void {
  stageEl.textContent = String(stage);
  noteEl.textContent = stage > FINAL_STAGE
    ? `Past the bottom: everything is stronger down here than at stage ${FINAL_STAGE}.`
    : stage === 1 ? 'The shallowest floor, and the emptiest.'
      : `A stage ${stage} dungeon, with stage ${stage} creatures in it.`;
  hardEl.textContent = hard ? 'Hard rules: on' : 'Hard rules: off';
  hardEl.classList.toggle('arm', hard);
}

function step(by: number): void {
  stage = Math.min(MAX_STAGE, Math.max(1, stage + by));
  draw();
}

/** What Back returns to — the title, handed in by menu.ts. */
let onBack: (() => void) | null = null;
/** The sound-and-cursor gesture, likewise: see the note at the top of the file. */
let onStart: (() => void) | null = null;

/** Opens the picker. `back` returns to the title; `start` takes the click's gesture. */
export function openTraining(back: () => void, start: () => void): void {
  onBack = back;
  onStart = start;
  draw();
  panelEl.style.display = 'flex';
  // Held like the mode question: what is behind it is the last world built, and
  // a click meant for a button must not also be a swing.
  state.uiOpen = true;
  state.paused = true;
  if (document.pointerLockElement) document.exitPointerLock();
}

function closePanel(): void {
  panelEl.style.display = 'none';
  state.uiOpen = false;
}

/**
 * Puts the outfitting screen up on a fresh training kit at `at`.
 *
 * The overlay rather than a panel of its own, because that is where the shop
 * lives and this is the same act: stand at the counter, then descend.
 */
function outfit(at: number): void {
  stage = at;
  enterTraining(stage, hard, TRAINING_GOLD);
  el('ovTitle').textContent = 'Training';
  el('ovTitle').className = 'win';
  el('ovDesc').textContent = `Stage ${stage}${hard ? ' · hard rules' : ''}. `
    + 'Take what you like — none of it is paid for, and none of it is kept.';
  el('ovBank').textContent = 'Nothing here is banked';
  el('ovCredit').style.display = 'none';
  el('ovWatch').style.display = 'none';
  el('restart').textContent = 'Descend';
  openShop(progress, () => {});
  el('overlay').style.display = 'flex';
}

/** The run is over. Offers the counter again: the same stage, or the next one down. */
export function trainingEnded(extracted: boolean): void {
  // Health and gear are not carried between practice runs — the point is to
  // start a stage from a known place, not to inherit a worn-down one.
  outfit(extracted ? Math.min(MAX_STAGE, stage + 1) : stage);
  el('ovTitle').textContent = extracted ? 'Extracted' : 'Killed';
  el('ovTitle').className = extracted ? 'win' : 'dead';
  el('ovDesc').textContent = extracted
    ? `Stage ${stage - 1} cleared. Outfit again for stage ${stage}, or pick another from the title.`
    : `Stage ${stage} again, then. Outfit and go back down.`;
}

/** Drops training and puts the save back. The caller rebuilds the world. */
export function endTraining(): void {
  if (!inTraining()) return;
  leaveTraining();
}

el('trainBack').addEventListener('click', () => {
  closePanel();
  onBack?.();
});

el('trainDown').addEventListener('click', () => step(-1));
el('trainUp').addEventListener('click', () => step(1));
hardEl.addEventListener('click', () => {
  hard = !hard;
  draw();
});
el('trainStart').addEventListener('click', () => {
  closePanel();
  // The click that starts is the one the browser wants before it will play a
  // sound or take the cursor, as on every other way off the title.
  onStart?.();
  outfit(stage);
});
