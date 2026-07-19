import type { RandomSource } from "../../core/contracts/rng";

export type CannonDifficulty = "picnic" | "breezy" | "blustery";
export type CannonPhase = "ready" | "aiming" | "flying" | "paused" | "finished";
export type CannonTargetKind = "hay" | "can" | "gopher" | "pinata";

export interface CannonPoint {
  readonly x: number;
  readonly y: number;
}

export interface CannonTarget {
  readonly id: string;
  readonly kind: CannonTargetKind;
  x: number;
  y: number;
  readonly baseX: number;
  readonly radius: number;
  readonly maxHp: number;
  hp: number;
  active: boolean;
  wobble: number;
}

export interface CannonCloud {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly bouncePower: number;
}

export interface CarrotProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  bounces: number;
  flightTime: number;
  hitIds: string[];
  cloudHitIds: string[];
  trail: CannonPoint[];
}

export interface CannonState {
  phase: CannonPhase;
  readonly difficulty: CannonDifficulty;
  shotsRemaining: number;
  shotNumber: number;
  elapsed: number;
  stepRemainder: number;
  score: number;
  bestShot: number;
  currentShotScore: number;
  multiHit: number;
  bestMultiHit: number;
  totalHits: number;
  targetsCleared: number;
  totalBounceBonus: number;
  cloudRicochets: number;
  readonly parShots: number;
  parBonus: number;
  wind: number;
  readonly winds: number[];
  projectile: CarrotProjectile | null;
  targets: CannonTarget[];
  readonly clouds: readonly CannonCloud[];
  message: string;
}

const CANNON = { x: 12, y: 55 } as const;
const FLOOR_Y = 62;
const GRAVITY = 18;
const SHOT_COUNT = 10;
const PAR_SHOTS: Readonly<Record<CannonDifficulty, number>> = {
  picnic: 3,
  breezy: 5,
  blustery: 7,
};
export const CANNON_PAR_BONUS_PER_SHOT = 250;

const CLOUDS: Readonly<Record<CannonDifficulty, readonly CannonCloud[]>> = {
  picnic: [
    { id: "cloud-a", x: 30, y: 8, radiusX: 7, radiusY: 3.1, bouncePower: 0.82 },
  ],
  breezy: [
    { id: "cloud-a", x: 30, y: 8, radiusX: 7, radiusY: 3.1, bouncePower: 0.82 },
    { id: "cloud-b", x: 62, y: 25, radiusX: 8, radiusY: 3.5, bouncePower: 0.88 },
  ],
  blustery: [
    { id: "cloud-a", x: 28, y: 10, radiusX: 7, radiusY: 3.1, bouncePower: 0.86 },
    { id: "cloud-b", x: 53, y: 29, radiusX: 8, radiusY: 3.6, bouncePower: 0.92 },
    { id: "cloud-c", x: 82, y: 21, radiusX: 7, radiusY: 3.2, bouncePower: 0.9 },
  ],
};

/** A stable, switch-friendly Picnic solution used by model and accessibility tests. */
export const PICNIC_CLEAR_SEQUENCE: readonly CannonPoint[] = [
  { x: 16, y: -13 },
  { x: 6, y: -18 },
] as const;

const TARGET_POINTS: Readonly<Record<CannonTargetKind, number>> = {
  hay: 80,
  can: 130,
  gopher: 190,
  pinata: 350,
};

function windForDifficulty(difficulty: CannonDifficulty, rng: RandomSource): number {
  if (difficulty === "picnic") return 0;
  const strength = difficulty === "breezy" ? 2.2 : 4.1;
  const sampled = (rng.next() * 2 - 1) * strength;
  return Math.abs(sampled) < 0.35 ? (sampled < 0 ? -0.35 : 0.35) : sampled;
}

