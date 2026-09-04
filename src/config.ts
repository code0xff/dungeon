import type {
  CreatureAsset, CreatureKey, CreatureType, ItemKind, SpawnRate, WeaponAsset, WeaponKind,
} from './types';

// ================= Asset configuration =================
// publicDir='assets' in vite.config.ts is why none of these paths carry an 'assets/' prefix.
// On disk: assets/creatures/zombie/idle.fbx (model + idle clip), walk.fbx, attack.fbx,
//          death.fbx (glb/gltf work too), assets/textures/wall/{diffuse,normal,rough}.webp,
//          assets/textures/floor/...
// Anything missing falls back to the models and textures built in code.
export const CREATURE_ASSETS: Record<CreatureKey, CreatureAsset> = {
  zombie: { dir: 'creatures/zombie', height: 1.85 },
  // PumpkinHulk. Its idle carries the body; walk, attack and death are
  // motion-only downloads off a differently numbered rig, and bind only because
  // the loader normalises the Mixamo namespace — see MIXAMO_NS in assets.ts.
  brute: { dir: 'creatures/brute', height: 2.35 },
  // WhiteClown. Its walk slot holds a sprint, not a walk — see TYPES.lunatic.
  lunatic: { dir: 'creatures/lunatic', height: 1.78 },
};
export const WALL_TEX_DIR = 'textures/wall';
export const FLOOR_TEX_DIR = 'textures/floor';
export const CLIP_NAMES = ['idle', 'walk', 'attack', 'death'] as const;

/**
 * Prop models. Without them the primitives in src/props.ts are used.
 *
 * `lidNode` names the node the open animation turns. Poly Haven's treasure_chest
 * already has its lid as a separate node hinged at the back, which is the same
 * convention the primitive chest uses, so it needs no rework.
 */
export const PROP_ASSETS = {
  chest: { url: 'props/chest.glb', height: 0.62, lidNode: 'treasure_chest_lid' },
  /** Held in the left hand. Without the file nothing is drawn — see loadLantern(). */
  lantern: { url: 'props/lantern.glb', height: 0.29 },
} as const;

/**
 * First-person weapon models. Without them the primitives in src/scene.ts are used.
 * `npm run fetch-assets` pulls these from Poly Haven (CC0).
 *
 * Every model has its own origin and axes, so the loader fits it to the hand in order:
 *   1. apply rot so the long axis points down -Z, in front of the camera
 *   2. scale uniformly until the total z length equals `length`
 *   3. translate so the rear end (buttstock or pommel) lands at z=back, which puts
 *      the grip near the origin
 * The muzzle is read off the normalised bounds, so it needs no entry here.
 */
export const WEAPON_ASSETS: Record<WeaponKind, WeaponAsset> = {
  // wooden_handle_saber: tip along +Y, grip near the origin
  sword: { url: 'weapons/sword.glb', rot: [-Math.PI / 2, 0, 0], length: 1.05, back: 0.14 },
  // bolt_action_rifle_7_62: muzzle along +X
  musket: { url: 'weapons/musket.glb', rot: [0, Math.PI / 2, 0], length: 1.3, back: 0.3 },
};

// ================= Tuning =================
/**
 * Maze cells per side. GRID is the actual grid, walls included, so the dungeon is
 * GRID * CELL metres square — at 15 that is a 31x31 grid and 124m a side, about
 * 490 floor cells.
 *
 * Everything placed per run scales off this: SPAWN and CHEST_COUNT are set to
 * hold the density steady, and ROOM_COUNT to keep the same ratio of open rooms
 * to corridor. Change this and check all three, or a bigger dungeon just means a
 * longer walk between the same amount of content.
 */
export const MAZE_CELLS = 15;
export const GRID = MAZE_CELLS * 2 + 1;
/** Open rooms stamped over the corridors, so it is not corridors end to end. */
export const ROOM_COUNT = 11;
export const CELL = 4;
export const WALL_H = 3.4;
export const PLAYER_R = 0.45;
export const SPEED = 5.2;
// ---- Dodge ----
/**
 * The dodge is a short burst along whatever direction the player is already
 * holding, not a separate set of direction keys. That is the whole reason it
 * does not cost anything to control: one key, and it goes where you were going.
 *
 * It is a velocity for DASH_TIME rather than a teleport, so it still runs
 * through the same per-axis wall checks as walking and cannot slip through a
 * corner.
 */
