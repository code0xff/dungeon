import { MASTER_VOLUME } from './config';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

interface Audio {
  ctx: AudioContext;
  master: GainNode;
  noiseBuf: AudioBuffer;
  /** Time of the last heartbeat, in seconds. Used to pace the next one. */
  lastBeat: number;
}

let audio: Audio | null = null;

/**
 * Muting, remembered across runs in its own localStorage key.
 *
 * Not part of `progress`, which is wiped back to defaults on death — a sound
 * preference has nothing to do with the run and should not be undone by dying.
 */
const MUTE_KEY = 'dungeon.muted.v1';

let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // Storage unavailable in some privacy modes. Sound on is the right default.
    return false;
  }
})();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // The setting still applies to this session, it just will not be remembered.
  }
  // The gain node, not ctx.suspend(): the drone and its slow filter LFO keep
  // running, so unmuting drops back into the ambience rather than restarting it.
  if (audio) audio.master.gain.value = value ? 0 : MASTER_VOLUME;
}

/**
 * Opens the audio context on the first user gesture (browser autoplay policy).
 * The ambience is a low drone plus band-passed noise.
 */
export function initAudio(): void {
  if (audio) return;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();

  const master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_VOLUME;
  master.connect(ctx.destination);

  // ---- Low drone ----
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 130;
  lp.Q.value = 5;
  const dg = ctx.createGain();
  dg.gain.value = 0.45;
  for (const [type, f] of [['sawtooth', 36], ['sine', 54.5], ['triangle', 72.8]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(lp);
    o.start();
  }
  lp.connect(dg);
  dg.connect(master);

  // Drift the filter cutoff very slowly so the ambience seems to breathe.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 55;
  lfo.connect(lfoG);
  lfoG.connect(lp.frequency);
  lfo.start();

  // ---- Wind noise (the buffer is reused by the sound effects) ----
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const ns = ctx.createBufferSource();
  ns.buffer = buf;
  ns.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 300;
  nf.Q.value = 0.5;
  const ng = ctx.createGain();
  ng.gain.value = 0.04;
  ns.connect(nf);
  nf.connect(ng);
  ng.connect(master);
  ns.start();

  const nlfo = ctx.createOscillator();
  nlfo.frequency.value = 0.11;
  const nlfoG = ctx.createGain();
  nlfoG.gain.value = 0.025;
  nlfo.connect(nlfoG);
  nlfoG.connect(ng.gain);
  nlfo.start();

  audio = { ctx, master, noiseBuf: buf, lastBeat: 0 };
}

export function audioReady(): boolean {
  return audio !== null;
}

/** Time of the last heartbeat, in seconds. */
export function lastBeat(): number {
  return audio ? audio.lastBeat : 0;
}
export function setLastBeat(t: number): void {
  if (audio) audio.lastBeat = t;
}

/** Attack-release envelope with exponential decay. */
function env(g: GainNode, t: number, attack: number, peak: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

export function sfxHeartbeat(strength: number): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  // Two beats: strong then weak
  for (const [dt, amp] of [[0, 1], [0.17, 0.6]] as const) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(62, t + dt);
    o.frequency.exponentialRampToValueAtTime(28, t + dt + 0.18);
    const g = ctx.createGain();
    env(g, t + dt, 0.02, 0.8 * strength * amp, 0.24);
    o.connect(g);
    g.connect(master);
    o.start(t + dt);
    o.stop(t + dt + 0.3);
  }
}

/**
 * A groan, pitched by `voice` (see CreatureType). Everything scales with it: the
 * fundamental, the filter cutoff and the vibrato rate, because dropping the pitch
 * alone gives a slowed-down zombie rather than a bigger animal.
 *
 * Sound arrives before sight down a corridor, so this is the player's first
 * warning of which creature is ahead — the two pitches have to be far apart.
 */
export function sfxCreature(voice: number, vol: number): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;

  // Hoarse groan: a sawtooth shaved down by a low-pass, wavering with vibrato.
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f0 = (70 + Math.random() * 50) * voice;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * 0.6, t + 0.9);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(600 * voice, t);
  lp.frequency.linearRampToValueAtTime(150 * voice, t + 1);

  const g = ctx.createGain();
  env(g, t, 0.15, 0.35 * vol, 1.0);

  const v = ctx.createOscillator();
  v.frequency.value = 9 * voice;
  const vg = ctx.createGain();
  vg.gain.value = 6;
  v.connect(vg);
  vg.connect(o.frequency);
  v.start(t);
  v.stop(t + 1.6);

  o.connect(lp);
  lp.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 1.6);
}

