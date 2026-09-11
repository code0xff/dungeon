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
  // A head over the zombie and broad with it: the silhouette has to say
  // "not a zombie" before the lantern reaches its face.
  orc: { dir: 'creatures/orc', height: 2.1 },
  // The player's own body, loaded a second time under its own key and darkened
  // at spawn (BLACK_KNIGHT_SHADE). Loaded twice rather than shared because the
  // loader keys everything — clips, walk speed, materials — by creature, and
  // a shared template would tie the ally's body to the enemy's tint. It costs
  // about 1MB once.
  blackknight: { dir: 'creatures/knight', height: 1.95 },
};
/**
 * The other players' body: a Mixamo knight, idle/walk/attack/death like a
 * creature, because that is the animation vocabulary the loader already speaks.
 *
 * 1.75m against the player's own EYE_H of 1.6 — a body whose eyes sit about
 * where the camera does. Sizing it to EYE_H instead would have made everyone
 * else a head shorter than themselves.
 *
 * It is not in CREATURE_ASSETS on purpose: nothing spawns it, it has no hp and
 * no AI, and putting it there would demand a spawn rate and a CreatureType for
 * something the dungeon never places.
 */
export const PLAYER_KEY = 'knight';
export const PLAYER_ASSET = { dir: 'creatures/knight', height: 1.75 };

/**
 * How fast a remote body chases the pose that was reported for it, per second.
 *
 * This is a lag against a lie either way: the body is always somewhere the other
 * player has already left. Too low and an ally rounds a corner a metre behind
 * where they really are; too high and the body twitches on every packet.
 * 14 settles a snapshot in about 70ms, just over one tick at TICK_HZ, so a
 * missed packet is smoothed rather than seen.
 */
export const REMOTE_LERP = 14;
/**
 * Seconds of silence before a remote body is removed.
 *
 * Bodies vanish on silence rather than on a message because the message is the
 * thing most likely to go missing. Comfortably more than one tick, so a single
 * dropped packet does not make an ally blink out and back.
 */
export const REMOTE_FADE = 2.5;
/**
 * One colour per player, in roster order.
 *
 * Told apart at a glance in a corridor lit the colour of fire, which is why
 * none of these are orange or red — the torchlight would eat them, and red is
 * the blood the game already uses for damage.
 */
export const REMOTE_TINTS = [0x4a86d8, 0x4fae72, 0xb47ad0, 0x4fb3ae];
/**
 * How hard the tint is pushed into the body, as emissive intensity.
 *
 * Found by looking at it, and both ends were wrong. At 0.35 the knight is a
 * flat coloured silhouette with none of its armour left — a shape where a
 * person should be. At 0 it is nearly invisible: dark plate in a dungeon lit
 * the colour of rust reads as another shadow, which is worse than a creature.
 * 0.07 keeps the plate, the trim and the shield legible and still says which
 * ally it is from down a corridor. 0.12 was the first value that looked right
 * on the blue tint and was clearly too much on the green one — the lighter
 * colours wash the armour out sooner.
 */
export const REMOTE_TINT = 0.07;
/**
 * Seconds an ally's body cross-fades into its swing.
 *
 * Short, because a swing is a sudden thing: the sender's own arm starts the
 * instant they press, and a slow blend here would have the knight still
 * winding down its walk while its sword was already coming through.
 */
export const REMOTE_SWING_FADE = 0.06;

/**
 * Metres. A creature further than this from a player is not sent to them.
 *
 * At level 15 a dungeon holds over a hundred creatures and most are nowhere
 * near anybody, so sending them all is bandwidth spent on things nobody can
 * see. Comfortably past what the torchlight reaches, because a creature has to
 * already be moving correctly by the time it comes into view — arriving at the
 * edge of the light and snapping into place is worse than not being drawn.
 */
/**
 * The name tag over an ally: height above their feet, and how wide the label is
 * drawn in metres.
 *
 * 2.05 clears the knight's head at PLAYER_ASSET.height without floating: a tag
 * further up stops reading as belonging to the body under it. The width is what
 * makes the text legible at the far end of a corridor without the label being
 * the biggest thing in the dungeon.
 *
 * It is a sprite, so it turns to face the camera on its own and — because it
 * respects the depth buffer — a wall hides it. That is deliberate: a name
 * floating through stone would tell you where an ally is when the game has
 * decided you cannot see them.
 */
export const NAME_TAG_Y = 2.05;
export const NAME_TAG_W = 1.15;

/**
 * How far above the game's biggest real hit a reported hit may be before the
 * host drops it as forged.
 *
 * Multiplicative, on max(LUNGE_DMG, sword) and MUSKET_DMG. It is not a rounding
 * allowance — reports are rounded to a tenth — but headroom so a future
 * damage tweak does not silently make every lunge a forgery. Anything past it
 * is dropped, not clamped: a client that sends 200 should get nothing.
 */
export const HIT_REPORT_MARGIN = 1.05;
export const MOB_INTEREST = 34;
/**
 * How fast a creature chases the position the authority reported for it.
 *
 * Faster than REMOTE_LERP, and deliberately. An ally drifting a few
 * centimetres behind where they really are costs nothing; a creature you are
 * swinging at is the one thing on screen where being slightly wrong about where
 * something is decides whether the swing lands.
 */
export const MOB_LERP = 20;
/**
 * Metres per second above which a creature is reported as walking.
 *
 * Not zero: groundSpeed is smoothed, so a creature that has just stopped decays
 * toward zero rather than reaching it, and a walk clip left running on a
 * standing body reads as sliding. Well under the slowest creature's speed —
 * the zombie shambles at 0.35 — so nothing that is moving is called still.
 */
export const WALK_REPORT_SPEED = 0.05;
/**
 * Seconds without a report before a followed creature is dropped.
 *
 * Snapshots are partial — the host omits anything past MOB_INTEREST from the
 * recipient — so walking away from a creature is not announced, it just goes
 * quiet. Long enough to ride out a dropped packet at TICK_HZ, short enough that
 * a creature does not linger at the edge of the light after you have left it.
 */
export const MOB_STALE = 1.2;

/**
 * How dark the Black Knight's armour is drawn: the knight texture's colour is
 * multiplied by this. 0.22 is black plate that still has edges in torchlight;
 * lower and it is a hole in the corridor, higher and it is a grey ally.
 */
