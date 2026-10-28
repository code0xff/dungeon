import { CHAPTERS } from './config';
import type { CreatureKey } from './types';

// The words of the descent: the chapters' names and openings, the journal a
// lay brother left on the way down, and what is said when a guardian falls.
//
// Kept apart from config.ts because none of it is a number to tune, and apart
// from the modules that show it so the story reads in one place, top to
// bottom. Nothing here imports anything with side effects: menu.ts, world.ts
// and the journal all read it, and it must stay a leaf of the module graph.

export interface Chapter {
  /** Roman numeral, for the card's heading. */
  numeral: string;
  title: string;
  /** Shown on the card on the chapter's first stage, under the heading. */
  opening: string;
}

export const CHAPTER_TEXT: readonly Chapter[] = [
  {
    numeral: 'I', title: 'The Ossuary',
    opening: 'Beneath the abbey the brothers stacked their dead. The dead did not stay stacked.',
  },
  {
    numeral: 'II', title: 'The Sunken Cloister',
    opening: 'Below the bones, the old cloister: flooded once, drained by no one. Something keeps its sickness warm.',
  },
  {
    numeral: 'III', title: 'The Bone Throne',
    opening: 'At the bottom the abbot built his answer to the plague out of everyone it took.',
  },
];

/** The chapter a stage belongs to, or null below the last one. */
export function chapterOf(stage: number): { index: number; first: boolean; text: Chapter } | null {
  const i = CHAPTERS.findIndex((c) => stage >= c.from && stage <= c.to);
  if (i < 0) return null;
  return { index: i, first: stage === CHAPTERS[i].from, text: CHAPTER_TEXT[i] };
}

/**
 * The journal of Brother Aldric, who went down before you. One page per stage
 * that is not a guardian's, keyed by the stage it lies on — the order he wrote
 * them in is the order the player walks into them.
 */
export const JOURNAL: readonly { stage: number; title: string; text: string }[] = [
  {
    stage: 1, title: 'The first page',
    text: 'The abbot has sealed the stair and says the plague is ended. If it is ended, why does he post a guard on a door that only opens downward? I am taking a lamp and going to look.',
  },
  {
    stage: 2, title: 'On counting',
    text: 'I counted the niches in the first gallery: four hundred and twelve. I counted the bones in them. There were not enough bones for four hundred and twelve.',
  },
  {
    stage: 3, title: 'The levers',
    text: 'The masons who dug this place sealed every way down with iron and hung the means of opening it in the far corners, so that no one could flee in a hurry. Whoever comes after me: they are loud. Pull them knowing that.',
  },
  {
    stage: 4, title: 'The warden',
    text: 'There is a gaoler on the stair below — not a brother, not a man. The abbot feeds it. I watched him go down with a lantern and a sack and come back with only the lantern.',
  },
  {
    stage: 6, title: 'Water',
    text: 'The cloister was drowned in the year of the flood and never drained, they told us. It is dry. Someone drained it, and carried the water up a stair I have not found.',
  },
  {
    stage: 7, title: 'The sick ones',
    text: 'Some of them are swollen with it still. They burst when they fall, like a wineskin left in the sun. I have learned to strike and then step back. I have learned it twice.',
  },
  {
    stage: 8, title: 'A confession',
    text: 'I found the infirmary ledger. The abbot did not lose the sick to the plague. He brought them down here alive, all of them, and wrote beside each name: "kept".',
  },
  {
    stage: 9, title: 'The champion',
    text: 'Sir Hollin swore to defend the abbey with his life, and the abbot has held him to it past the end of his life. He stands at the next stair in black iron and does not know that he is dead.',
  },
  {
    stage: 11, title: 'Bone on bone',
    text: 'Down here the bones are not stacked. They are fitted. Someone has been building with them — joint into joint, as a mason lays stone.',
  },
  {
    stage: 12, title: 'What the abbot wanted',
    text: 'He believed the plague could be bargained with: give it a body big enough and it would stop taking ours. I have seen the body. It is very nearly finished.',
  },
  {
    stage: 13, title: 'The lamp',
    text: 'My oil is low. If you find this you have come further than any of them meant anyone to. Keep your light lit. The things down here are slower in it, or I am braver.',
  },
  {
    stage: 14, title: 'The last page',
    text: 'It wakes. I can hear it shifting below, like a cart of stones turning over. I will go down and finish what the abbot started — or end it. If there is a next page, I will have written it.',
  },
];

/** The journal entry lying on a stage, or -1 when there is none. */
export function pageFor(stage: number): number {
  return JOURNAL.findIndex((p) => p.stage === stage);
}

/** Said when a guardian falls, after the key line. Keyed by its creature. */
export const GUARDIAN_EPITAPH: Readonly<Partial<Record<CreatureKey, string>>> = {
  orc: 'The gaoler of the stair is dead. Below, the air turns wet.',
  blackknight: 'Sir Hollin kneels at last. His oath is kept.',
  colossus: 'The colossus comes apart into the dead it was made of. The plague has nowhere left to live.',
};