function makeTargets(difficulty: CannonDifficulty, rng: RandomSource): CannonTarget[] {
  const jitter = (): number => difficulty === "picnic" ? 0 : (rng.next() - 0.5) * 2.8;
  const targets: CannonTarget[] = [
    { id: "hay-a", kind: "hay", x: 43 + jitter(), y: 56, baseX: 43, radius: 4.2, maxHp: 1, hp: 1, active: true, wobble: 0 },
    { id: "can-a", kind: "can", x: 57 + jitter(), y: 57.4, baseX: 57, radius: 2.1, maxHp: 1, hp: 1, active: true, wobble: 0 },
    { id: "can-b", kind: "can", x: 62 + jitter(), y: 57.4, baseX: 62, radius: 2.1, maxHp: 1, hp: 1, active: true, wobble: 0 },
    { id: "gopher-a", kind: "gopher", x: 72 + jitter(), y: 55.5, baseX: 72, radius: 3, maxHp: 1, hp: 1, active: true, wobble: 0 },
    { id: "pinata-a", kind: "pinata", x: 78 + jitter(), y: 43, baseX: 78, radius: 5, maxHp: 2, hp: 2, active: true, wobble: 0 },
  ];
  if (difficulty !== "picnic") {
    targets.push(
      { id: "hay-b", kind: "hay", x: 78 + jitter(), y: 56, baseX: 78, radius: 4.2, maxHp: 1, hp: 1, active: true, wobble: 0 },
      { id: "can-c", kind: "can", x: 49 + jitter(), y: 49.5, baseX: 49, radius: 2.1, maxHp: 1, hp: 1, active: true, wobble: 0 },
    );
  }
  if (difficulty === "blustery") {
    targets.push(
      { id: "gopher-b", kind: "gopher", x: 91 + jitter(), y: 55.5, baseX: 91, radius: 3, maxHp: 1, hp: 1, active: true, wobble: 1.7 },
      { id: "can-d", kind: "can", x: 68 + jitter(), y: 44, baseX: 68, radius: 2.1, maxHp: 1, hp: 1, active: true, wobble: 0 },
    );
  }
  return targets;
}

export function createCannonState(difficulty: CannonDifficulty, rng: RandomSource): CannonState {
  const winds = Array.from({ length: SHOT_COUNT }, () => windForDifficulty(difficulty, rng));
  return {
    phase: "ready",
    difficulty,
    shotsRemaining: SHOT_COUNT,
    shotNumber: 0,
    elapsed: 0,
    stepRemainder: 0,
    score: 0,
    bestShot: 0,
    currentShotScore: 0,
    multiHit: 0,
    bestMultiHit: 0,
    totalHits: 0,
    targetsCleared: 0,
    totalBounceBonus: 0,
    cloudRicochets: 0,
    parShots: PAR_SHOTS[difficulty],
    parBonus: 0,
    wind: winds[0] ?? 0,
    winds,
    projectile: null,
    targets: makeTargets(difficulty, rng),
    clouds: CLOUDS[difficulty],
    message: "Drag to aim, or use the arrow controls!",
  };
}

export function beginCannon(state: CannonState): void {
  if (state.phase === "ready") state.phase = "aiming";
}

export function pauseCannon(state: CannonState): void {
  if (state.phase === "aiming" || state.phase === "flying") state.phase = "paused";
}

export function resumeCannon(state: CannonState): void {
  if (state.phase !== "paused") return;
  state.phase = state.projectile ? "flying" : "aiming";
}

export function launchVelocity(dragX: number, dragY: number): CannonPoint {
  const length = Math.hypot(dragX, dragY);
  const limited = Math.min(18, Math.max(3, length));
  const scale = length > 0 ? limited / length : 0;
  return {
    x: Math.max(4, dragX * scale * 2.15),
    y: dragY * scale * 2.15,
  };
}

export function predictTrajectory(
  dragX: number,
  dragY: number,
  wind: number,
  steps = 30,
): CannonPoint[] {
  const velocity = launchVelocity(dragX, dragY);
  const points: CannonPoint[] = [];
  const interval = 0.11;
  for (let index = 0; index < steps; index += 1) {
    const time = index * interval;
    const x = CANNON.x + velocity.x * time + wind * time * time * 0.5;
    const y = CANNON.y + velocity.y * time + GRAVITY * time * time * 0.5;
    if (x > 101 || y > FLOOR_Y + 1) break;
    points.push({ x, y });
  }
  return points;
}