export const BLACK_KNIGHT_SHADE = 0.22;
/**
 * The cone in front of a shielded creature that its shield covers, as a dot
 * product against its facing. 0.5 is 120 degrees across — wide enough that
 * standing "a bit to the side" is not enough and a real flank is needed, narrow
 * enough that a flank exists. The player's own GUARD_ARC is wider on purpose;
 * the player has to hold the direction with a mouse and the creature does not.
 */
export const BLOCK_ARC = 0.5;

// ---- Third person ----
/** Toggles the view. */
export const THIRD_PERSON_KEY = 'V';
/**
 * Where the camera sits behind the player, in metres: back along the look
 * direction, up from eye height, and out over the right shoulder.
 *
 * 2.3 back is far enough to see the whole body swing and close enough that a
 * 4m corridor does not put the camera in the wall behind you every time you
 * turn round — the sweep below handles the times it would. The shoulder offset
 * is what keeps your own back from being the middle of the screen: the body
 * sits left of centre and the corridor ahead stays visible past it. 0.45 up
 * looks slightly down onto the fight, which is where the parry tell is.
 */
export const TP_DISTANCE = 2.3;
export const TP_HEIGHT = 0.45;
export const TP_SHOULDER = 0.5;
/**
 * The camera's own radius against walls, and how close it may come to the
 * player before the body is hidden.
 *
 * The sweep pulls the camera in along its line until it clears the walls by
 * TP_CLEAR; below TP_MIN_DIST the near plane would be cutting through the
 * model's back, and a headless torso is worse than a moment of first person.
 */
/**
 * A faint neutral emissive on the player's own body in third person.
 *
 * Small. The light held overhead (TP_LIGHT_UP) does the real work of shaping
 * the armour; this only keeps the folds under the shoulders from going to pure
 * black. At 0.06 it flattened the plate into an even grey — a white emissive
 * is the one thing that shows no form at all.
 */
export const TP_BODY_LIFT = 0.025;
export const TP_CLEAR = 0.3;
export const TP_MIN_DIST = 0.7;
/**
 * How fast the camera eases back out after a wall pushed it in, per second.
 *
 * Pulling *in* is never eased: a camera that lerps toward a wall spends the
 * lerp inside it. Easing out is what stops the camera snapping to full length
 * the instant a corner is cleared, which read as a jolt every time you turned.
 */
export const TP_EASE = 6;
/**
 * In third person the player's light is held up: this far ahead of the eyes,
 * and this far above them.
 *
 * At the eyes it is inside the helmet, and the metal 30cm from it blew out.
 * Ahead of the body it lit the corridor and nothing of the player — the camera
 * sees the *back*, the one side a light in front can never reach, and the
 * armour showed only the environment map: flat, neutral grey. Held high and
 * just ahead, like a lantern raised, it rakes down over the helmet and the
 * shoulders and still reaches the floor ahead. 0.9 up puts it at 2.5m under a
 * 3.4m ceiling.
 */
export const TP_LIGHT_AHEAD = 0.35;
export const TP_LIGHT_UP = 0.9;
/**
 * How fast the body turns to face the way it is walking, radians per second.
 *
 * The body walks where the stick points, not where the camera looks — a knight
 * sliding sideways while its legs march forward is the single most artificial
 * thing an over-the-shoulder camera can show. It turns back to the look
 * direction to attack or guard, because those are aimed.
 */
export const TP_TURN_RATE = 11;
/**
 * The most a body's walk clip may be sped up to keep the feet on the floor.
 *
 * The creatures cap at WALK_TIMESCALE_RANGE's 1.9, but the knight's walk is
 * authored at 1.40m/s and the player moves at SPEED 5.2 — 3.7x. Without a run
 * clip the choice is legs that blur or legs that slide, and blurring is the
 * lesser lie. A run clip is the real fix.
 */
export const BODY_WALK_MAX = 3.8;
/**
 * Ground speed, m/s, above which a body with a run clip runs.
 *
 * Between the knight's walk (authored at 1.40) and the player's SPEED of 5.2,
 * and above the guard shuffle at 5.2 × GUARD_SLOW = 2.86 — so a shielded
 * advance still walks, and only an actual sprint runs. The clip chosen is then
 * retimed to the real speed either way, so the switch is a change of gait,
 * not a change of pace.
 */
export const RUN_AT = 3.0;

export const WALL_TEX_DIR = 'textures/wall';
export const FLOOR_TEX_DIR = 'textures/floor';
/**
 * Every clip the loader looks for. idle carries the body; the rest are motion
 * only. guard and stagger are newer and most creatures do not have them —
 * guard is the knight's block (an ally's raised shield, the Black Knight's
 * resting pose), stagger the reaction to being parried. A missing one is not an
 * error: idle stands in for guard, and the root-transform lean for stagger.
 */
export const CLIP_NAMES = ['idle', 'walk', 'attack', 'death', 'guard', 'stagger', 'run'] as const;

/**
 * Prop models. Without them the primitives in src/props.ts are used.
 *
 * `lidNode` names the node the open animation turns. Poly Haven's treasure_chest
 * already has its lid as a separate node hinged at the back, which is the same
 * convention the primitive chest uses, so it needs no rework.
 */
export const PROP_ASSETS = {
  chest: { url: 'props/chest.glb', height: 0.62, lidNode: 'treasure_chest_lid' },
  /**
   * Held in the left hand. Without the file nothing is drawn and the guard still
   * works — see loadShield().
   *
   * This replaced a lantern that used to be held here. The lantern was pure
   * decoration: `playerLight` is a point light on the player, and setLampLit()
   * only ever toggled the mesh's visibility, so the model conveyed nothing the
   * light radius and the HUD timer did not already say. It never dimmed or
   * guttered as the fuel ran down. Trading it for something the hand can
   * actually use is a straight gain.
   */
  shield: { url: 'weapons/shield.glb', height: 0.82 },
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
  // wooden_handle_saber: tip along +Y, grip near the origin.
  // Longer than it was: at 1.05 the blade read as a stick in the corner of the
  // screen. The model is fine — held square on it is a broad falchion — it was
  // simply small and edge-on. See SWORD_REST for the other half of that.
  sword: { url: 'weapons/sword.glb', rot: [-Math.PI / 2, 0, 0], length: 1.24, back: 0.14 },
  // bolt_action_rifle_7_62: muzzle along +X
  musket: { url: 'weapons/musket.glb', rot: [0, Math.PI / 2, 0], length: 1.3, back: 0.3 },
};

