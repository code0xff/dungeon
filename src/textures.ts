import * as THREE from 'three';
import { context2d } from './dom';

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, context2d(c)];
}

function wrapped(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(x: CanvasRenderingContext2D, n: number, dark: number, light: number): void {
  for (let i = 0; i < n; i++) {
    x.fillStyle = Math.random() < 0.6 ? `rgba(0,0,0,${dark})` : `rgba(200,200,190,${light})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
}

function stoneBrickTexture(): THREE.CanvasTexture {
  const [c, x] = canvas2d(256);
  x.fillStyle = '#22242a';
  x.fillRect(0, 0, 256, 256);
  const rows = 6, bh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    let bx = -(r % 2) * 40;
    while (bx < 256) {
      const bw = 55 + Math.random() * 45;
      x.fillStyle = `hsl(${210 + Math.random() * 20}, ${6 + Math.random() * 6}%, ${13 + Math.random() * 7}%)`;
      x.fillRect(bx + 2, r * bh + 2, bw - 4, bh - 4);
      x.fillStyle = 'rgba(220,220,230,0.05)';
      x.fillRect(bx + 2, r * bh + 2, bw - 4, 2);
      x.fillStyle = 'rgba(0,0,0,0.45)';
      x.fillRect(bx + 2, r * bh + bh - 7, bw - 4, 5);
      bx += bw;
    }
  }
  // Moss along the bottom
  for (let i = 0; i < 70; i++) {
    const py = 120 + Math.random() * 136, px = Math.random() * 256, r = 6 + Math.random() * 16;
    x.fillStyle = `hsla(${95 + Math.random() * 30}, 35%, ${12 + Math.random() * 8}%, ${0.25 + Math.random() * 0.35})`;
    x.beginPath();
    x.ellipse(px, py, r, r * 0.6, Math.random() * 3, 0, Math.PI * 2);
    x.fill();
  }
  // Blood running down
  for (let i = 0; i < 4; i++) {
    const px = Math.random() * 256, py = Math.random() * 120, len = 40 + Math.random() * 110;
    const grd = x.createLinearGradient(0, py, 0, py + len);
    grd.addColorStop(0, 'rgba(70,8,8,0.7)');
    grd.addColorStop(1, 'rgba(70,8,8,0)');
    x.fillStyle = grd;
    x.fillRect(px, py, 3 + Math.random() * 4, len);
    x.fillStyle = 'rgba(60,6,6,0.75)';
    x.beginPath();
    x.ellipse(px + 3, py, 7, 5, 0, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 10; i++) {
    x.fillStyle = 'rgba(0,0,0,0.18)';
    x.fillRect(Math.random() * 256, 0, 2 + Math.random() * 6, 256);
  }
  noise(x, 3200, 0.14, 0.04);
  return wrapped(c);
}

function cobbleTexture(): THREE.CanvasTexture {
  const [c, x] = canvas2d(256);
  x.fillStyle = '#0d0f12';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 240; i++) {
    const px = Math.random() * 256, py = Math.random() * 256, r = 7 + Math.random() * 12;
    x.fillStyle = `hsl(${205 + Math.random() * 25}, ${5 + Math.random() * 6}%, ${8 + Math.random() * 6}%)`;
    x.beginPath();
    x.ellipse(px, py, r, r * (0.7 + Math.random() * 0.3), Math.random() * Math.PI, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = 'rgba(200,205,220,0.045)';
    x.beginPath();
    x.ellipse(px - r * 0.2, py - r * 0.25, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 8; i++) {
    const px = Math.random() * 256, py = Math.random() * 256, r = 14 + Math.random() * 30;
    x.fillStyle = Math.random() < 0.4 ? 'rgba(50,6,6,0.35)' : 'rgba(0,0,0,0.35)';
    x.beginPath();
    x.ellipse(px, py, r, r * 0.7, Math.random() * 3, 0, Math.PI * 2);
    x.fill();
  }
  noise(x, 2400, 0.16, 0.03);
  return wrapped(c);
}

function woodTexture(lightness: number): THREE.CanvasTexture {
  const [c, x] = canvas2d(128);
  x.fillStyle = `hsl(25, 18%, ${lightness}%)`;
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 28; i++) {
    x.strokeStyle = `hsla(${22 + Math.random() * 10}, 18%, ${lightness + (Math.random() * 10 - 6)}%, 0.75)`;
    x.lineWidth = 2 + Math.random() * 4;
    const y = Math.random() * 128;
    x.beginPath();
    x.moveTo(0, y);
    x.bezierCurveTo(40, y + (Math.random() * 8 - 4), 90, y + (Math.random() * 8 - 4), 128, y);
    x.stroke();
  }
  noise(x, 700, 0.2, 0.03);
  return wrapped(c);
}

// Fallbacks for when no PBR textures are present. Drawn once at module load.
export const wallTex = stoneBrickTexture();
export const floorTex = cobbleTexture();
export const ceilTex = woodTexture(9);
export const chestTex = woodTexture(16);

// Floor and ceiling are single large planes sized to the dungeon, and the
// dungeon changes size every stage — so buildGeometry() sets the repeat from the
// grid it just built. Setting it here would bake in one stage's dimensions.