export const DASH_SPEED = 22;
/**
 * Seconds the burst lasts.
 *
 * Distance is not SPEED * TIME: the burst eases out on 1-(t/T)^2, whose integral
 * is 2T/3, so these two give 3.8m. That number is chosen against creature reach,
 * which tops out at the brute's 2.2m — a dodge has to clear the reach of the
 * thing swinging at you or it dodges nothing. The first pass covered 1.67m and
 * was useless for exactly that reason.
 */
export const DASH_TIME = 0.26;
/**
 * Seconds before it can be used again.
 *
 * The dodge has no invulnerability — it works by taking the player out of a
 * creature's reach before the blow lands, which is honest and needs no timing
 * minigame. That means the cooldown is the only thing stopping it from being
 * plain faster movement. At 1.1s, spamming it averages 3.5m/s against a walk of
 * SPEED 5.2, so it is a burst and never a way to travel.
 */
export const DASH_CD = 1.1;
/** Camera roll at the peak of a sideways dodge, in radians. Sells the weight. */
export const DASH_ROLL = 0.09;

export const CHEST_COUNT = 14;
/**
 * What the chests hold, one entry per chest that is not empty, shuffled across
 * CHEST_COUNT of them.
 *
 * The key is what makes this list the run rather than a bonus: without it the
 * portal will not open, so the dungeon has to be searched instead of crossed.
 * Exactly one is placed. The map is worth far more now that it marks where the
 * unopened chests are.
 */
export const CHEST_ITEMS: readonly ItemKind[] = [
  'key', 'lantern', 'map', 'ammo', 'ammo', 'potion', 'potion',
];

/**
 * Number keys for the consumable slots. 1 and 2 are the weapons, so the pack
 * starts at 3. These are the labels shown in the HUD and in pickup messages too,
 * so the binding and what the player is told can never drift apart.
 */
export const POTION_KEY = '3';
export const LANTERN_KEY = '4';

export const MAX_HP = 100;
/** Health one potion restores. */
export const POTION_HEAL = 35;
/**
 * How far the lid swings open, in radians. Negative tips the front up.
 * Past about -1.6 the lid clears vertical and looks detached rather than open.
 */
export const CHEST_LID_OPEN = -1.5;
export const ATTACK_RANGE = 2.3;
export const ATTACK_CD = 0.45;

// ---- Sword durability ----
/** Full durability, in points. 100 so the HUD can read it as a percentage. */
export const SWORD_DUR_MAX = 100;
/**
 * Durability lost per creature actually cut — swinging at air costs nothing.
 *
 * At 0.45 a sword lasts about 220 hits, and killing everything on a mid stage
 * takes roughly 250, so one thorough run wears one out. That is the intent: the
 * repair bill is what banked gold is *for*, and it has to recur or the bank goes
 * back to being a scoreboard.
 *
 * It is charged per creature hit, not per swing, so a cleave that catches two
 * costs two. Wide swings should not be free.
 */
export const SWORD_WEAR = 0.45;
/**
 * Damage at zero durability, as a fraction of a fresh sword's.
 *
 * Not zero on purpose. A weapon that stops working strands a player with no way
 * to fight back to the exit, which is a dead end rather than a difficulty. At
 * 0.45 a blunt sword takes 9 swings to kill a zombie instead of 4 — punishing,
 * still a weapon.
 */
export const SWORD_DMG_WORN = 0.45;
/** Durability at which the player is warned once per run. */
export const SWORD_WARN_AT = 25;
/**
 * Half-width of the sword's arc, as the cosine of the angle from where the
 * player is looking. 0.62 is about 103 degrees of total sweep.
 *
 * It was 0.35 — 139 degrees — which with no cap on targets made the sword a
 * lawnmower: every creature in front died at the same rate whether there was one
 * or fifteen, so a horde was never worse than a single zombie.
 */
export const SWORD_ARC = 0.62;
/**
 * How many creatures one swing can cut. This is what makes numbers matter: past
 * two, the rest of the crowd is still coming while the blade is busy, and the
 * answer to being surrounded becomes the corridor behind you rather than
 * standing still and sweeping.
 */
export const SWORD_CLEAVE = 2;

