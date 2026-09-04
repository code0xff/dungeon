import {
  AMMO_PICKUP, LANTERN_FUEL, MAX_HP, POTION_HEAL, SHOP, SHOP_INFLATION, SPAWN_PEAK_STAGE,
  SWORD_DUR_MAX, WHETSTONE_REPAIR,
} from './config';
import { el } from './dom';
import { progress, saveProgress } from './progress';

/**
 * The outfitting screen between stages.
 *
 * It works on `progress`, never on `state`: by the time it is on screen the run
 * is over and buildWorld() has not run yet, so `progress` is the only thing that
 * survives to the next dungeon. Buying into `state` would be spending gold on a
 * run that is about to be overwritten.
 *
 * It opens after death too. That is deliberate — the bank is the one thing death
 * does not take, and being able to kit out a fresh stage 1 with it is what makes
 * banking gold a decision rather than a score.
 */
const shopEl = el('shop');
const headEl = el('shopHead');
const bankEl = el('shopBank');
/**
 * The end-of-run summary shows the bank too, a few lines above. It used to be
 * written once by endRun() and never again, so every purchase moved the shop's
 * figure and left that one behind — a screen reading "Bank balance: 1677 G" over
 * a shop saying "27 G", which makes the whole panel look wrong rather than stale.
 * One number shown twice has to be updated in both places.
 */
const summaryBankEl = el('ovBank');

interface Stock {
  id: string;
  name: string;
  /** What the player has now, shown next to the name. */
  held: () => string;
  /** Gold for one purchase, or null when there is nothing to buy. */
  price: () => number | null;
  buy: () => void;
}

/**
 * What a base price costs at the stage about to be entered.
 *
 * `progress.stage` has already been advanced by bankRun() by the time the shop
 * is on screen, so this is the price of the dungeon ahead rather than the one
 * just left — which is what "deeper is dearer" has to mean to be fair. After a
 * death the stage is back to 1, so re-equipping is at starting prices.
 */
function atStage(base: number): number {
  const stage = Math.min(Math.max(progress.stage, 1), SPAWN_PEAK_STAGE);
  return Math.ceil(base * (1 + SHOP_INFLATION * (stage - 1)));
}

/**
 * Repair is priced per point restored rather than as a flat fee, so a lightly
 * used sword is cheap to top up and a ruined one is a real bill. It is all or
 * nothing: a partial repair would be another slider for no decision.
 */
const repairCost = (): number =>
  atStage((SWORD_DUR_MAX - progress.swordDur) * SHOP.repairPerPoint);

const healCost = (): number => atStage((MAX_HP - progress.hp) * SHOP.healPerPoint);

/**
 * Ordered in pairs: the thing that fixes you here, then the thing that carries
 * the same fix into the dungeon. Health, then blade, then the rest.
 *
 * The pairing is the point. Both counter rows are priced per point and both
 * carried ones cost a premium over the same restoration, and putting them on
 * adjacent lines is the only way a player can see that rather than be told it.
 */
const STOCK: Stock[] = [
  {
    id: 'Heal',
    name: 'Bind wounds',
    held: () => `${Math.round(progress.hp)}/${MAX_HP} HP`,
    price: () => (progress.hp >= MAX_HP ? null : healCost()),
    buy: () => {
      progress.hp = MAX_HP;
    },
  },
  {
    id: 'Potion',
    name: 'Potion',
    held: () => `${progress.potions} held  ·  +${POTION_HEAL} HP`,
    price: () => atStage(SHOP.potion),
    buy: () => {
      progress.potions++;
    },
  },
  {
    id: 'Repair',
    name: 'Repair sword',
    held: () => `${Math.round((progress.swordDur / SWORD_DUR_MAX) * 100)}%`,
    price: () => (progress.swordDur >= SWORD_DUR_MAX ? null : repairCost()),
    buy: () => {
      progress.swordDur = SWORD_DUR_MAX;
    },
  },
  {
    id: 'Whetstone',
    name: 'Whetstone',
    held: () => `${progress.whetstones} held  ·  +${WHETSTONE_REPAIR}%`,
    price: () => atStage(SHOP.whetstone),
    buy: () => {
      progress.whetstones++;
    },
  },
  {
    id: 'Lantern',
    name: 'Lantern oil',
    held: () => `${progress.lanterns} held  ·  ${Math.round(LANTERN_FUEL / 60)} min`,
    price: () => atStage(SHOP.lantern),
    buy: () => {
      progress.lanterns++;
    },
  },
  {
    id: 'Ammo',
    name: 'Musket balls',
    held: () => `${progress.ammo} held  ·  +${AMMO_PICKUP}`,
    price: () => atStage(SHOP.ammo),
    buy: () => {
      progress.ammo += AMMO_PICKUP;
    },
  },
];

/** Built once; only the text and the disabled state change per open. */
const rows = STOCK.map((item) => {
  const row = document.createElement('div');
  row.className = 'shopRow';
  const name = document.createElement('span');
  name.className = 'shopName';
  name.textContent = item.name;
  const held = document.createElement('span');
  held.className = 'shopHeld';
  const btn = document.createElement('button');
  btn.className = 'shopBuy';
  btn.addEventListener('click', () => {
    const price = item.price();
    if (price === null || price > progress.bankGold) return;
    progress.bankGold -= price;
    item.buy();
    saveProgress();
    render();
  });
  row.append(name, held, btn);
  shopEl.append(row);
  return { item, held, btn };
});

/**
 * Just the price, on every row.
 *
 * Ammo used to carry its batch size here as "×3 · 45 G", which made it the one
 * button that was not a single clean figure and left the column looking ragged
 * next to "60 G" and "90 G". The batch size is a property of what you are
 * buying, not of the price, so it sits with the rest of that — beside "+35 HP"
 * and "3 min" in the held column.
 *
 * The word "Buy" is gone for a related reason: the row already names the item
 * and the button already looks like a button, so it only made the widest label
 * wider — and a flex item is min-width:auto, so an over-long nowrap label pushes
 * past its width and knocks the column out of alignment.
 */
function label(price: number | null): string {
  return price === null ? 'Full' : `${price} G`;
}

export function render(): void {
  // The stage is on the header because the prices move with it, and a number
  // that changes with no visible cause reads as a bug.
  headEl.textContent = `Outfitting · Stage ${progress.stage}`;
  bankEl.textContent = `${progress.bankGold} G`;
  summaryBankEl.textContent = `Bank balance: ${progress.bankGold} G`;
  for (const { item, held, btn } of rows) {
    const price = item.price();
    held.textContent = item.held();
    btn.textContent = label(price);
    // Disabled rather than hidden: a price you cannot afford yet is information.
    btn.disabled = price === null || price > progress.bankGold;
  }
}

export function openShop(): void {
  render();
  shopEl.style.display = 'block';
}

export function closeShop(): void {
  shopEl.style.display = 'none';
}