// ================= Tuning =================
/**
 * Maze cells per side at stage 1 and from SPAWN_PEAK_STAGE on. The actual grid
 * is `cells * 2 + 1` including walls, so 9 cells is a 19x19 grid, 76m a side and
 * about 175 floor cells; 15 is 31x31, 124m and about 510.
 *
 * The dungeon growing is what makes an early stage short. Density is handled
 * separately and deliberately — SPAWN, CHEST_COUNT and ROOM_COUNT are all scaled
 * by the floor area actually carved, so a smaller stage 1 is not a denser one.
 * What shrinks is the *run*: less ground to search for the key, less time
 * exposed. That is the half of stage-1 difficulty the spawn curve was never
 * going to fix, because it was already sparse.
 *
 * The peak is deliberately exactly what every stage used to be. Growing past it
 * was tried and reverted: it pushed stage 12 to 125 creatures and the 95th
 * percentile frame from 7.2ms to 10.2ms, which is late-game difficulty and phone
 * headroom being spent to fix an early-game problem. Only the bottom needed to
 * move — stage 1 was a 124m maze to search before anything else could happen.
 */
export const MAZE_CELLS_START = 9;
export const MAZE_CELLS_PEAK = 15;
/**
 * Narrowest a dungeon may be, as the short side over the long one. 1 is square.
 *
 * The stretch is area-preserving — one axis is divided by sqrt(aspect) and the
 * other multiplied — so a lopsided dungeon holds the same amount of content and
 * sits at the same point on the difficulty curve as a square one. It exists
 * because every dungeon being square made the shape of the map the one thing
 * that never varied between runs.
 */
export const MAZE_ASPECT = 0.62;
/**
 * Floor cells the SPAWN, CHEST_COUNT and ROOM_COUNT numbers below are written
 * against, so they can be read as "at the old 15-cell dungeon" and scaled from
 * there. Measured, not derived: rooms are stamped at random, so the carved area
 * is not a closed form.
 */
export const REF_FLOOR_CELLS = 510;
/**
 * Texture tiles per maze cell on the floor and ceiling.
 *
 * Per cell rather than per plane, because the plane is a different size every
 * stage: a fixed repeat would stretch the cobbles wider on a big dungeon and
 * squash them on a small one, which is the kind of thing that reads as "the art
 * is wrong" rather than "the map is bigger".
 */
export const FLOOR_TILES_PER_CELL = 1.2;
export const CEIL_TILES_PER_CELL = 1.5;
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
export const DASH_SPEED = 17;
/**
 * Seconds the burst lasts.
 *
 * Distance is not SPEED * TIME: the burst eases out on 1-(t/T)^2, whose integral
 * is 2T/3, so these two give 2.9m. The floor on that number is creature reach,
 * which tops out at the brute's 2.2m — a dodge has to clear the reach of the
 * thing swinging at you or it dodges nothing. The first pass covered 1.67m and
 * was useless for exactly that reason.
 *
 * It was 3.8m, and that turned out to be over the ceiling rather than under it:
 * a dodge that crosses most of a 4m cell stops being a sidestep and starts being
 * a short teleport, which reads badly in a corridor and made positioning sloppy.
 * 2.9m still clears a brute from contact with 0.7m to spare. The speed was cut
 * rather than the duration, so the burst keeps its 0.26s of camera roll and
 * simply covers less ground — shortening the time instead would have made it
 * snappier and harder to read.
 */
export const DASH_TIME = 0.26;
/**
 * Seconds before it can be used again.
 *
 * The dodge has no invulnerability — it works by taking the player out of a
 * creature's reach before the blow lands, which is honest and needs no timing
 * minigame. That means the cooldown is the only thing stopping it from being
 * plain faster movement. At 1.1s, spamming it averages 2.7m/s against a walk of
 * SPEED 5.2, so it is a burst and never a way to travel.
 */
export const DASH_CD = 1.1;
/** Camera roll at the peak of a sideways dodge, in radians. Sells the weight. */
export const DASH_ROLL = 0.09;

// ---- Lunge ----
/**
 * How forward a dodge has to be to arm a lunge, as the cosine of the angle
 * between it and where the player is facing.
 *
 * 0.7 is 45 degrees, so a diagonal still counts and a strafe never does. It is
 * measured against the *dodge* direction rather than the camera, which matters
 * because the view can be swung around mid-dodge: what earns the bonus is
 * closing the distance, not looking like you did.
 */
export const LUNGE_AIM = 0.7;
/**
 * How long after a forward dodge an attack still counts as a lunge.
 *
 * Measured from the press, not from the blade landing. The swing takes
 * `SWING_IMPACT / SWING_SPEED` = 0.2s to reach the target, so judging it at
 * impact would silently cost the player a fifth of the window for something
 * they cannot see or control.
 *
 * At 0.5s against a DASH_TIME of 0.26 the input has to come during the dodge or
 * immediately out of it. ATTACK_CD is 0.45, so a lunge is never two swings.
 */
export const LUNGE_WINDOW = 0.5;
/**
 * Damage multiplier on that hit.
 *
 * Set so a lunge kills a 4hp zombie outright for the **top half of the blade's
 * life**. Damage is 0.45 + 0.55 * durability, so at 50% a sword does 0.725 and
 * 5.52 is where that clears 4.
 *
 * It was 4x first, which is the bare multiplier at a *pristine* edge — and
 * therefore useless, because one ordinary swing takes 0.45 off and the zombie
 * survives on 0.01hp. A reward that exists for exactly one swing after a repair
 * is not a reward. At 5.52 it holds for 111 creature-hits of wear, which is half
 * of a blade, so it lines up with the repair cycle instead of the moment after
 * it.
 *
 * The size is also the answer to how hard the input is: the window is half a
 * second from a dodge that has to be going forward, and if the payoff is not
 * obvious nobody will keep trying to hit it.
 *
 * Knock-on worth knowing: a brute (9hp) drops from three lunges to two above 66%
 * durability. Zombies and lunatics are one lunge throughout.
 *
 * Large on purpose either way. The dodge puts the player inside reach with
 * DASH_CD seconds before they can back out again, which against a brute is the
 * most dangerous place in the game; a 10-20% bonus would not pay for that and
 * nobody would ever take the risk.
 *
 * The wear is **not** scaled with it. It was, on the reasoning that damage
 * should cost durability — but at 4x that is 1.8 an enemy, which burns a blade
 * in 55 hits and means using the mechanic destroys the sharpness the mechanic
 * depends on. A lunge costs the same SWORD_WEAR as any other cut.
 */
