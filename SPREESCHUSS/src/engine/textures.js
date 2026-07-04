import * as THREE from 'three';

// Procedural canvas textures so the game needs NO external assets.
const cache = new Map();

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function noise(ctx, size, base, variance) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * variance;
    d[i] = Math.max(0, Math.min(255, base[0] + n));
    d[i + 1] = Math.max(0, Math.min(255, base[1] + n));
    d[i + 2] = Math.max(0, Math.min(255, base[2] + n));
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function tileTexture(colorHex, opts = {}) {
  const key = `tile:${colorHex}:${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key).clone();
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const col = new THREE.Color(colorHex);
  const base = [col.r * 255, col.g * 255, col.b * 255];
  noise(ctx, size, base, opts.grain ?? 22);
  // grid lines
  const tiles = opts.tiles ?? 4;
  ctx.strokeStyle = opts.line ?? 'rgba(0,0,0,0.28)';
  ctx.lineWidth = opts.lineWidth ?? 2;
  const s = size / tiles;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * s, 0);
    ctx.lineTo(i * s, size);
    ctx.moveTo(0, i * s);
    ctx.lineTo(size, i * s);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex.clone();
}

export function skyTexture(top = '#12203a', bottom = '#2a3d63') {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // stars / haze
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size * 0.6, Math.random() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
