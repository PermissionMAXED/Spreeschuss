// Procedurally generated Spreeschuss logo (canvas only, no external assets).
// Crosshair-in-shield mark with a Spree "river" cut. Renders at device pixel
// ratio so it stays crisp on high-DPI screens.
export function makeLogoCanvas(size = 320) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;

  // --- ambient glow behind the mark
  const glow = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.52);
  glow.addColorStop(0, 'rgba(67,183,199,0.38)');
  glow.addColorStop(0.6, 'rgba(67,183,199,0.10)');
  glow.addColorStop(1, 'rgba(10,20,30,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const hexPath = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  // --- hex shield body
  const R = size * 0.38;
  hexPath(R);
  const body = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  body.addColorStop(0, '#122a3d');
  body.addColorStop(0.55, '#0c1d2c');
  body.addColorStop(1, '#1d4152');
  ctx.fillStyle = body;
  ctx.fill();

  // Spree river: a soft diagonal band across the shield interior.
  ctx.save();
  hexPath(R * 0.96);
  ctx.clip();
  const band = ctx.createLinearGradient(cx - R, cy + R * 0.55, cx + R, cy - R * 0.55);
  band.addColorStop(0, 'rgba(67,183,199,0)');
  band.addColorStop(0.5, 'rgba(67,183,199,0.30)');
  band.addColorStop(1, 'rgba(67,183,199,0)');
  ctx.fillStyle = band;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 7);
  ctx.fillRect(-R * 1.4, -R * 0.16, R * 2.8, R * 0.32);
  // thin bright core line of the river
  ctx.fillStyle = 'rgba(127,224,255,0.5)';
  ctx.fillRect(-R * 1.4, -size * 0.006, R * 2.8, size * 0.012);
  ctx.restore();
  ctx.restore();

  // --- double shield stroke (outer bold, inner hairline)
  ctx.lineJoin = 'round';
  hexPath(R);
  ctx.lineWidth = size * 0.022;
  ctx.strokeStyle = '#43b7c7';
  ctx.shadowColor = 'rgba(67,183,199,0.55)';
  ctx.shadowBlur = size * 0.04;
  ctx.stroke();
  ctx.shadowBlur = 0;
  hexPath(R * 0.88);
  ctx.lineWidth = size * 0.006;
  ctx.strokeStyle = 'rgba(127,224,255,0.35)';
  ctx.stroke();

  // corner rivets on the outer hex
  ctx.fillStyle = '#7fe0ff';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, size * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- crosshair: four ticks with flared tips + fine ring
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';

  // fine targeting ring
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.155, 0, Math.PI * 2);
  ctx.lineWidth = size * 0.008;
  ctx.strokeStyle = 'rgba(255,209,102,0.45)';
  ctx.stroke();
  // ring tick marks at 45°
  ctx.strokeStyle = 'rgba(255,209,102,0.7)';
  ctx.lineWidth = size * 0.008;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (Math.PI / 2) * i;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * size * 0.135, Math.sin(a) * size * 0.135);
    ctx.lineTo(Math.cos(a) * size * 0.175, Math.sin(a) * size * 0.175);
    ctx.stroke();
  }

  // main crosshair arms
  const gap = size * 0.055;
  const len = size * 0.155;
  ctx.strokeStyle = '#ffd166';
  ctx.shadowColor = 'rgba(255,209,102,0.6)';
  ctx.shadowBlur = size * 0.025;
  const arm = (dx, dy) => {
    ctx.beginPath();
    ctx.lineWidth = size * 0.022;
    ctx.moveTo(dx * gap, dy * gap);
    ctx.lineTo(dx * (gap + len), dy * (gap + len));
    ctx.stroke();
    // flared tip
    ctx.beginPath();
    ctx.lineWidth = size * 0.036;
    ctx.moveTo(dx * (gap + len * 0.72), dy * (gap + len * 0.72));
    ctx.lineTo(dx * (gap + len), dy * (gap + len));
    ctx.stroke();
  };
  arm(0, -1); arm(0, 1); arm(-1, 0); arm(1, 0);
  ctx.shadowBlur = 0;

  // center dot with white core
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.030, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5a4a';
  ctx.shadowColor = 'rgba(255,90,74,0.8)';
  ctx.shadowBlur = size * 0.03;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(-size * 0.008, -size * 0.008, size * 0.010, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();

  return c;
}

export function logoDataURL(size = 320) {
  return makeLogoCanvas(size).toDataURL('image/png');
}
