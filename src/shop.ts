import {
  AMMO_PICKUP, HARD_PRICE, lanternMinutes, MAX_HP, POTION_HEAL, SHOP, SHOP_INFLATION, SPAWN_PEAK_STAGE,
  SWORD_DUR_MAX, WHETSTONE_REPAIR,
} from './config';
import { el } from './dom';
import { progress, saveProgress } from './progress';
import type { Outfit } from './types';

/**
 * The outfitting screen between stages.
 *
 * It works on an Outfit — the solo `progress`, or a co-op player's
 * `coop.carry` — and never on `state`: by the time it is on screen the run is
 * over and buildWorld() has not run yet, so the outfit is the only thing that
 * survives to the next dungeon. Buying into `state` would be spending gold on
 * a run that is about to be overwritten.
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
  /** Starts the carried-goods group: drawn with a heavier rule above it. */
  divide?: boolean;
  /** Not stocked in hard mode. */
  soft?: boolean;
}

/**
 * What a base price costs at the stage about to be entered.
 *
 * `target.stage` has already been advanced by bankRun() by the time the shop
 * is on screen, so this is the price of the dungeon ahead rather than the one
 * just left — which is what "deeper is dearer" has to mean to be fair. After a
 * death the stage is back to 1, so re-equipping is at starting prices.
 */
function atStage(base: number): number {
  const stage = Math.min(Math.max(target.stage, 1), SPAWN_PEAK_STAGE);
  return Math.ceil(base * (1 + SHOP_INFLATION * (stage - 1)) * (target.hard ? HARD_PRICE : 1));
}

/**
 * Repair is priced per point restored rather than as a flat fee, so a lightly
 * used sword is cheap to top up and a ruined one is a real bill. It is all or
 * nothing: a partial repair would be another slider for no decision.
 */
const repairCost = (): number =>
  atStage((SWORD_DUR_MAX - target.swordDur) * SHOP.repairPerPoint);

const healCost = (): number => atStage((MAX_HP - target.hp) * SHOP.healPerPoint);


/**
 * Two groups: the things done to you here, once — wounds bound, blade
 * repaired — and then the things carried into the dungeon.
 *
 * It was ordered in pairs (heal next to potion, repair next to whetstone) so
 * the per-point counter price could be read against the carried premium. The
 * pairs read as one list of six though, and a repair sitting between two
 * consumables was taken for one. The split is what matters more: the top two
 * are spent on the spot and cost nothing when there is nothing to fix; the
 * rest stack. `divide` draws the line between them.
 */
const STOCK: Stock[] = [
  {
    id: 'Heal',
    name: 'Bind wounds',
    held: () => `${Math.round(target.hp)}/${MAX_HP} HP`,
    price: () => (target.hp >= MAX_HP ? null : healCost()),
    buy: () => {
      target.hp = MAX_HP;
    },
  },
  {
    id: 'Repair',
    name: 'Repair sword',
    held: () => `${Math.round((target.swordDur / SWORD_DUR_MAX) * 100)}%`,
    price: () => (target.swordDur >= SWORD_DUR_MAX ? null : repairCost()),
    buy: () => {
      target.swordDur = SWORD_DUR_MAX;
    },
  },
  {
    id: 'Potion',
    soft: true,
    name: 'Potion',
    divide: true,
    held: () => `${target.potions} held  ·  +${POTION_HEAL} HP`,
    price: () => atStage(SHOP.potion),
    buy: () => {
      target.potions++;
    },
  },
  {
    id: 'Whetstone',
    soft: true,
    name: 'Whetstone',
    held: () => `${target.whetstones} held  ·  +${WHETSTONE_REPAIR}%`,
    price: () => atStage(SHOP.whetstone),
    buy: () => {
      target.whetstones++;
    },
  },
  {
    id: 'Lantern',
    soft: true,
    name: 'Lantern oil',
    held: () => `${target.lanterns} held  ·  ${lanternMinutes()} min`,
    price: () => atStage(SHOP.lantern),
    buy: () => {
      target.lanterns++;
    },
  },
  {
    id: 'Ward',
    name: 'Ward',
    soft: true,
    held: () => `${target.wards} held`,
    price: () => atStage(SHOP.ward),
    buy: () => {
      target.wards++;
    },
  },
  {
    id: 'Ammo',
    name: 'Musket balls',
    held: () => `${target.ammo} held  ·  +${AMMO_PICKUP}`,
    price: () => atStage(SHOP.ammo),
    buy: () => {
      target.ammo += AMMO_PICKUP;
    },
  },
];

/** Built once; only the text and the disabled state change per open. */
const rows = STOCK.map((item) => {
  const row = document.createElement('div');
  row.className = item.divide ? 'shopRow divide' : 'shopRow';
  const name = document.createElement('span');
  name.className = 'shopName';
  name.textContent = item.name;
  const held = document.createElement('span');
  held.className = 'shopHeld';
  const btn = document.createElement('button');
  btn.className = 'shopBuy';
  btn.addEventListener('click', () => {
    const price = item.price();
    if (price === null || price > target.bankGold) return;
    target.bankGold -= price;
    item.buy();
    persist();
    render();
  });
  row.append(name, held, btn);
  shopEl.append(row);
  return { item, held, btn, row };
});

/**
 * Just the price, on every row.
 *
 * Ammo used to carry its batch size here as "×3 · 45 G", which made it the one
 * button that was not a single clean figure and left the column looking ragged
 * next to "60 G" and "90 G". The batch size is a property of what you are
 * buying, not of the price, so it sits with the rest of that — beside "+35 HP"
 * and "2.5 min" in the held column.
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
  const solo = target === progress;
  headEl.textContent = `Outfitting · ${solo ? 'Stage' : 'Level'} ${target.stage}`;
  bankEl.textContent = `${target.bankGold} G`;
  // Co-op's summary line is the party total, which the host keeps; this
  // player's purse is the shop's own figure above.
  if (solo) summaryBankEl.textContent = `Bank balance: ${target.bankGold} G`;
  for (const { item, held, btn, row } of rows) {
    // Hard mode's shop is wounds, blade and musket balls. The rest are not
    // greyed out but gone: a row that can never be bought is not information.
    row.style.display = target.hard && item.soft ? 'none' : 'flex';
    // The rule between services and stock moves to the first row still stocked.
    row.classList.toggle('divide', !!item.divide || (target.hard && item.id === 'Ammo'));
    const price = item.price();
    held.textContent = item.held();
    btn.textContent = label(price);
    // Disabled rather than hidden: a price you cannot afford yet is information.
    btn.disabled = price === null || price > target.bankGold;
  }
}

/** What the shop is selling into, and how a purchase is kept. */
let target: Outfit = progress;
let persist: () => void = saveProgress;

/**
 * Opens on the solo save by default. Co-op hands in the player's carry and a
 * no-op save: the carry lives in memory for as long as the party does.
 */
export function openShop(outfit: Outfit = progress, save: () => void = saveProgress): void {
  target = outfit;
  persist = save;
  render();
  shopEl.style.display = 'block';
}

export function closeShop(): void {
  shopEl.style.display = 'none';
}
