import { sfxPickup } from './audio';
import { BLESS_TIME, SEARCH_ITEMS, SHRINE } from './config';
import { sendEvent } from './net/client';
import { coop } from './net/session';
import { state } from './state';
import type { ItemKind, Shrine, ShrineKind } from './types';
import { cancelShrine, lootBarEl, lootFillEl, showMsg, updateHUD } from './ui';

/**
 * The landmark rooms' interactables: pray at the chapel's statue, take up the
 * watch room's estoc, search the store's shelves.
 *
 * Used the way a chest is opened — E beside it, standing still on the loot bar
 * — and called off the same way, by moving here and by swinging or being hit
 * in combat.ts. Starting makes a lid's noise (loot.ts). Each is spent for the
 * dungeon once used.
 *
 * In co-op a blessing is the party's: whoever takes it, everyone in the run
 * gets the full BLESS_TIME, via a `shrine` world event. A search is the
 * searcher's, as a chest is the opener's; the others only see it spent. Two
 * players finishing the same search inside one round trip both find something
 * — the chests close that race with a claim, and a handful of consumables did
 * not seem worth a second claim path.
 *
 * Nothing at the top level reads an imported binding: ui.ts imports loot.ts,
 * which imports this, and a module in that cycle can be evaluated before ui.ts
 * has defined its exports (see Module layers in docs/architecture.md).
 */

const PROMPT: Record<ShrineKind, string> = {
  bless: 'Pray at the statue', wrath: 'Take up the blade', search: 'Search the shelves',
};
const BUTTON: Record<ShrineKind, string> = { bless: 'Pray', wrath: 'Take', search: 'Search' };
const FOUND: Partial<Record<ItemKind, string>> = {
  potion: 'a potion', lantern: 'lantern oil', whetstone: 'a whetstone', ward: 'a ward',
};

export const shrinePrompt = (kind: ShrineKind): string => PROMPT[kind];
export const shrineButton = (kind: ShrineKind): string => BUTTON[kind];

function nearest(): Shrine | null {
  let best: Shrine | null = null;
  let bestD: number = SHRINE.reach;
  for (const s of state.shrines) {
    if (s.used) continue;
    const d = Math.hypot(s.x - state.pos.x, s.z - state.pos.z);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Starts using the shrine in reach. Returns it, so the caller can make the noise there. */
export function startShrine(): Shrine | null {
  const s = state.nearShrine;
  if (!s || s.used || state.gameOver || state.drinkT >= 0) return null;
  state.shrineAt = s;
  state.shrineT = 0;
  lootFillEl.style.width = '0%';
  lootBarEl.style.display = 'block';
  showMsg(s.kind === 'search' ? 'Searching the shelves — hold still'
    : s.kind === 'bless' ? 'Praying — hold still' : 'Taking up the blade — hold still');
  return s;
}

/** Counts the blessings down, finds what is in reach, and runs one being used. */
export function updateShrine(dt: number, moving: boolean): void {
  const bless = Math.ceil(state.blessT), wrath = Math.ceil(state.wrathT);
  state.blessT = Math.max(0, state.blessT - dt);
  state.wrathT = Math.max(0, state.wrathT - dt);
  if (bless > 0 && state.blessT <= 0) showMsg('The blessing fades');
  if (wrath > 0 && state.wrathT <= 0) showMsg('The wrath goes out of the blade');
  // Whole seconds only: the HUD is text, and rewriting it every frame buys nothing.
  if (Math.ceil(state.blessT) !== bless || Math.ceil(state.wrathT) !== wrath) updateHUD();

  state.nearShrine = nearest();

  const s = state.shrineAt;
  if (state.shrineT < 0 || !s) return;
  if (moving) {
    cancelShrine(s.kind === 'search' ? 'Search abandoned — you moved' : 'Interrupted — you moved');
    return;
  }
  const time = s.kind === 'search' ? SHRINE.searchTime : SHRINE.prayTime;
  state.shrineT += dt;
  lootFillEl.style.width = Math.min(100, (state.shrineT / time) * 100) + '%';
  if (state.shrineT >= time) complete(s);
}

function complete(s: Shrine): void {
  cancelShrine();
  // Checked again at the end: in co-op an ally may have used it meanwhile.
  if (s.used) {
    showMsg('Someone got there first');
    return;
  }
  s.used = true;
  apply(s, null);
  sfxPickup();
  if (coop.active) sendEvent('shrine', state.shrines.indexOf(s));
}

/** What a shrine does. `by` is the ally who used it, or null for this player. */
function apply(s: Shrine, by: string | null): void {
  if (s.kind === 'bless') {
    state.blessT = BLESS_TIME;
    showMsg(by ? `${by} prayed at the statue — the party is warded` : 'Warded — you take less harm');
  } else if (s.kind === 'wrath') {
    state.wrathT = BLESS_TIME;
    showMsg(by ? `${by} took up the blade — the party's blades strike harder` : 'Wrath — your blade strikes harder');
  } else if (by) {
    showMsg(`${by} searched the shelves`);
  } else {
    const item = SEARCH_ITEMS[Math.floor(Math.random() * SEARCH_ITEMS.length)] ?? 'potion';
    if (item === 'potion') state.potions++;
    else if (item === 'lantern') state.lanterns++;
    else if (item === 'whetstone') state.whetstones++;
    else if (item === 'ward') state.wards++;
    showMsg(`Found ${FOUND[item] ?? item} on the shelves`);
  }
  updateHUD();
}

/** An ally used shrine `i`. A blessing reaches this player too; a search only spends it. */
export function applyShrineEvent(i: number, by: string): void {
  const s = state.shrines[i];
  if (!s) return;
  if (state.shrineAt === s && state.shrineT >= 0) {
    cancelShrine(s.kind === 'search' ? `${by} got there first` : undefined);
  }
  if (s.kind === 'search' && s.used) return;
  s.used = true;
  apply(s, by);
}