export function launchCarrot(state: CannonState, dragX: number, dragY: number): boolean {
  if (state.phase !== "aiming" || state.shotsRemaining <= 0) return false;
  const velocity = launchVelocity(dragX, dragY);
  state.shotsRemaining -= 1;
  state.shotNumber += 1;
  state.currentShotScore = 0;
  state.multiHit = 0;
  state.projectile = {
    x: CANNON.x,
    y: CANNON.y,
    vx: velocity.x,
    vy: velocity.y,
    rotation: 0,
    bounces: 0,
    flightTime: 0,
    hitIds: [],
    cloudHitIds: [],
    trail: [],
  };
  state.phase = "flying";
  state.message = state.wind === 0 ? "Carrot away!" : `Wind ${state.wind > 0 ? "→" : "←"} — carrot away!`;
  return true;
}

export interface CannonHitScore {
  readonly points: number;
  readonly multiplier: number;
  readonly destroyed: boolean;
}

export function scoreTargetHit(
  state: CannonState,
  target: CannonTarget,
  projectile: CarrotProjectile,
): CannonHitScore {
  if (!target.active || projectile.hitIds.includes(target.id)) {
    return { points: 0, multiplier: 1, destroyed: false };
  }
  projectile.hitIds.push(target.id);
  state.multiHit += 1;
  state.bestMultiHit = Math.max(state.bestMultiHit, state.multiHit);
  state.totalHits += 1;
  const multiplier = 1 + Math.max(0, state.multiHit - 1) * 0.5;
  const bounceBonus = projectile.bounces * 35;
  const points = Math.round(TARGET_POINTS[target.kind] * multiplier + bounceBonus);
  target.hp -= 1;
  target.active = target.hp > 0;
  if (!target.active) state.targetsCleared += 1;
  target.wobble = 0.32;
  state.score += points;
  state.currentShotScore += points;
  state.totalBounceBonus += bounceBonus;
  state.message = target.kind === "pinata" && target.active
    ? `PIÑATA DAMAGED · ${target.hp}/${target.maxHp} HP · +${points}`
    : state.multiHit > 1
      ? `${state.multiHit}× MULTI-HIT! +${points}`
      : `${target.kind.toUpperCase()} +${points}`;
  return { points, multiplier, destroyed: !target.active };
}

function collideTargets(state: CannonState, projectile: CarrotProjectile): void {
  for (const target of state.targets) {
    if (!target.active || projectile.hitIds.includes(target.id)) continue;
    const distance = Math.hypot(projectile.x - target.x, projectile.y - target.y);
    if (distance > target.radius + 1.35) continue;
    scoreTargetHit(state, target, projectile);
    const nx = (projectile.x - target.x) / Math.max(distance, 0.01);
    const ny = (projectile.y - target.y) / Math.max(distance, 0.01);
    const dot = projectile.vx * nx + projectile.vy * ny;
    projectile.vx = (projectile.vx - 2 * dot * nx) * 0.72;
    projectile.vy = (projectile.vy - 2 * dot * ny) * 0.72 - 1.2;
  }
}

/** Reflects a carrot once from each soft cloud, making bank shots deterministic. */
export function applyCloudRicochet(
  state: CannonState,
  cloud: CannonCloud,
  projectile: CarrotProjectile,
): boolean {
  if (projectile.cloudHitIds.includes(cloud.id)) return false;
  const normalizedX = (projectile.x - cloud.x) / cloud.radiusX;
  const normalizedY = (projectile.y - cloud.y) / cloud.radiusY;
  if (normalizedX * normalizedX + normalizedY * normalizedY > 1) return false;
  const normalLength = Math.max(0.001, Math.hypot(normalizedX, normalizedY));
  const nx = normalizedX / normalLength;
  const ny = normalizedY / normalLength;
  const dot = projectile.vx * nx + projectile.vy * ny;
  if (dot >= 0) return false;
  projectile.cloudHitIds.push(cloud.id);
  projectile.vx = (projectile.vx - 2 * dot * nx) * cloud.bouncePower;
  projectile.vy = (projectile.vy - 2 * dot * ny) * cloud.bouncePower + 0.8;
  projectile.x = cloud.x + nx * (cloud.radiusX + 1.4);
  projectile.y = cloud.y + ny * (cloud.radiusY + 1.4);
  projectile.bounces += 1;
  state.cloudRicochets += 1;
  state.message = "Cloud ricochet! Bank the next target.";
  return true;
}

