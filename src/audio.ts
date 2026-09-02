import type { CreatureKey } from './types';

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
 * Opens the audio context on the first user gesture (browser autoplay policy).
 * The ambience is a low drone plus band-passed noise.
 */
export function initAudio(): void {
  if (audio) return;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();

  const master = ctx.createGain();
  master.gain.value = 0.4;
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

export function sfxCreature(_key: CreatureKey, vol: number): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;

  // Hoarse groan: a sawtooth shaved down by a low-pass, wavering with vibrato.
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f0 = 70 + Math.random() * 50;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * 0.6, t + 0.9);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(600, t);
  lp.frequency.linearRampToValueAtTime(150, t + 1);

  const g = ctx.createGain();
  env(g, t, 0.15, 0.35 * vol, 1.0);

  const v = ctx.createOscillator();
  v.frequency.value = 9;
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
