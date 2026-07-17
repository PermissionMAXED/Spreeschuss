import type { RandomSource } from "../../core/contracts/rng";

export type DeliveryDifficulty = "sunday" | "rush" | "express";
export type DeliveryPhase = "ready" | "playing" | "paused" | "finished";

export interface CityPoint {
  readonly x: number;
  readonly y: number;
  readonly name: string;
}

export interface DeliveryParcel {
  readonly id: number;
  readonly pickup: CityPoint;
  readonly destination: CityPoint;
  carrying: boolean;
  deadline: number;
}

export interface DeliveryCar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  bumpCooldown: number;
}

export interface TrafficCar {
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly color: string;
}

export interface OneWay {
  readonly id: string;
  readonly orientation: "horizontal" | "vertical";
  readonly coordinate: number;
  readonly from: number;
  readonly to: number;
  readonly direction: 1 | -1;
}

export interface DeliveryState {
  phase: DeliveryPhase;
  readonly difficulty: DeliveryDifficulty;
  remaining: number;
  score: number;
  deliveries: number;
  chain: number;
  bestChain: number;
  totalBonusTime: number;
  bestTimeBonus: number;
  bestDeliveryPoints: number;
  bumpCount: number;
  wrongWay: boolean;
  wrongWayTime: number;
  nextParcelId: number;
  car: DeliveryCar;
  inputX: number;
  inputY: number;
  parcel: DeliveryParcel;
  traffic: TrafficCar[];
  message: string;
}

interface DeliveryTuning {
  readonly startTime: number;
  readonly parcelTime: number;
  readonly speed: number;
  readonly traffic: number;
  readonly oneWayAfter: number;
  readonly chainTime: number;
  readonly scoreMultiplier: number;
}

const TUNING: Readonly<Record<DeliveryDifficulty, DeliveryTuning>> = {
  sunday: {
    startTime: 62,
    parcelTime: 24,
    speed: 22,
    traffic: 3,
    oneWayAfter: 4,
    chainTime: 3.4,
    scoreMultiplier: 1,
  },
  rush: {
    startTime: 56,
    parcelTime: 19,
    speed: 24,
    traffic: 5,
    oneWayAfter: 2,
    chainTime: 3,
    scoreMultiplier: 1.25,
  },
  express: {
    startTime: 50,
    parcelTime: 15,
    speed: 26,
    traffic: 7,
    oneWayAfter: 0,
    chainTime: 2.6,
    scoreMultiplier: 1.55,
  },
};

export const CITY_STOPS: readonly CityPoint[] = [
  { x: 16, y: 18, name: "Berry Bakery" },
  { x: 50, y: 18, name: "Cloud Café" },
  { x: 84, y: 18, name: "Tulip Terrace" },
  { x: 16, y: 50, name: "Cozy Corner" },
  { x: 84, y: 50, name: "Button Books" },
  { x: 16, y: 82, name: "Carrot Market" },
  { x: 50, y: 82, name: "Mossy Mail" },
  { x: 84, y: 82, name: "Moon Park" },
] as const;

export const CITY_ONE_WAYS: readonly OneWay[] = [
  { id: "north-east", orientation: "horizontal", coordinate: 18, from: 50, to: 100, direction: 1 },
  { id: "center-west", orientation: "horizontal", coordinate: 50, from: 0, to: 50, direction: -1 },
  { id: "east-south", orientation: "vertical", coordinate: 84, from: 50, to: 100, direction: 1 },
  { id: "west-north", orientation: "vertical", coordinate: 16, from: 0, to: 50, direction: -1 },
] as const;

const TRAFFIC_COLORS = ["#e86f5d", "#6d9fc5", "#e3b64e", "#9473ae", "#62a878"] as const;
const TRAFFIC_SPAWN_CLEARANCE = 7;

