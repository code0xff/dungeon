import { PERF_WINDOW, RENDER_PIXEL_CAP } from './config';
import { el } from './dom';
import { progress } from './progress';
import { renderer } from './scene';
import { onSettingsChange, setSetting, settings } from './settings';
import { state } from './state';

// The frame-time overlay, for measuring the game on the device it ships to.
//
// Two times are shown and they mean different things. `frame` is the gap
// between frames — what the player feels. `cpu` is how long this script spent
// inside one: the simulation, the skinning and the draw submissions. When frame
// is high and cpu is low the GPU is the bottleneck, and render scale is the
// lever; when cpu is most of the frame, creature count and animation are. The
// worst frame is shown beside the average because a stutter averages away.

const panel = el('perf');
let open = false;
let windowT = 0, frames = 0, cpuSum = 0, worst = 0;
let cpuStart = 0;

function apply(): void {
  open = settings.perfOverlay > 0;
  panel.style.display = open ? 'block' : 'none';
  windowT = frames = cpuSum = worst = 0;
}
apply();
onSettingsChange(apply);

export function togglePerf(): void { setSetting('perfOverlay', open ? 0 : 1); }

/** Called first thing in a frame. */
export function perfBegin(): void {
  if (open) cpuStart = performance.now();
}

/** Called after the frame has been submitted, with that frame's real dt. */
export function perfEnd(dt: number): void {
  if (!open) return;
  frames++;
  windowT += dt;
  cpuSum += performance.now() - cpuStart;
  worst = Math.max(worst, dt);
  if (windowT < PERF_WINDOW) return;

  let alive = 0, drawn = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    alive++;
    if (m.mesh.visible) drawn++;
  }
  const { calls, triangles } = renderer.info.render;
  const ratio = Math.min(devicePixelRatio, RENDER_PIXEL_CAP) * settings.resolution;
  const fps = frames / windowT;
  // Plain text in a <pre>: nothing here is markup, and textContent cannot be
  // tricked into being.
  panel.textContent =
    `${fps.toFixed(0).padStart(3)} fps   frame ${(1000 * windowT / frames).toFixed(1)}ms  worst ${(1000 * worst).toFixed(0)}ms\n`
    + `cpu ${(cpuSum / frames).toFixed(1)}ms\n`
    + `stage ${progress.stage}   creatures ${alive} (${drawn} drawn)\n`
    + `draws ${calls}   tris ${(triangles / 1000).toFixed(0)}k\n`
    + `${renderer.domElement.width}×${renderer.domElement.height} @${ratio.toFixed(2)}`;
  panel.classList.toggle('slow', fps < 50);
  windowT = frames = cpuSum = worst = 0;
}