export const LUNGE_DMG = 5.52;

// ---- Lunge impact ----
/**
 * How long the impact reads for, in seconds, and how hard.
 *
 * A lunge that landed used to be indistinguishable from one that missed except
 * by the sound, which is a poor way to teach a mechanic whose whole difficulty
 * is knowing whether you got it. All three of these fire together on a landed
 * lunge and decay over the same window, so it reads as one event rather than
 * three effects.
 */
export const LUNGE_HIT_TIME = 0.26;
/**
 * Blade glow at the moment of impact, as a multiple of the armed level.
 *
 * Above 1 on purpose: the armed glow is the charge and this is it being spent,
 * so the blade has to visibly go brighter than it ever was while waiting. 2.4
 * was tried and washed the blade to flat white, which stopped reading as a
 * sword at all; 1.8 lands between the red and the hot colour and still doubles
 * the armed level.
 */
export const LUNGE_HIT_GLOW = 1.9;
/** Camera pitch kick, in radians. Small — this is a punch, not a stumble. */
export const LUNGE_HIT_KICK = 0.055;
/** Peak intensity of the light thrown at the point of impact. */
export const LUNGE_HIT_LIGHT = 2.6;

/**
 * Chests at the reference size, scaled by area like everything else — but never
 * below CHEST_ITEMS.length, because the guaranteed contents have to have
 * somewhere to go. A small dungeon is therefore comparatively well stocked,
 * which is the right way round for an opening stage.
 */
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
  'key', 'lantern', 'map', 'ammo', 'ammo', 'potion', 'potion', 'whetstone', 'ward',
];
/**
 * Items that are never put in a trapped chest.
 *
 * A trapped chest is a bet: the tell on the lid says "this one costs", and the
 * player decides whether the contents are worth it. The key is not a bet — the
 * run cannot end without it, so a trap on it is not a choice, it is a toll. The
 * map is on the list for the same reason at lower stakes: it is the thing that
 * makes the rest of the chests findable. Everything else stays fair game;
 * gambling a potion is the whole point of the tell.
 */
export const CHEST_SAFE_ITEMS: readonly ItemKind[] = ['key', 'map'];

/**
 * Number keys for the consumable slots. 1 and 2 are the weapons, so the pack
 * starts at 3. These are the labels shown in the HUD and in pickup messages too,
 * so the binding and what the player is told can never drift apart.
 */
export const POTION_KEY = '3';
export const LANTERN_KEY = '4';
export const WHETSTONE_KEY = '5';
export const WARD_KEY = '6';

// ---- Wards ----
/**
 * The ward's glow. Green, the colour the dungeon already uses for a light
 * someone lit on purpose — but on the floor and faceted, where the sconces are
 * flames on the wall at head height, so the two do not read as the same thing.
 */
export const WARD_COLOR = 0x5dff8a;
/** Height of the gem's centre above the floor, in metres. Low: it marks ground. */
export const WARD_HEIGHT = 0.32;
/** Radians a second the gem turns. Slow; it is a marker, not a pickup. */
export const WARD_SPIN = 0.8;
/**
 * Closest two wards may be set, in metres. A second ward on the same spot says
 * nothing the first did not, and pressing the key twice by accident would
 * spend one for nothing.
 */
export const WARD_GAP = 1.5;
/**
 * Seconds to set a ward down, standing still. Moving, swinging or being hit
 * stops it, and a ward that was not set is not spent.
 *
 * The same rule as opening a chest, so there is nothing new to learn: a ward
 * is set where you are *sure* is safe for a moment, which is the judgement
 * the whole dungeon is built around. A shade under the potion's POTION_DRINK,
 * because this one is not paid for up front.
 */
export const WARD_TIME = 0.8;
/** Holds the shield up. The right mouse button does the same. */
export const GUARD_KEY = 'F';
/** Opens the controls panel, and closes it again. */
export const GUIDE_KEY = 'H';
/** Mutes and unmutes everything. */
export const SOUND_KEY = 'M';

/**
 * Master output level, 0..1. Muting sets the same gain node to 0 rather than
 * suspending the context, so the drone resumes exactly where it left off.
 */
export const MASTER_VOLUME = 0.4;

export const MAX_HP = 100;
/** Health one potion restores. */
export const POTION_HEAL = 35;
/**
 * Seconds a potion takes to go down before the health arrives.
 *
 * Healing used to be instant, which made a potion a button that undid the last
 * two hits with no decision attached — you could take the hit, press 3, and be
 * whole again before the next swing landed. Now there is a moment where you have
 * spent it and have not got it yet, so the choice becomes *when*: backing off to
 * drink is the cost.
 *
 * Well under MUSKET_RELOAD's 3s. A reload is meant to be a real gap you plan
 * around; this is a beat, roughly a zombie's attack cooldown, so being caught
 * mid-drink is possible but not a sentence.
 *
 * Nothing interrupts it. The potion is spent up front, so dying with one in your
 * throat loses it — that is the risk, and it is legible without also needing a
 * cancel rule the player has to learn.
 */
export const POTION_DRINK = 0.9;
/**
 * How far the lid swings open, in radians. Negative tips the front up.
 * Past about -1.6 the lid clears vertical and looks detached rather than open.
 */
export const CHEST_LID_OPEN = -1.5;
// ================= Guard =================
/**
 * How wide the shield covers, as the cosine of the angle off where the player is
 * looking. 0.35 is about 70 degrees each way.
 *
 * Front only, deliberately. Creatures crowd and push past each other now, so a
 * guard that covered every direction would answer being surrounded — and that is
 * the dodge's job. The two are meant to solve different halves of the same
 * problem: the guard handles what you are looking at, the dodge handles what you
 * are not.
 */