// ---- Sword swing ----
// The blade is raised, then brought down. One cycle takes 1/SWING_SPEED seconds.
/** Higher is faster. One cycle is 0.33s — it must stay under ATTACK_CD (0.45s) or the motion is cut off. */
export const SWING_SPEED = 3.0;
/** Fraction of the cycle spent raising the blade. 0.11s. */
export const SWING_WINDUP = 0.33;
/**
 * Point in the cycle (0..1) where the blade lands. Damage resolves here.
 * Same idea as ATTACK_IMPACT on the zombie side, but this one answers to player
 * input, so a late hit feels sluggish — it is set much earlier, about 0.2s.
 *
 * The stretch from SWING_WINDUP to here is the downswing itself. It needs to be
 * about five frames at 60fps for the blade to read as passing through. Do not
 * crowd it up against WINDUP.
 */
export const SWING_IMPACT = 0.6;
export const LOOT_TIME = 1.2;
/** How close the player must be to the portal to use it, in metres. */
export const PORTAL_RADIUS = 1.6;
export const FOG_BASE = 0.115;
export const FOG_TORCH = 0.08;

// ---- Lantern ----
/**
 * Seconds a lantern burns for. It is the only way to see far, so this is the
 * real clock on a run: about two and a half minutes of good light per pickup,
 * and the remainder carries into the next stage.
 */
export const LANTERN_FUEL = 150;
/** Fuel left when the player is warned, in seconds. */
export const LANTERN_WARN = 30;

/**
 * How far the carried lantern swings, in radians, and how fast.
 *
 * A lantern that hangs rigid is the tell that nothing is holding it — the eye
 * reads a swinging weight long before it notices there is no hand. The swing
 * lags the stride rather than matching it: the arm leads, the lantern follows,
 * which is what LAMP_SWAY_LAG is for.
 *
 * Keep the amplitude small. Past about 0.12 it stops looking carried and starts
 * looking thrown.
 */
export const LAMP_SWAY = 0.075;
/** Stride rate in cycles per second — what both the lantern and the weapons move to. */
export const STRIDE_RATE = 3.4;
/** Radians the swing trails the stride by. */
export const LAMP_SWAY_LAG = 0.9;
/**
 * How fast held gear starts moving and settles again, in units per second —
 * 0.38s either way. Both directions on purpose: motion that appears the instant
 * a key goes down is as wrong as motion that stops dead when it comes up.
 */
export const SWAY_DAMP = 2.6;

/**
 * How far the held weapons travel with the stride, in metres, and how far they
 * roll, in radians.
 *
 * Much smaller than the lantern's swing, and for a different reason: a weapon is
 * gripped, not hung, so it moves with the body rather than swinging from it. It
 * also sits close to the camera, where a centimetre reads as a lot. The vertical
 * term runs at twice the rate because both feet land per cycle.
 */
export const GEAR_BOB = 0.013;
export const GEAR_BOB_ROLL = 0.014;

/** The player's light, unlit and lit. Fog closes in when the lantern dies. */
export const LIGHT_DIM = { distance: 11, intensity: 1.75, fog: FOG_BASE } as const;
export const LIGHT_LIT = { distance: 19, intensity: 2.7, fog: FOG_TORCH } as const;

/** Eye height in metres. Walking bobs the camera around this. */
export const EYE_H = 1.55;

// ---- Musket ----
/** Kept at or above the light creatures' hp, so a ball is always a kill on one. */
export const MUSKET_DMG = 4;
export const MUSKET_RELOAD = 3.0;

// ---- Ammo ----
/** Spare rounds at the start. One chambered round is added on top, so a run opens with START_AMMO+1 shots. */
export const START_AMMO = 6;
/** Rounds granted by one ammo pickup. */
export const AMMO_PICKUP = 3;
/** Rounds that come with the musket pickup. */
export const MUSKET_AMMO = 5;
export const MUSKET_RANGE = 26;
export const SHOT_ALERT_RADIUS = 20;
/** Seconds a creature hunts the player after hearing a shot. */
export const SHOT_ALERT_TIME = 10;
/**
 * How far a chest lid carries, in metres, and for how long.
 *
 * Much shorter than a musket — a creak is not a bang — but not silent, because
 * looting should cost something. Standing still for LOOT_TIME in the open is now
 * a decision rather than free gold, and it is the reason to clear a room before
 * opening what is in it.
 */
export const CHEST_ALERT_RADIUS = 9;
export const CHEST_ALERT_TIME = 6;