function collideClouds(state: CannonState, projectile: CarrotProjectile): void {
  for (const cloud of state.clouds) applyCloudRicochet(state, cloud, projectile);
}

function finishShot(state: CannonState): void {
  state.bestShot = Math.max(state.bestShot, state.currentShotScore);
  state.projectile = null;
  const cleared = state.targets.every((target) => !target.active);
  if (cleared && state.parBonus === 0 && state.shotNumber <= state.parShots) {
    state.parBonus = (state.parShots - state.shotNumber + 1) * CANNON_PAR_BONUS_PER_SHOT;
    state.score += state.parBonus;
  }
  if (cleared || state.shotsRemaining <= 0) {
    state.phase = "finished";
    state.message = cleared
      ? state.parBonus > 0
        ? `Range cleared under par! +${state.parBonus}`
        : "Picnic range cleared!"
      : "Ten carrots fired!";
  } else {
    state.phase = "aiming";
    state.wind = state.winds[state.shotNumber] ?? 0;
    state.message = state.wind === 0
      ? "Aim the next carrot"
      : `New wind: ${state.wind > 0 ? "→" : "←"} ${Math.abs(state.wind).toFixed(1)}`;
  }
}

function updateTargets(state: CannonState, deltaSeconds: number): void {
  for (const target of state.targets) {
    target.wobble = Math.max(0, target.wobble - deltaSeconds);
    if (target.kind === "gopher" && target.active) {
      target.x = target.baseX + Math.sin(state.elapsed * 2.4 + target.id.length + target.wobble * 4) * 1.35;
    }
  }
}

export function updateCannon(state: CannonState, deltaSeconds: number): void {
  if ((state.phase !== "flying" && state.phase !== "aiming") || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return;
  }
  const step = 1 / 120;
  state.stepRemainder += Math.min(deltaSeconds, 0.5);
  while (state.stepRemainder >= step - 0.000_000_001) {
    state.stepRemainder = Math.max(0, state.stepRemainder - step);
    state.elapsed += step;
    updateTargets(state, step);
    if (state.phase !== "flying" || !state.projectile) continue;
    const projectile = state.projectile;
    projectile.flightTime += step;
    projectile.vx += state.wind * step;
    projectile.vy += GRAVITY * step;
    projectile.x += projectile.vx * step;
    projectile.y += projectile.vy * step;
    projectile.rotation += Math.hypot(projectile.vx, projectile.vy) * step * 0.08;
    if (projectile.trail.length === 0 || projectile.flightTime * 30 >= projectile.trail.length + 1) {
      projectile.trail.push({ x: projectile.x, y: projectile.y });
      if (projectile.trail.length > 18) projectile.trail.shift();
    }

    collideTargets(state, projectile);
    collideClouds(state, projectile);

    if (projectile.y >= FLOOR_Y && projectile.vy > 0) {
      projectile.y = FLOOR_Y;
      projectile.vy *= -0.58;
      projectile.vx *= 0.82;
      projectile.bounces += 1;
      state.message = projectile.bounces > 1 ? `${projectile.bounces}× BOUNCE BONUS` : "Boing!";
    }
    if ((projectile.x <= 1 && projectile.vx < 0) || (projectile.x >= 99 && projectile.vx > 0)) {
      projectile.x = Math.min(99, Math.max(1, projectile.x));
      projectile.vx *= -0.66;
      projectile.bounces += 1;
    }

    const speed = Math.hypot(projectile.vx, projectile.vy);
    if (
      projectile.flightTime >= 8
      || projectile.y > 74
      || projectile.x < -8
      || projectile.x > 108
      || (projectile.bounces > 0 && speed < 3.2)
      || projectile.bounces > 5
    ) {
      finishShot(state);
    }
  }
  if (state.stepRemainder < 0.000_000_001) state.stepRemainder = 0;
}

export function finishCannon(state: CannonState, message = "Cannon packed away"): void {
  state.phase = "finished";
  state.stepRemainder = 0;
  state.projectile = null;
  state.message = message;
}

export const CANNON_ORIGIN = CANNON;
export const CANNON_FLOOR_Y = FLOOR_Y;