export const GUARD_ARC = 0.35;
/** Movement speed while the shield is up, as a fraction of SPEED. */
export const GUARD_SLOW = 0.55;
/**
 * Movement speed while the sword is mid-swing, as a fraction of SPEED.
 *
 * A swing is planted: you do not sprint through one. At full SPEED a swing
 * carried the player 1.7m, which in first person passed unnoticed and in third
 * person — and on every ally's screen — was a body sliding across the floor in
 * an attack pose that stands still. 0.35 × 5.2 = 1.8 m/s is about what the
 * attack clip's own root motion was authored at, so the feet keep up. Not a
 * full stop: the fight is built on distance, and freezing for 0.33s every
 * swing would hand it to anything faster than a zombie.
 */
export const SWING_SLOW = 0.35;
/**
 * Movement speed while a potion goes down, as a fraction of SPEED.
 *
 * The same figure as the swing, for the same reason: drinking is a thing you
 * stop for. Sprinting through a POTION_DRINK at full pace made the potion
 * free — the only cost was a moment of not swinging, and a moment spent
 * running away is not a cost at all.
 */
export const DRINK_SLOW = SWING_SLOW;
/** How fast the shield comes up and down, in units of 1/second. */
export const GUARD_RAISE = 11;
/** Fraction of a blocked hit that still gets through, by creature weight. */
export const GUARD_LEAK = 0;
/**
 * How much of a brute's blow the shield does *not* stop.
 *
 * A brute swings for 32 — nearly a third of MAX_HP — and stopping that dead
 * would make the shield the answer to the one creature that is supposed to be
 * frightening. At 0.35 a guarded brute still takes 11 off you, so blocking is
 * survivable and standing there is not a plan.
 */
export const GUARD_LEAK_HEAVY = 0.35;

// ================= Parry =================
/**
 * Seconds after raising the shield in which a blow is parried rather than
 * merely blocked.
 *
 * Timed on the *press*, not the hold. A guard held up permanently has to be
 * safe-but-worthless or there is no decision in it; the reward has to cost a
 * moment of judgement. The telegraphs are long enough to read — measured from
 * startAttack() to the hit landing: brute 905ms, zombie 703ms, lunatic 521ms —
 * so 0.35 is generous against the brute and demanding against the lunatic, which
 * is the right way round. The heavy hitter is the one worth learning.
 */
export const PARRY_WINDOW = 0.35;
/**
 * Seconds after a guard press before another press can open a parry window.
 *
 * Without this the timing is free: `guardDown()` sets the window on every press,
 * so tapping the button at 10Hz keeps a 0.35s window permanently open and every
 * blow that lands is parried. That is not a hard exploit to find — it is what
 * mashing does — and it would have quietly deleted the one mechanic in the game
 * that asks for timing.
 *
 * Longer than PARRY_WINDOW, so the windows cannot overlap however fast the press
 * is repeated. Tapping still guards; it just does not keep re-arming the parry.
 */
export const PARRY_CD = 0.55;
/**
 * Seconds a parried creature is staggered: interrupted, rocked back, and unable
 * to move or swing.
 *
 * Long enough to land the counter the parry opens. LUNGE_WINDOW is 0.5 and a
 * swing takes SWING_IMPACT / SWING_SPEED = 0.2s to land, so this covers the
 * whole exchange with room to spare.
 */
export const STAGGER_TIME = 1.2;
/**
 * Seconds of stagger clip that fit in STAGGER_TIME.
 *
 * The clips are 2.17s as authored, with a long settle after the recoil. Played
 * at their own pace only the first third was ever seen before the creature
 * recovered and the walk faded in over it. staggerSpeed() below retimes each
 * clip to land its last frame at STAGGER_TIME — about 1.8x on these — so the
 * stumble and the recovery both play and the walk picks up from a standing
 * body. A shorter STAGGER_TIME would only make that faster.
 */
export const staggerSpeed = (clipDuration: number): number => Math.max(1, clipDuration / STAGGER_TIME);
/** How far back a staggered creature rocks, in radians. Eases back over STAGGER_TIME. */
export const STAGGER_LEAN = 0.52;
/**
 * The lean kept under a body that has a stagger clip, as a fraction of
 * STAGGER_LEAN.
 *
 * The clip is a hit reaction — 25° at the hips, 27° at the head, the rest in
 * the arms — and in a dark corridor at three metres that is not a stumble, it
 * is a shrug. Switching the lean off entirely when the clips arrived made the
 * parry look like it had stopped working. Half of it, under the clip, gives
 * the whole-body rock back that reads at a distance, without folding the body
 * in half the way the full lean on top of the clip did.
 */
export const STAGGER_LEAN_ACTED = 0.5;
/** How far it is knocked back, in metres. */
export const STAGGER_PUSH = 0.9;

export const ATTACK_RANGE = 2.3;
export const ATTACK_CD = 0.45;
/**
 * How long a swing pressed during the cooldown is remembered for.
 *
 * Equal to ATTACK_CD, which makes the rule simply "a press during the cooldown
 * fires the moment it ends". It is not a generosity dial; it is the length the
 * lunge needs.
 *
 * Without it the press was dropped in silence, and the ordinary rhythm of the
 * game walks straight into that: swing at something, dodge forward, swing again.
 * Measured on that sequence with a single press, everything from 0 to 0.35s
 * after the dodge vanished and only 0.36-0.43s produced a lunge — a 70ms window,
 * because ATTACK_CD eats almost all of LUNGE_WINDOW. Mashing got there in about
 * seven discarded presses.
 *
 * A shorter buffer would not have fixed it. Pressing at the *start* of a dodge
 * leaves the full ATTACK_CD to wait out, so anything less than that still drops
 * the most natural press of all.
 */
export const ATTACK_BUFFER = ATTACK_CD;

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
 * Durability a whetstone puts back.
 *
 * The shop already repairs a sword to full, but only between stages — which
 * means a blade that goes blunt halfway down is blunt for the rest of the run,
 * and the only answer was to leave early. The whetstone is that answer's
 * replacement: a pack item, spent where the wear happened.
 *
 * At 45 it is worth `45 * SHOP.repairPerPoint` = 90 G of counter repair, the
 * same as a lantern, and buys back about 100 more cuts at SWORD_WEAR. It tops
 * up rather than replacing, so grinding a nearly-fresh blade wastes most of it —
 * the decision is when to spend it, not whether.
 */