function createParcel(
  id: number,
  difficulty: DeliveryDifficulty,
  rng: RandomSource,
  previousDestination?: CityPoint,
): DeliveryParcel {
  const pickupChoices = previousDestination
    ? CITY_STOPS.filter((stop) => stop.name !== previousDestination.name)
    : CITY_STOPS;
  const pickup = rng.pick(pickupChoices);
  const destination = rng.pick(CITY_STOPS.filter((stop) => stop.name !== pickup.name));
  return {
    id,
    pickup,
    destination,
    carrying: false,
    deadline: TUNING[difficulty].parcelTime,
  };
}

function isClearTrafficSpawn(
  traffic: Readonly<Pick<TrafficCar, "x" | "y">>,
  forbidden: readonly CityPoint[],
): boolean {
  return forbidden.every((point) =>
    Math.hypot(traffic.x - point.x, traffic.y - point.y) >= TRAFFIC_SPAWN_CLEARANCE);
}

function createTraffic(
  id: number,
  rng: RandomSource,
  forbidden: readonly CityPoint[],
): TrafficCar {
  let sampled: TrafficCar | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const vertical = rng.next() < 0.5;
    const direction = rng.next() < 0.5 ? -1 : 1;
    const road = rng.pick([16, 50, 84] as const);
    const position = 6 + rng.next() * 88;
    const speed = 7 + rng.next() * 6;
    sampled = {
      id,
      x: vertical ? road + direction * 1.8 : position,
      y: vertical ? position : road - direction * 1.8,
      vx: vertical ? 0 : speed * direction,
      vy: vertical ? speed * direction : 0,
      color: rng.pick(TRAFFIC_COLORS),
    };
    if (isClearTrafficSpawn(sampled, forbidden)) return sampled;
  }

  const fallback = sampled ?? {
    id,
    x: 16,
    y: 6,
    vx: 0,
    vy: 8,
    color: TRAFFIC_COLORS[id % TRAFFIC_COLORS.length] ?? TRAFFIC_COLORS[0],
  };
  for (let offset = 0; offset < 100; offset += 11) {
    const candidate = {
      ...fallback,
      x: fallback.vx === 0 ? fallback.x : (6 + id * 17 + offset) % 88 + 6,
      y: fallback.vy === 0 ? fallback.y : (6 + id * 17 + offset) % 88 + 6,
    };
    if (isClearTrafficSpawn(candidate, forbidden)) return candidate;
  }
  return fallback;
}

export function createDeliveryState(difficulty: DeliveryDifficulty, rng: RandomSource): DeliveryState {
  const tuning = TUNING[difficulty];
  const car = {
    x: 50,
    y: 82,
    vx: 0,
    vy: 0,
    heading: -Math.PI / 2,
    bumpCooldown: 0,
  };
  const parcel = createParcel(1, difficulty, rng);
  const forbiddenSpawns = [
    { x: car.x, y: car.y, name: "Player" },
    parcel.pickup,
    parcel.destination,
  ];
  return {
    phase: "ready",
    difficulty,
    remaining: tuning.startTime,
    score: 0,
    deliveries: 0,
    chain: 0,
    bestChain: 0,
    totalBonusTime: 0,
    bestTimeBonus: 0,
    bestDeliveryPoints: 0,
    bumpCount: 0,
    wrongWay: false,
    wrongWayTime: 0,
    nextParcelId: 2,
    car,
    inputX: 0,
    inputY: 0,
    parcel,
    traffic: Array.from(
      { length: tuning.traffic },
      (_, index) => createTraffic(index + 1, rng, forbiddenSpawns),
    ),
    message: "Follow the parcel pin!",
  };
}

export function beginDelivery(state: DeliveryState): void {
  if (state.phase === "ready") state.phase = "playing";
}

export function pauseDelivery(state: DeliveryState): void {
  if (state.phase === "playing") state.phase = "paused";
}

export function resumeDelivery(state: DeliveryState): void {
  if (state.phase === "paused") state.phase = "playing";
}

