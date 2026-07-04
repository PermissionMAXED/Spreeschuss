// Procedurally generated Spreeschuss logo (canvas) — returns a data URL and
// can render into a container. Crosshair + bullet + wordmark theme.
export function makeLogoCanvas(size = 320) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // Background glow ring
  const grd = ctx.createRadialGradient(cx, cy, 10, cx, cy, size / 2);
  grd.addColorStop(0, 'rgba(67,183,199,0.35)');
  grd.addColorStop(1, 'rgba(10,20,30,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);

  // Hex shield
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  const r = size * 0.36;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const shieldGrad = ctx.createLinearGradient(-r, -r, r, r);
  shieldGrad.addColorStop(0, '#0f2233');
  shieldGrad.addColorStop(1, '#1c3a4a');
  ctx.fillStyle = shieldGrad;
  ctx.fill();
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = '#43b7c7';
  ctx.stroke();

  // Crosshair
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = size * 0.016;
  const g = size * 0.06;
  const len = size * 0.16;
  ctx.beginPath();
  ctx.moveTo(0, -g); ctx.lineTo(0, -g - len);
  ctx.moveTo(0, g); ctx.lineTo(0, g + len);
  ctx.moveTo(-g, 0); ctx.lineTo(-g - len, 0);
  ctx.moveTo(g, 0); ctx.lineTo(g + len, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.03, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5a4a';
  ctx.fill();
  ctx.restore();

  return c;
}

export function logoDataURL(size = 320) {
  return makeLogoCanvas(size).toDataURL('image/png');
}