export const WHETSTONE_REPAIR = 45;
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
/**
 * LANTERN_FUEL as the player reads it: "2.5", not "3". Rounded to a whole
 * minute it promised half a minute the lantern does not have — in the shop and
 * again when it was lit — so every place that names it goes through here.
 */
export const lanternMinutes = (): string => String(Math.round((LANTERN_FUEL / 60) * 10) / 10);
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

/**
 * How strongly held gear and props reflect the environment map.
 *
 * Only metal is affected in practice, since that is what has nothing but
 * reflection to show. Kept well below 1: this is a dungeon lit by one lantern,
 * and a blade that mirrors a room which is not there stops looking like it is in
 * the dark with you. At 0.35 it reads as a sheen down the edge.
 */
export const ENV_INTENSITY = 0.35;

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

// ================= Traps =================
/**
 * Traps at REF_FLOOR_CELLS, scaled by carved area like everything else.
 *
 * A trap is not a damage tax. HP is already the thing creatures spend and
 * potions restore, so a hazard that only subtracts from it adds a cost without
 * adding a decision. What these spend is the dungeon's *attention* — the noise
 * is the point and TRAP_DMG is only there so the spring has a physical bite.
 */
export const TRAP_COUNT = 12;
/** How close the player has to get to set one off, in metres. */
export const TRAP_RADIUS = 1.1;
/**
 * How far off its cell's centre a trap may sit, in metres each way.
 *
 * This is what stops "walk with your shoulder on the wall" from being a blanket
 * answer to traps. At the old 0.7 every trap sat in the middle half of a 4m
 * cell, so hugging *either* wall cleared the 1.1m trigger with room to spare and
 * the mechanic could be turned off by a habit rather than by looking.
 *
 * At 1.35 a trap can sit right against a wall, and a player pressed to that same
 * wall walks into it. The far wall is still clear — no trap is ever unavoidable,
 * because the widest possible offset still leaves 1.55 + 1.35 = 2.9m of
 * separation on the other side. What changes is that the safe side is now a
 * property of the individual trap, so it has to be seen rather than assumed.
 *
 * 1.35 is the ceiling: the trap model is about 0.55m across, so anything more
 * and it starts clipping into the wall it is leaning on.
 */
export const TRAP_JITTER = 1.35;
/**
 * Health a spring costs.
 *
 * Small on purpose, and well under one POTION_HEAL. If the damage mattered the
 * noise would not, and a player would start reading traps as "lose 30 HP"
 * instead of "the room now knows where you are".
 */
export const TRAP_DMG = 10;
/**
 * How far a sprung trap carries and how long it is hunted for.
 *
 * Louder than a musket, which is the intended relationship: a shot at least
 * kills something, while this buys nothing at all. It is the worst noise in the
 * game because it is the only one you make by accident.
 */
export const TRAP_ALERT_RADIUS = 24;
/**
 * Seconds the jaws take to snap shut. Long enough to see, short enough not to
 * be an event of its own.
 *
 * It lived in loop.ts until an ally's trap had to spring on someone else's
 * screen too, and two modules sharing a number is what config.ts is for.
 */
export const TRAP_SPRING_TIME = 0.35;
export const TRAP_ALERT_TIME = 12;
/**
 * Fraction of chests that are trapped.
 *
 * This is what finally makes looting a decision. Opening a chest was always
 * correct — the only cost was LOOT_TIME and a 9m creak — so there was never
 * anything to weigh. Now the tell is visible on the lid and the map marks them,
 * and you decide whether the contents are worth waking the floor.
 *
 * The good case is the key being in one. Then there is no decision at all, only
 * a price, which is exactly when a trap is at its best.
 */
export const CHEST_TRAP_FRAC = 0.3;

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

// ---- Hard mode ----
/**
 * What hard mode multiplies every shop price by.
 *
 * Hard mode's shop is three rows — wounds, blade, musket balls — so gold has
 * far less to do, and at normal prices a run would bank more than it could
 * ever spend. 1.5 keeps the bank a decision rather than a score.
 */
export const HARD_PRICE = 1.5;
/**
 * Durability a trapped chest takes off the sword, in points of SWORD_DUR_MAX.
 *
 * The lid springs on the blade that pried it. 6 is about thirteen swings'
 * worth (SWORD_WEAR 0.45) — enough that a run of trapped chests is felt in the
 * next fight, small enough that one is not a whetstone. Every mode; in hard
 * mode there is only one chest and it is never trapped, so it is felt where
 * chests are plentiful.
 */
export const TRAP_SWORD_WEAR = 6;

export const SHOP = {
  /** Per point of durability restored, so a barely-nicked sword is cheap. */
  repairPerPoint: 2,
  /**
   * Per point of health restored.
   *
   * Under the potion's rate, which works out at SHOP.potion / POTION_HEAL =
   * 1.71 a point. Same relationship as the whetstone against the counter repair
   * and for the same reason: the counter is only open between stages, so the
   * thing that travels is the one you pay a premium for.
   *
   * It does not undo the decision at the portal. Walking out on 12 HP still
   * means walking in on 12 unless you spend for it — the choice just stops being
   * "start the next stage hurt" and becomes "start it hurt or poorer", which is
   * what every other row here already offers.
   */
  healPerPoint: 1.5,
  potion: 60,
  /** One lantern's worth of oil — LANTERN_FUEL seconds. */
  lantern: 90,
  /** Price of one batch, which is AMMO_PICKUP rounds. */
  ammo: 45,
  /**
   * A whetstone carried into the dungeon. Dearer than the WHETSTONE_REPAIR
   * points of counter repair it is worth, because the counter is only open
   * between stages — the premium is for being able to sharpen at the bottom.
   */
  whetstone: 110,
  /**
   * A ward. The cheapest thing on the counter: it does nothing in a fight and
   * everything for a player who keeps walking the same loop of corridor.
   */
  ward: 35,
} as const;