export function setDeliveryInput(state: DeliveryState, x: number, y: number): void {
  const length = Math.hypot(x, y);
  if (length > 1) {
    state.inputX = x / length;
    state.inputY = y / length;
  } else {
    state.inputX = x;
    state.inputY = y;
  }
}

export function activeOneWays(state: DeliveryState): readonly OneWay[] {
  return state.deliveries >= TUNING[state.difficulty].oneWayAfter ? CITY_ONE_WAYS : [];
}

export function isWrongWay(
  car: Readonly<DeliveryCar>,
  oneWays: readonly OneWay[],
): boolean {
  for (const road of oneWays) {
    if (road.orientation === "horizontal") {
      if (
        Math.abs(car.y - road.coordinate) <= 5
        && car.x >= road.from
        && car.x <= road.to
        && Math.abs(car.vx) > 2
        && Math.sign(car.vx) !== road.direction
      ) return true;
    } else if (
      Math.abs(car.x - road.coordinate) <= 5
      && car.y >= road.from
      && car.y <= road.to
      && Math.abs(car.vy) > 2
      && Math.sign(car.vy) !== road.direction
    ) {
      return true;
    }
  }
  return false;
}

function onRoad(x: number, y: number): boolean {
  return [16, 50, 84].some((road) => Math.abs(x - road) <= 7 || Math.abs(y - road) <= 7);
}

function updatePlayer(state: DeliveryState, deltaSeconds: number): void {
  const tuning = TUNING[state.difficulty];
  const terrainMultiplier = onRoad(state.car.x, state.car.y) ? 1 : 0.42;
  const desiredX = state.inputX * tuning.speed * terrainMultiplier;
  const desiredY = state.inputY * tuning.speed * terrainMultiplier;
  const response = Math.min(1, deltaSeconds * 7);
  state.car.vx += (desiredX - state.car.vx) * response;
  state.car.vy += (desiredY - state.car.vy) * response;
  if (Math.hypot(state.inputX, state.inputY) < 0.05) {
    state.car.vx *= Math.max(0, 1 - deltaSeconds * 4.5);
    state.car.vy *= Math.max(0, 1 - deltaSeconds * 4.5);
  }
  if (Math.hypot(state.car.vx, state.car.vy) > 0.8) {
    state.car.heading = Math.atan2(state.car.vy, state.car.vx);
  }
  state.car.x = Math.min(97, Math.max(3, state.car.x + state.car.vx * deltaSeconds));
  state.car.y = Math.min(97, Math.max(3, state.car.y + state.car.vy * deltaSeconds));
  state.car.bumpCooldown = Math.max(0, state.car.bumpCooldown - deltaSeconds);

  state.wrongWay = isWrongWay(state.car, activeOneWays(state));
  if (state.wrongWay) {
    state.wrongWayTime += deltaSeconds;
    state.car.vx *= Math.max(0.7, 1 - deltaSeconds * 2.2);
    state.car.vy *= Math.max(0.7, 1 - deltaSeconds * 2.2);
    state.message = "↶ One-way street — turn around!";
    if (state.wrongWayTime >= 1) {
      state.remaining = Math.max(0, state.remaining - 0.75);
      state.wrongWayTime -= 1;
    }
  } else {
    state.wrongWayTime = 0;
  }
}

function updateTraffic(state: DeliveryState, deltaSeconds: number): void {
  for (const car of state.traffic) {
    car.x += car.vx * deltaSeconds;
    car.y += car.vy * deltaSeconds;
    if (car.x < -5) car.x = 105;
    if (car.x > 105) car.x = -5;
    if (car.y < -5) car.y = 105;
    if (car.y > 105) car.y = -5;
  }
}

export function applyTrafficCollision(state: DeliveryState, traffic: Readonly<TrafficCar>): boolean {
  if (state.car.bumpCooldown > 0 || Math.hypot(state.car.x - traffic.x, state.car.y - traffic.y) >= 4.2) {
    return false;
  }
  state.car.bumpCooldown = 1.15;
  state.car.vx *= -0.35;
  state.car.vy *= -0.35;
  state.remaining = Math.max(0, state.remaining - 2.5);
  state.score = Math.max(0, state.score - 25);
  state.bumpCount += 1;
  state.chain = 0;
  state.message = "Soft bump! −2.5 seconds";
  return true;
}