// ================= Shop =================
/**
 * Prices, in gold, for the outfitting screen between stages.
 *
 * These are what finally give `bankGold` a use — before the shop it was a score
 * with no sink, so there was no reason to extract rather than push on until
 * something killed you.
 *
 * Set against income: a stage killed clean is worth roughly 900G in creatures
 * plus 700G in chests, and most runs bank a fraction of that. A full repair plus
 * a potion and a lantern is about 350G, so a careful run funds the next one and
 * a greedy one funds two.
 */
/**
 * How much dearer everything gets per stage, as a fraction of the base price.
 *
 * Deeper stages pay more for the same repair. It is set below the rate income
 * grows at — creature gold roughly triples by the peak while prices rise 2.6x —
 * so progress still feels like progress; it just stops being free.
 *
 * It flattens at SPAWN_PEAK_STAGE for the same reason the spawns do: income
 * stops growing there, so prices that kept climbing would eventually outrun any
 * possible run.
 */
export const SHOP_INFLATION = 0.15;

export const SHOP = {
  /** Per point of durability restored, so a barely-nicked sword is cheap. */
  repairPerPoint: 2,
  potion: 60,
  /** One lantern's worth of oil — LANTERN_FUEL seconds. */
  lantern: 90,
  /** Price of one batch, which is AMMO_PICKUP rounds. */
  ammo: 45,
} as const;

// ================= Creatures =================
/**
 * Creature stats.
 *
 * `hp` is in damage points, where a **pristine** sword does exactly 1 and a
 * musket ball does MUSKET_DMG. In play a sword is never pristine for long: it
 * dulls as it cuts, so a 4hp zombie takes 5 swings from a fresh blade and 9 from
 * a blunt one. Read hp as "roughly this many swings, more as the edge goes".
 */
export const TYPES: Record<CreatureKey, CreatureType> = {
  zombie: {
    name: 'Zombie',
    hp: 4, dmg: 17, speed: 2.9, atkCd: 0.8, attackSpeed: 1.6,
    reach: 1.7, r: 0.45, clearance: 1.15, reward: 12, aggro: 13,
    groan: [4, 8], voice: 1,
    animSpeed: 6.5, swing: 0.5,
  },
  /**
   * The heavy. Twice the sword hits and twice the damage of a zombie, but slow
   * enough to back away from — the answer to a brute is the corridor behind you,
   * or the musket, and neither works if it can keep pace.
   *
   * hp 9 is ten swings from a fresh blade — over four seconds of standing still
   * while it hits back for 32 every two — or three musket balls. Trading with
   * one is meant to be a bad idea; the answer is the corridor, or shooting it
   * before it arrives.
   */
  brute: {
    name: 'Brute',
    hp: 9, dmg: 32, speed: 2.0, atkCd: 1.6, attackSpeed: 2.3,
    reach: 2.2, r: 0.62, clearance: 1.6, reward: 55, aggro: 13,
    groan: [6, 11], voice: 0.55,
    animSpeed: 4.2, swing: 0.42,
  },
  /**
   * The sprinter. Everything about it is built around its speed against the
   * player's SPEED of 5.2 — fast enough that walking away does not work and
   * running away barely does, slow enough that the corridor behind you is still
   * an answer.
   *
   * The ceiling is not 5.2 but 5.2 / the top of SPEED_VARIANCE, which is 4.52.
   * Above that the fastest individuals outrun the player outright and there is no
   * disengaging from them at all. 4.5 sits just under it on purpose.
   *
   * It pays for that in hp 3: four swings from a fresh blade, or one musket
   * ball. Meeting one should be a scramble that is over quickly either way,
   * not a fight.
   *
   * aggro 14 is the highest of the three and is the real weapon — it notices the
   * player from beyond the reach of the lantern, so the first warning is the
   * sound of one already coming.
   */
  lunatic: {
    name: 'Lunatic',
    hp: 3, dmg: 14, speed: 4.5, atkCd: 0.7, attackSpeed: 3.6,
    reach: 1.6, r: 0.4, clearance: 1.15, reward: 30, aggro: 18,
    groan: [3, 6], voice: 1.6,
    animSpeed: 11, swing: 0.7,
  },
};

