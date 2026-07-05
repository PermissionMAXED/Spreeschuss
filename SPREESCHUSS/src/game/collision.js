import * as THREE from 'three';

// AABB collision + raycasting utilities against the static box colliders
// produced by the map builder. The player is modelled as an axis-aligned
// box (feet at pos.y, extending up by `height`, radius `r`).

function overlaps(min, max, box) {
  return (
    box.min.x < max.x && box.max.x > min.x &&
    box.min.y < max.y && box.max.y > min.y &&
    box.min.z < max.z && box.max.z > min.z
  );
}

export function moveAndCollide(colliders, pos, vel, dt, r = 0.35, height = 1.7) {
  const result = { pos: pos.clone(), vel: vel.clone(), onGround: false };
  const p = result.pos;
  const prevFeet = pos.y; // feet height before this move (for land/ceiling classification)

  // Horizontal X
  p.x += result.vel.x * dt;
  resolveAxis(colliders, p, r, height, 'x', result.vel);
  // Horizontal Z
  p.z += result.vel.z * dt;
  resolveAxis(colliders, p, r, height, 'z', result.vel);

  // Vertical Y
  p.y += result.vel.y * dt;
  if (p.y <= 0) {
    p.y = 0;
    if (result.vel.y < 0) result.vel.y = 0;
    result.onGround = true;
  }
  // Land on top of boxes / hit ceilings
  const min = new THREE.Vector3(p.x - r, p.y, p.z - r);
  const max = new THREE.Vector3(p.x + r, p.y + height, p.z + r);
  const STEP = 0.35;
  for (const b of colliders) {
    if (!overlaps(min, max, b)) continue;
    const topOfBox = b.max.y;
    const bottomOfBox = b.min.y;
    if (result.vel.y <= 0 && prevFeet >= topOfBox - STEP) {
      // descending onto the top of a box we were above -> land
      p.y = topOfBox;
      result.vel.y = 0;
      result.onGround = true;
    } else if (result.vel.y > 0 && prevFeet + height <= bottomOfBox + 0.05) {
      // ascending and our head was below the box bottom -> bonk ceiling
      p.y = bottomOfBox - height;
      result.vel.y = 0;
    }
    min.y = p.y; max.y = p.y + height;
  }
  return result;
}

function resolveAxis(colliders, p, r, height, axis, vel) {
  const min = new THREE.Vector3(p.x - r, p.y, p.z - r);
  const max = new THREE.Vector3(p.x + r, p.y + height, p.z + r);
  for (const b of colliders) {
    if (!overlaps(min, max, b)) continue;
    // Skip if the box top is a small step we can stand on (handled by Y pass)
    // Push out along the axis in the direction opposite to motion.
    if (axis === 'x') {
      if (vel.x > 0) p.x = b.min.x - r - 0.001;
      else if (vel.x < 0) p.x = b.max.x + r + 0.001;
      vel.x = 0;
    } else {
      if (vel.z > 0) p.z = b.min.z - r - 0.001;
      else if (vel.z < 0) p.z = b.max.z + r + 0.001;
      vel.z = 0;
    }
    min.set(p.x - r, p.y, p.z - r);
    max.set(p.x + r, p.y + height, p.z + r);
  }
}

// Ray vs AABB (slab method). Returns distance t>0 or null.
export function rayBox(origin, dir, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const o = origin[ax];
    const d = dir[ax];
    const mn = b.min[ax];
    const mx = b.max[ax];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin > 0 ? tmin : tmax;
}

// Distance to first wall along ray; Infinity if none within maxDist.
export function raycastWorld(colliders, origin, dir, maxDist = 500) {
  let best = maxDist;
  for (const b of colliders) {
    const t = rayBox(origin, dir, b);
    if (t !== null && t < best) best = t;
  }
  return best;
}

// Ray vs vertical capsule approximated by a sphere sweep along the segment.
// Returns {t, part} where part is 'head'|'body'|'leg' or null.
export function rayEntity(origin, dir, feet, r = 0.4, height = 1.8) {
  // Model as a cylinder; test the ray against an expanded AABB, then classify by height.
  const b = {
    min: new THREE.Vector3(feet.x - r, feet.y, feet.z - r),
    max: new THREE.Vector3(feet.x + r, feet.y + height, feet.z + r),
  };
  const t = rayBox(origin, dir, b);
  if (t === null || t < 0) return null;
  const hitY = origin.y + dir.y * t;
  const rel = (hitY - feet.y) / height;
  let part = 'body';
  if (rel > 0.82) part = 'head';
  else if (rel < 0.35) part = 'leg';
  return { t, part, point: origin.clone().add(dir.clone().multiplyScalar(t)) };
}
