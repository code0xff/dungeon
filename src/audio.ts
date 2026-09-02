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
  /** 마지막 심장박동 재생 시각(초). 간격 조절용 */
  lastBeat: number;
}

let audio: Audio | null = null;

/**
 * 첫 사용자 입력 때 오디오 컨텍스트를 연다 (브라우저 자동재생 정책).
 * 낮은 드론 + 밴드패스 노이즈로 던전 앰비언스를 만든다.
 */
export function initAudio(): void {
  if (audio) return;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();

  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);

  // ---- 저역 드론 ----
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

  // 필터 컷오프를 아주 느리게 흔들어 숨쉬는 느낌을 준다.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 55;
  lfo.connect(lfoG);
  lfoG.connect(lp.frequency);
  lfo.start();

  // ---- 바람 노이즈 (효과음에서도 재사용하는 버퍼) ----
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

/** 마지막 심장박동 시각(초). */
export function lastBeat(): number {
  return audio ? audio.lastBeat : 0;
}
export function setLastBeat(t: number): void {
  if (audio) audio.lastBeat = t;
}

/** 지수 감쇠 어택-릴리스 엔벨로프. */
function env(g: GainNode, t: number, attack: number, peak: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

export function sfxHeartbeat(strength: number): void {
  if (!audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  // 두 번 뛴다: 강-약
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

  // 목쉰 신음: 톱니파를 저역으로 깎고 비브라토로 떨리게 한다.
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

/** low=true면 플레이어가 맞은 둔탁한 타격. */
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

/** 상자 뚜껑이 삐걱대는 소리. */
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

  // 날카로운 크랙
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

  // 낮은 폭음 + 던전 울림
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

/** 장전 3단계(꽂을대·화약·공이) 각각의 딸깍. */
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