/**
 * How far a kill's gold varies from the creature's `reward`, as a fraction.
 *
 * `reward` is the middle of a band, not a price list. A fixed payout made every
 * zombie the same twelve gold, so killing things stopped being a result and
 * became arithmetic — you knew what a corridor was worth before you walked into
 * it. At 0.35 a zombie pays 8-16 and a brute 36-74, enough that a good run feels
 * lucky without the spread being large enough to matter over a whole stage.
 *
 * Proportional rather than a flat +/-, so the band scales with what the creature
 * is worth instead of being noise on a brute and the whole payout on a zombie.
 */
export const REWARD_SPREAD = 0.35;

// ================= Creatures =================
/**
 * Creature stats.
 *
 * `hp` is in damage points, where a **pristine** sword does exactly 1 and a
 * musket ball does MUSKET_DMG. In play a sword is never pristine for long: it
 * dulls as it cuts, so a 4hp zombie takes 5 swings from a fresh blade and 9 from
 * a blunt one. Read hp as "roughly this many swings, more as the edge goes".
 *
 * `reward` is the *middle* of what a kill pays, not the payout — see
 * REWARD_SPREAD for the band either side of it.
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
   * aggro 18 is the highest in here and is the real weapon — it notices the
   * player from beyond the reach of the lantern, so the first warning is the
   * sound of one already coming.
   */
  /**
   * The orc. Stage 3 and up: the brute's hits at nearly the lunatic's pace, and
   * the first thing in the dungeon that cannot be walked away from *or* traded
   * with.
   *
   * It started on the Black Knight's old numbers, less the shield. It held this
   * slot — strong, quick, no trick to it — until it was made the thing the
   * shield is for, and the slot was worth keeping: a run needs one creature
   * that is simply dangerous before it meets one that is dangerous *and* has
   * to be read. hp 10 is eleven swings from a fresh blade or three musket
   * balls, dmg 24 is five hits to die from full, speed 3.6 is under the
   * player's 5.2 by enough to open distance slowly in a corridor, not to lose
   * it. The answer is the parry, the lunge (5.52 leaves it on 4.5 — one more
   * lunge or five swings), or the corridor behind you *early*.
   *
   * It was dmg 28 and speed 3.9 at first: four hits and almost no gap, and it
   * was killing players at stage 3 who had not met the parry yet.
   *
   * clearance 1.35 is a guess between the zombie's measured 1.15 and the
   * brute's 1.6; the orc's attack clip has not been stepped through the way
   * theirs were.
   */
  orc: {
    name: 'Orc',
    hp: 10, dmg: 24, speed: 3.6, atkCd: 0.9, attackSpeed: 2.0,
    reach: 2.0, r: 0.55, clearance: 1.35, reward: 110, aggro: 16,
    groan: [5, 9], voice: 0.7,
    animSpeed: 5, swing: 0.45,
  },
  /**
   * The Black Knight. Stage 5 and up, and the reason a run stops being about
   * numbers.
   *
   * Everything else in here is beaten by hitting it more. This one blocks:
   * `block` 0.75 means a swing from its front does a quarter — a fresh blade
   * does 0.25 of its 16 hp, and a lunge 1.38, so there is no front-on fight
   * to be had at all. The shield drops while it is staggered or mid-swing, and
   * a parry does both: it staggers the knight *and* opens the lunge window, so
   * the fight is bait the swing, parry it, lunge into the open body for 5.52 —
   * three times. Or get behind it for sixteen swings. Or four musket balls in
   * the back. What it is not is a sponge: every one of those is a route, and
   * the parry route is the one it teaches.
   *
   * It was hp 10 at 0.7 block and dmg 26, and at that it was a brute with a
   * trick — two parries and it was over, and once the parry was learned it
   * was not the creature the run was about. hp 16 and 0.75 make it three
   * clean parries, and dmg 34 — over the brute's 32 — means each one missed is
   * a third of your health, so the timing has to be learned rather than mashed.
   * The swing is faster than the brute's (the knight's clip is 1.56s at
   * attackSpeed 2 — 0.78s), so it is the swing you have to actually read.
   * speed 3.6 is over the zombie's 2.9 and under the player's 5.2: it can be
   * walked away from, not walked past. reward 200 because three clean parries
   * deserve it.
   *
   * clearance 1.3 is a guess between the zombie's measured 1.15 and the brute's
   * 1.6, not a measurement — the knight's attack clip has not been stepped
   * through the way theirs were.
   */
  blackknight: {
    name: 'Black Knight',
    hp: 16, dmg: 34, speed: 3.6, atkCd: 1.0, attackSpeed: 2.0,
    reach: 1.9, r: 0.5, clearance: 1.3, reward: 200, aggro: 17,
    groan: [7, 13], voice: 0.62,
    animSpeed: 3.6, swing: 0.4,
    block: 0.75,
  },
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
 * on an identical dungeon. Stage 1 is deliberately thin — about one creature per
 * 12.5 floor cells, sparse enough to learn the game in — and it fills up from
 * there to one per 4.5 at the peak.
 *
 * These are counts **at REF_FLOOR_CELLS**, scaled by the area actually carved.
 * The dungeon grows with the stage, so the raw numbers here are not what gets
 * spawned: stage 1 is 9 zombies, 2 brutes and 3 lunatics in a 76m dungeon, and
 * stage 12 is 61, 21 and 27 in a 124m one.
 *
 * **The mix shifts, and that is the larger half of the design.** Brutes and
 * lunatics start rare and grow far faster than zombies, so a late stage is not
 * the early one with more of the same — stage 1 is 86% zombies against 45% at
 * the peak. What kills you changes, which matters more than how many there are.
 *
 * The two grow differently on purpose. Lunatics start slightly commoner and ramp
 * a little slower; brutes are nearly absent at the start and climb hardest, so
 * the thing you learn to fear arrives last.
 *
 * The totals barely move: the reference count is 40 at stage 1 and 112 at the
 * peak, as before. Summed creature hp goes up 6% at the peak and *down* 9% at
 * stage 1, so this redistributes threat rather than adding it.
 *
 * Density, not headcount, is what is actually being tuned here — one creature
 * per few floor cells is what makes backing away from one back you into another.
 * That is exactly why areaScale() exists: these numbers are a density in
 * disguise, and a dungeon that changed size without them would change difficulty
 * by accident.
 */