/**
 * How many of each creature spawn, as stage 1's count plus a per-stage increase.
 *
 * This is what makes the stage number mean something rather than being a label
 * on an identical dungeon. Stage 1 is deliberately thin — 40 creatures across
 * 510 floor cells, about one per 13, sparse enough to learn the game in — and it
 * fills up from there to about one per 4.5 at the peak.
 *
 * **The mix shifts, not just the count.** Brutes and lunatics grow faster than
 * zombies in proportion, so a late stage is not the early one with more of the
 * same: stage 1 is 65% zombies, the peak is 56%. That matters more than the
 * headcount, because the thing that kills you changes.
 *
 * Density, not headcount, is what is actually being tuned here — one creature
 * per few floor cells is what makes backing away from one back you into another.
 * Scale these with MAZE_CELLS or a bigger dungeon just means a longer walk.
 */
export const SPAWN: Readonly<Record<CreatureKey, SpawnRate>> = {
  zombie: { base: 26, perStage: 3.4 },
  brute: { base: 6, perStage: 1.5 },
  lunatic: { base: 8, perStage: 1.9 },
};
/**
 * Stage at which the counts stop growing.
 *
 * Something has to cap it or stage 40 is a solid wall of bodies — unplayable
 * long before it is slow. 12 lands at roughly one creature per 4.5 floor cells,
 * which is about as thick as a 4m corridor can carry and still be a dungeon
 * rather than a queue.
 */
export const SPAWN_PEAK_STAGE = 12;

// ---- Creature animation ----
/** Attack duration in seconds when the external model carries no attack clip. */
export const FALLBACK_ATTACK_TIME = 0.9;
/** Where in the attack clip the hit resolves (0 = start, 1 = end) — as the arm comes down. */
export const ATTACK_IMPACT = 0.45;
/**
 * At impact the player must be within reach times this.
 *
 * The whole attack is a windup the player can walk out of, and at 1.3 against a
 * player who moves at SPEED that was nearly free. 1.5 still rewards backing off
 * early; it just stops a late step from cancelling a hit that already landed.
 */
export const ATTACK_IMPACT_REACH = 1.5;
/**
 * Fallback ground speed of the walk clip, in m/s.
 *
 * Only used when the clip is genuinely in place and its authored speed cannot be
 * measured. Any clip with root motion is measured instead — see
 * CreatureTemplate.walkClipSpeed.
 */
export const WALK_CLIP_SPEED = 1.45;
/** Allowed range for the walk clip's timeScale, clamped so it never crawls or blurs. */
export const WALK_TIMESCALE_RANGE: readonly [number, number] = [0.5, 1.9];
/**
 * How fast a creature's measured ground speed follows the truth, in units per
 * second — about a 0.12s lag.
 *
 * The walk clip is retimed from what the creature *achieved*, not what it
 * intended, because collision is per axis: with one axis blocked it slides along
 * the wall at a fraction of its speed while the legs still run at full. The
 * brute shows this most — 14.8% of its walking frames have an axis blocked
 * against the zombie's 1.5%, because its 1.6m clearance puts it against walls far
 * more often — and it reads as marching on the spot.
 *
 * Smoothed rather than used raw so a single blocked frame does not stutter the
 * legs.
 */
export const GROUND_SPEED_SMOOTH = 8;
/**
 * Beyond this many metres a creature is not drawn, in metres.
 *
 * Creature meshes run with frustumCulled off, because a skinned mesh's bounds
 * are the bind pose and three culls them wrongly — so without this every
 * creature in the dungeon is drawn every frame, facing or not. At 40 creatures
 * that was 1.51M triangles a frame against 165K for the room itself.
 *
 * 30m is past what can be seen: FogExp2 at the lit density of 0.08 is fully
 * opaque by about 27m, and the camera's far plane is 60. Raise the fog and this
 * has to move with it.
 *
 * They still think and animate out there — only the drawing stops.
 */
export const CREATURE_DRAW_DISTANCE = 30;
/** Top turn rate in rad/s, so creatures rotate rather than snap. */
export const TURN_RATE = 6.0;
/** Seconds the corpse lingers after the death animation ends. */
export const CORPSE_LINGER = 1.5;
/** Per-creature speed multiplier range, so the horde does not move as one body. */
export const SPEED_VARIANCE: readonly [number, number] = [0.85, 1.15];
/** Per-creature scale multiplier range. */
export const SCALE_VARIANCE: readonly [number, number] = [0.93, 1.08];
