import { STAGE_GOALS } from './config';
import { state } from './state';
import type { GoalKind } from './types';
import { goalEl, showMsg, updateHUD } from './ui';

// The optional goal on each stage's card: kill so many, open so many chests,
// or use every landmark room. Met, it pays on top of the run — gold that is
// lost with the run like the rest of it, so it is a reason to stay down
// longer, not a reward for having been there.
//
// Counted on each player's own machine from their own deeds — their kills,
// their chests, their prayers. In a party that makes it a goal per player,
// which is what a line on a card that every player reads alone can promise.
//
// Nothing at the top level reads an imported binding: combat.ts and loot.ts
// import this, and both sit in ui.ts's import cycle.

const LABEL: Record<GoalKind, (need: number) => string> = {
  slay: (n) => `slay ${n} creatures`,
  loot: (n) => `open ${n} chests`,
  shrines: (n) => `use all ${n} of the rooms' shrines`,
};

/**
 * Sets the stage's goal, after the dungeon is built: the chest and shrine
 * counts are what the goal is checked against. `hard` drops the goals that
 * hard mode cannot offer — it has one chest and no shelves.
 */
export function setupGoal(stage: number, hard: boolean): void {
  let kind: GoalKind = STAGE_GOALS.order[(stage - 1) % STAGE_GOALS.order.length];
  if (hard || (kind === 'shrines' && state.shrines.length < 2)) kind = 'slay';
  const grow = (g: { base: number; perStage: number }): number => Math.round(g.base + g.perStage * (stage - 1));
  const need = kind === 'slay'
    // Never more than live in the dungeon: past the spawn peak the count keeps
    // growing and the dungeon does not.
    ? Math.min(grow(STAGE_GOALS.slay), Math.floor(state.monsters.length * 0.6))
    : kind === 'loot'
      ? Math.min(grow(STAGE_GOALS.loot), state.chests.length)
      : state.shrines.length;
  state.goal = { kind, need, have: 0, gold: STAGE_GOALS.goldPerStage * stage, done: false };
  showGoal();
}

/** The card's line for it, as markup — our own words and numbers only. */
export function goalCardLine(): string {
  const g = state.goal;
  if (!g) return '';
  return `<br>Bonus: ${LABEL[g.kind](g.need)} for <span class="item">${g.gold} G</span>`;
}

/** One more toward the goal, if it is this kind. */
export function countGoal(kind: GoalKind): void {
  const g = state.goal;
  if (!g || g.done || g.kind !== kind || state.gameOver) return;
  g.have++;
  if (g.have >= g.need) {
    g.done = true;
    state.runGold += g.gold;
    // Gold first: showMsg() gives a leading +line the accent.
    showMsg(`+${g.gold} G\nBonus met — ${LABEL[g.kind](g.need)}`);
    updateHUD();
  }
  showGoal();
}

function showGoal(): void {
  const g = state.goal;
  goalEl.classList.toggle('done', !!g?.done);
  goalEl.textContent = !g ? '' : g.done
    ? `Bonus met · +${g.gold} G`
    : `Bonus: ${LABEL[g.kind](g.need)} · ${g.have}/${g.need}`;
}

/** No goal: the tutorial, which has no stage. */
export function clearGoal(): void {
  state.goal = null;
  showGoal();
}
