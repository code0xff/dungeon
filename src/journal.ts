import * as THREE from 'three';
import { sfxPickup } from './audio';
import { CELL, PAGE } from './config';
import { el, queryChild } from './dom';
import { JOURNAL, pageFor } from './lore';
import { inTraining, notePage, progress } from './progress';
import { state } from './state';
import type { GridCell } from './types';
import { showMsg } from './ui';

// Brother Aldric's journal: a page on the floor of most stages, and a panel in
// the pause menu that holds every one found.
//
// A page is placed only where it would be new — a stage whose page this save
// has already read gets none — and never in training, which borrows the save
// and must not write to it. In co-op each player finds their own copy of the
// same page: it is a thing read, not a thing shared out.
//
// Nothing at the top level reads an imported binding: loot.ts imports this,
// and ui.ts imports loot.ts (see Module layers in docs/architecture.md).

const readEl = el('pageRead');
let readTimer: ReturnType<typeof setTimeout> | null = null;

/** The parchment and its faint light, shared: every page looks the same. */
let pageGeo: THREE.PlaneGeometry | null = null;
let pageMat: THREE.MeshBasicMaterial | null = null;

/**
 * Lays this stage's page in one of `ends` — the dead ends the levers did not
 * take — or nothing, when there is no page for the stage or it has been read.
 * The middle one by distance from the start: not on the doorstep, not always
 * at the far end where a lever or the portal already pulls the player.
 * Deterministic, so it draws nothing from the seeded stream.
 */
export function placePage(stage: number, ends: GridCell[]): THREE.Object3D | null {
  const entry = pageFor(stage);
  if (entry < 0 || inTraining() || progress.journal.includes(entry)) return null;
  const far = ends
    .filter(([x, z]) => Math.hypot(x - 1, z - 1) >= PAGE.minDist)
    .sort((a, b) => Math.hypot(a[0] - 1, a[1] - 1) - Math.hypot(b[0] - 1, b[1] - 1));
  if (!far.length) return null;
  const [x, z] = far[Math.floor(far.length / 2)];
  pageGeo ??= new THREE.PlaneGeometry(0.28, 0.36);
  // Unlit, so it is a pale shape in the dark before the lantern reaches it:
  // the one thing on the floor that is meant to be seen from a distance.
  pageMat ??= new THREE.MeshBasicMaterial({ color: PAGE.glow, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(pageGeo, pageMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = (entry * 1.7) % (Math.PI * 2);
  mesh.position.set(x * CELL, 0.015, z * CELL);
  state.pages.push({ mesh, entry, x: x * CELL, z: z * CELL, taken: false });
  return mesh;
}

/** Finds the page in reach. Every frame. */
export function updatePages(): void {
  state.nearPage = null;
  for (const p of state.pages) {
    if (!p.taken && Math.hypot(p.x - state.pos.x, p.z - state.pos.z) < PAGE.reach) state.nearPage = p;
  }
}

/** Picks up the page in reach and reads it out. Returns whether there was one. */
export function takePage(): boolean {
  const p = state.nearPage;
  if (!p || p.taken) return false;
  p.taken = true;
  p.mesh.visible = false;
  state.nearPage = null;
  notePage(p.entry);
  sfxPickup();
  const page = JOURNAL[p.entry];
  queryChild(readEl, 'strong').textContent = page.title;
  queryChild(readEl, 'p').textContent = page.text;
  readEl.classList.add('show');
  if (readTimer !== null) clearTimeout(readTimer);
  // Long enough to read twice at an unhurried pace; the journal keeps it after.
  readTimer = setTimeout(() => readEl.classList.remove('show'), 4000 + page.text.length * 45);
  showMsg(`A page of a journal — ${progress.journal.length} of ${JOURNAL.length}`);
  return true;
}

/** Takes the page down early: a new dungeon, or the title. */
export function hidePage(): void {
  if (readTimer !== null) clearTimeout(readTimer);
  readEl.classList.remove('show');
}

/** Fills the journal panel from the save. Pages not found yet show as where they lie. */
export function fillJournal(): void {
  const list = el('journalList');
  list.replaceChildren(...JOURNAL.map((page, i) => {
    const row = document.createElement('div');
    row.className = 'journalEntry';
    if (!progress.journal.includes(i)) {
      row.classList.add('missing');
      row.textContent = `A page lost somewhere on stage ${page.stage}`;
      return row;
    }
    const title = document.createElement('b');
    title.textContent = page.title;
    const text = document.createElement('p');
    text.textContent = page.text;
    row.append(title, text);
    return row;
  }));
  el('journalNote').textContent = inTraining()
    ? 'Pages are not left lying in training. The journal is the save\'s.'
    : `${progress.journal.length} of ${JOURNAL.length} pages. What is read is kept, whatever happens to the run.`;
}