/** The dodge: a short downward whoosh, so it does not read as another sword swing. */
export function sfxDash(): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  // Falling, where the sword's sweep rises — the ear tells them apart instantly.
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.exponentialRampToValueAtTime(320, t + 0.18);
  const g = ctx.createGain();
  env(g, t, 0.02, 0.3, 0.22);
  s.connect(bp);
  bp.connect(g);
  g.connect(master);
  s.start(t);
  s.stop(t + 0.3);
}

export function sfxSwing(): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(600, t);
  bp.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
  const g = ctx.createGain();
  env(g, t, 0.04, 0.35, 0.2);
  s.connect(bp);
  bp.connect(g);
  g.connect(master);
  s.start(t);
  s.stop(t + 0.25);
}

/**
 * The extra weight under a lunge, layered over the ordinary sfxHit().
 *
 * A pitch drop rather than a louder version of the same sound: the whole point
 * of the cue is that the player can tell a lunge landed without looking at
 * anything, and volume alone is not distinguishable mid-fight.
 */
export function sfxLunge(): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.22);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const g = ctx.createGain();
  env(g, t, 0.01, 0.45, 0.3);
  o.connect(lp);
  lp.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.32);
}

/**
 * A parry: the bright ring of a blow turned on a shield rim.
 *
 * Deliberately the only *pleasant* sound in the game. Everything else here is a
 * thud, a groan or a bang — this is the one that says you did something right,
 * and it has to be recognisable through a fight without looking at the screen.
 * Two partials a fifth apart give it a struck-metal ring rather than a beep.
 */
export function sfxParry(): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  for (const [f, amp] of [[1180, 0.3], [1770, 0.18]] as const) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 1);
  }
  // The scrape of the blow sliding off, under the ring.
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(3200, t);
  bp.frequency.exponentialRampToValueAtTime(1100, t + 0.1);
  const sg = ctx.createGain();
  env(sg, t, 0.004, 0.42, 0.13);
  s.connect(bp);
  bp.connect(sg);
  sg.connect(master);
  s.start(t);
  s.stop(t + 0.16);
}

/** low=true is the duller thud of the player taking the hit. */
export function sfxHit(low: boolean): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(low ? 90 : 160, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.2);

  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.25, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  s.connect(lp);
  lp.connect(g2);
  g2.connect(master);
  s.start(t);
  s.stop(t + 0.12);
}

/** The creak of a chest lid. */
/**
 * A trap springing: a bright metallic clatter that rings on.
 *
 * Deliberately the longest and brightest sound in the game. Every other noise
 * here is a thing the player chose to do; this is the one that happens *to*
 * them, and it has to land as "everything just heard that" rather than as a hit
 * marker. Two detuned partials give it the beating a struck bell has — a single
 * oscillator read as a UI beep.
 */
export function sfxTrap(): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  for (const [f, amp] of [[880, 0.32], [1319, 0.2], [1970, 0.12]] as const) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    // Detuned a few cents so the partials beat against each other as they decay.
    o.frequency.setValueAtTime(f * (1 + (Math.random() - 0.5) * 0.008), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 1.7);
  }
  // The snap of the mechanism itself, under the ring.
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(700, t + 0.12);
  const sg = ctx.createGain();
  env(sg, t, 0.005, 0.5, 0.16);
  s.connect(bp);
  bp.connect(sg);
  sg.connect(master);
  s.start(t);
  s.stop(t + 0.2);
}

export function sfxCreak(): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, t);
  o.frequency.linearRampToValueAtTime(320, t + 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.08, t + 0.1);
  g.gain.linearRampToValueAtTime(0.0001, t + 0.55);
  o.connect(lp);
  lp.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.6);
}

export function sfxPickup(): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  [523, 784].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    env(g, t + i * 0.09, 0.01, 0.12, 0.3);
    o.connect(g);
    g.connect(master);
    o.start(t + i * 0.09);
    o.stop(t + i * 0.09 + 0.35);
  });
}

export function sfxShot(): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;

  // Sharp crack
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(1.0, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  s.connect(hp);
  hp.connect(g);
  g.connect(master);
  s.start(t);
  s.stop(t + 0.15);

  // Low boom plus the dungeon's echo
  const s2 = ctx.createBufferSource();
  s2.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.9);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.9, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  s2.connect(lp);
  lp.connect(g2);
  g2.connect(master);
  s2.start(t);
  s2.stop(t + 1.2);

  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(0.7, t);
  g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g3);
  g3.connect(master);
  o.start(t);
  o.stop(t + 0.55);
}

/** One click per reload step: ramrod, powder, hammer. */
export function sfxReloadStep(i: number): void {
  if (!audio) return;
  const { ctx, master, noiseBuf } = audio;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 4;
  bp.frequency.value = [900, 1800, 600][i % 3];
  const g = ctx.createGain();
  env(g, t, 0.005, 0.3, 0.09);
  s.connect(bp);
  bp.connect(g);
  g.connect(master);
  s.start(t);
  s.stop(t + 0.1);
}