function checkTrafficCollisions(state: DeliveryState): void {
  for (const traffic of state.traffic) {
    if (applyTrafficCollision(state, traffic)) break;
  }
}

export interface DeliveryCompletion {
  readonly points: number;
  readonly timeAdded: number;
}

export function completeDelivery(state: DeliveryState, rng: RandomSource): DeliveryCompletion {
  const tuning = TUNING[state.difficulty];
  state.chain += 1;
  state.bestChain = Math.max(state.bestChain, state.chain);
  state.deliveries += 1;
  const points = Math.round(
    (220 + state.parcel.deadline * 8 + Math.max(0, state.chain - 1) * 95) * tuning.scoreMultiplier,
  );
  const timeAdded = tuning.chainTime + Math.min(3.2, Math.max(0, state.chain - 1) * 0.55);
  state.score += points;
  state.totalBonusTime += timeAdded;
  state.bestTimeBonus = Math.max(state.bestTimeBonus, timeAdded);
  state.bestDeliveryPoints = Math.max(state.bestDeliveryPoints, points);
  state.remaining = Math.min(90, state.remaining + timeAdded);
  const previous = state.parcel.destination;
  state.parcel = createParcel(state.nextParcelId, state.difficulty, rng, previous);
  state.nextParcelId += 1;
  if (state.deliveries % 3 === 0 && state.traffic.length < tuning.traffic + 3) {
    state.traffic.push(createTraffic(
      state.traffic.length + 1,
      rng,
      [
        { x: state.car.x, y: state.car.y, name: "Player" },
        state.parcel.pickup,
        state.parcel.destination,
      ],
    ));
  }
  state.message = `${state.chain}× DELIVERY CHAIN · +${timeAdded.toFixed(1)}s`;
  return { points, timeAdded };
}

function updateParcel(state: DeliveryState, deltaSeconds: number, rng: RandomSource): void {
  state.parcel.deadline = Math.max(0, state.parcel.deadline - deltaSeconds);
  const target = state.parcel.carrying ? state.parcel.destination : state.parcel.pickup;
  const distance = Math.hypot(state.car.x - target.x, state.car.y - target.y);
  if (distance <= 5.3) {
    if (!state.parcel.carrying) {
      state.parcel.carrying = true;
      state.message = `Parcel aboard! Deliver to ${state.parcel.destination.name}`;
    } else {
      completeDelivery(state, rng);
    }
  } else if (state.parcel.deadline <= 0) {
    const previous = state.parcel.destination;
    state.parcel = createParcel(state.nextParcelId, state.difficulty, rng, previous);
    state.nextParcelId += 1;
    state.chain = 0;
    state.score = Math.max(0, state.score - 50);
    state.message = "Parcel reassigned — find the new pin!";
  }
}

export function updateDelivery(state: DeliveryState, deltaSeconds: number, rng: RandomSource): void {
  if (state.phase !== "playing" || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  let remainingStep = Math.min(deltaSeconds, 0.75);
  while (remainingStep > 0 && state.phase === "playing") {
    const step = Math.min(remainingStep, 1 / 60);
    remainingStep -= step;
    state.remaining = Math.max(0, state.remaining - step);
    updatePlayer(state, step);
    updateTraffic(state, step);
    checkTrafficCollisions(state);
    updateParcel(state, step, rng);
    if (state.remaining <= 0) {
      state.phase = "finished";
      state.inputX = 0;
      state.inputY = 0;
      state.message = "Delivery shift complete!";
    }
  }
}

export function finishDelivery(state: DeliveryState, message = "Delivery shift ended"): void {
  state.phase = "finished";
  state.inputX = 0;
  state.inputY = 0;
  state.message = message;
}