export const SPAWN: Readonly<Record<CreatureKey, SpawnRate>> = {
  zombie: { base: 34, perStage: 1.5 },
  lunatic: { base: 4, perStage: 2.4 },
  brute: { base: 2, perStage: 2.6 },
  /**
   * The orc takes the stage-3 slot the Black Knight briefly held: one at 3,
   * one more every two stages, five and a half at the peak. It is the first
   * creature that is simply dangerous, and it arrives once the shield has been
   * learned on things that do not punish a missed parry this hard.
   */
  orc: { base: 1, perStage: 0.5, fromStage: 3 },
  /**
   * One at stage 5, one more every two stages, four and a half at the peak —
   * and none at all before 5. It counts from fromStage, so the number does not
   * have to be smuggled in as a negative base. It was moved to 3 for a while;
   * with the orc holding that stage it goes back to being the thing the orc
   * prepares you for.
   */
  blackknight: { base: 1, perStage: 0.5, fromStage: 5 },
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
/**
 * The stage the game is "beaten" at: walking out of it is the ending.
 *
 * The same stage the spawn curve peaks at, on purpose — that is where the
 * dungeon is as full as it can get, so it is the natural bottom. The game does
 * not stop there: the stages below keep counting, only the creatures grow
 * instead of multiplying (BEYOND_HP, BEYOND_DMG). The ending is a screen and a
 * number, not a wall.
 */
export const FINAL_STAGE = 12;

// ---- Tutorial ----
/**
 * The practice room's grid size, walls included, so the floor is two less a
 * side. 7 is a 20m square: room to dodge and to see a zombie coming, small
 * enough that nothing spawned in it is ever out of sight.
 */
export const TUTORIAL_ROOM = 7;
/** What the lesson hands out. One of each thing it teaches, and a full blade. */
export const TUTORIAL_KIT = { potions: 1, lanterns: 1, whetstones: 0, wards: 0, ammo: 6 };
/** Metres walked before the movement lesson is satisfied. */
export const TUTORIAL_MOVE_DIST = 4;
/** Dodges before the dodge lesson is satisfied — one to see it, one to feel it. */
export const TUTORIAL_DODGES = 2;
/** Health the player is set to before the potion lesson, so there is something to heal. */
export const TUTORIAL_POTION_HP = 50;
/** The room is seeded once so its sconces land in the same places every time. */
export const TUTORIAL_SEED = 7;

/** Radians a second the camera turns behind the title screen. Slow enough to read over. */
export const TITLE_DRIFT = 0.06;
/**
 * How the creatures grow per stage below FINAL_STAGE, as fractions of their
 * base hp, damage and reward.
 *
 * Counts are already at the ceiling by then (SPAWN_PEAK_STAGE), so the only
 * room left for difficulty is in each body. Compound, so it gets steep: by
 * stage 20 a zombie has 3.8x the health and hits for 2.5x, and the extra gold
 * pays for roughly the potions it costs. Nobody is meant to hold out down
 * there for long — that is what the ending is for.
 */
export const BEYOND_HP = 0.18;
export const BEYOND_DMG = 0.12;
export const BEYOND_REWARD = 0.12;

/**
 * What a co-op player is handed at the start, per level of the host's choosing.
 *
 * It sits beside the spawn curve because that is what it has to keep pace with:
 * a solo player reaching stage 8 has spent seven runs' gold in the shop, and
 * co-op has neither a shop nor a bank. Without a ramp here, the host's level
 * dial would scale the danger and nothing else.
 *
 * Deliberately below what a careful solo player would arrive with. Co-op adds
 * three other people, and matching solo outfitting on top of that would make a
 * level 8 party stronger than a stage 8 veteran. The caps exist because a pack
 * of ten potions stops being supplies and becomes an extra health bar.
 */
export const COOP_KIT = {
  /** One potion per this many levels. */
  potionPerLevels: 2,
  potionCap: 4,
  lanternPerLevels: 3,
  lanternCap: 3,
  whetstonePerLevels: 3,
  whetstoneCap: 3,
  wardPerLevels: 2,
  wardCap: 4,
  /** Spare rounds at level 1, matching the solo opening. */
  ammoBase: START_AMMO,
  /** Added per level above 1. Ammo is the one line that does not cap: the
   *  musket's cost is the noise it makes, and that grows with the level too. */
  ammoPerLevel: 1.5,
};

/**
 * Highest level a co-op host can pick.
 *
 * Past SPAWN_PEAK_STAGE the curves flatten, so a level beyond it is only a
 * bigger number, not a harder dungeon. A few above the peak is allowed because
 * the kit does keep growing there; far above it would be a dial that does
 * nothing, which is worse than not having the range.
 */
export const COOP_MAX_LEVEL = 15;

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
/**
 * How fast a pair of creatures pushes out of each other, in metres per second
 * at full overlap.
 *
 * They are spawned apart, but every one of them paths to the same point — the
 * player — so without this they converge and end up standing inside one another.
 * Nothing in `collides()` ever looked at another creature; it only knows walls.
 *
 * Deliberately a push and not a wall. If creatures blocked each other outright,
 * the first two into a corridor would cork it and everything behind would be
 * stuck forever, which turns a horde into a queue and makes being surrounded
 * *safer*. So they crowd shoulder to shoulder and can still squeeze past when
 * the geometry demands it.
 *
 * The number is set by what it has to beat. A crowd converging on the player is
 * pressing inward at the walk speed the whole time, so the resting gap is where
 * the push balances that, not where the bodies stop touching. Ten zombies
 * dropped on one spot and left to press in settle 0.30m apart at 4 and 0.44-0.65
 * at 7, against the 0.90 they would want in open ground — 7 is where a crowd
 * reads as a crowd instead of a smear, and they still reach the player.
 */
export const CREATURE_PUSH = 7;

export const CREATURE_DRAW_DISTANCE = 30;
/** Top turn rate in rad/s, so creatures rotate rather than snap. */
export const TURN_RATE = 6.0;
/** Seconds the corpse lingers after the death animation ends. */
export const CORPSE_LINGER = 1.5;
/** Per-creature speed multiplier range, so the horde does not move as one body. */
export const SPEED_VARIANCE: readonly [number, number] = [0.85, 1.15];
/** Per-creature scale multiplier range. */
export const SCALE_VARIANCE: readonly [number, number] = [0.93, 1.08];
