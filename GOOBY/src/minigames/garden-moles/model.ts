import type { RandomSource } from "../../core/contracts/rng";

export type GardenDifficulty = "gentle" | "bouncy" | "rascal";
export type GardenActorKind = "mole" | "bunny" | "golden" | "flowerpot" | "armored";
export type GardenPhase = "ready" | "playing" | "paused" | "finished";

export interface GardenActor {
  readonly id: number;
  readonly kind: GardenActorKind;
  slot: number;
  age: number;
  readonly lifetime: number;
  revealAt: number;
  fakeOutSlot: number | null;
  readonly requiredCharge: number;
}

export interface GardenState {
  phase: GardenPhase;
  readonly difficulty: GardenDifficulty;
  elapsed: number;
  stepRemainder: number;
  remaining: number;
  score: number;
  hearts: number;
  combo: number;
  bestCombo: number;
  frenzyRemaining: number;
  gridSize: number;
  heldSlot: number | null;
  bonkCharge: number;
  flowerpotPenalties: number;
  armoredCleared: number;
  spawnIn: number;
  nextActorId: number;
  actors: GardenActor[];
  message: string;
}

interface GardenTuning {
  readonly firstSpawn: number;
  readonly slowInterval: number;
  readonly fastInterval: number;
  readonly actorLifetime: number;
  readonly maxActors: number;
  readonly bunnyChance: number;
  readonly goldenChance: number;
  readonly flowerpotChance: number;
  readonly armoredChance: number;
  readonly fakeOutChance: number;
  readonly basePoints: number;
}

const ROUND_SECONDS = 75;
export const GARDEN_BASE_SLOTS = 9;
export const GARDEN_EXPANDED_SLOTS = 12;
export const GARDEN_EXPANSION_AT = 48;
export const ARMORED_BONK_SECONDS = 0.62;
export const FLOWERPOT_PENALTY = 125;

const TUNING: Readonly<Record<GardenDifficulty, GardenTuning>> = {
  gentle: {
    firstSpawn: 0.8,
    slowInterval: 1.18,
    fastInterval: 0.62,
    actorLifetime: 1.55,
    maxActors: 2,
    bunnyChance: 0.2,
    goldenChance: 0.09,
    flowerpotChance: 0.08,
    armoredChance: 0.07,
    fakeOutChance: 0.08,
    basePoints: 100,
  },
  bouncy: {
    firstSpawn: 0.65,
    slowInterval: 0.94,
    fastInterval: 0.42,
    actorLifetime: 1.23,
    maxActors: 3,
    bunnyChance: 0.24,
    goldenChance: 0.075,
    flowerpotChance: 0.11,
    armoredChance: 0.1,
    fakeOutChance: 0.18,
    basePoints: 130,
  },
  rascal: {
    firstSpawn: 0.5,
    slowInterval: 0.76,
    fastInterval: 0.28,
    actorLifetime: 0.98,
    maxActors: 4,
    bunnyChance: 0.28,
    goldenChance: 0.065,
    flowerpotChance: 0.14,
    armoredChance: 0.13,
    fakeOutChance: 0.32,
    basePoints: 165,
  },
};

export function createGardenState(difficulty: GardenDifficulty): GardenState {
  return {
    phase: "ready",
    difficulty,
    elapsed: 0,
    stepRemainder: 0,
    remaining: ROUND_SECONDS,
    score: 0,
    hearts: 3,
    combo: 0,
    bestCombo: 0,
    frenzyRemaining: 0,
    gridSize: GARDEN_BASE_SLOTS,
    heldSlot: null,
    bonkCharge: 0,
    flowerpotPenalties: 0,
    armoredCleared: 0,
    spawnIn: TUNING[difficulty].firstSpawn,
    nextActorId: 1,
    actors: [],
    message: "Protect the carrot patch!",
  };
}

export function beginGarden(state: GardenState): void {
  if (state.phase === "ready") state.phase = "playing";
}

export function pauseGarden(state: GardenState): void {
  if (state.phase === "playing") state.phase = "paused";
}

export function resumeGarden(state: GardenState): void {
  if (state.phase === "paused") state.phase = "playing";
}

function emptySlots(state: GardenState): number[] {
  const occupied = new Set(state.actors.map((actor) => actor.slot));
  return Array.from({ length: state.gridSize }, (_, index) => index).filter((index) => !occupied.has(index));
}

function pickDifferentSlot(rng: RandomSource, slots: readonly number[], original: number): number | null {
  const choices = slots.filter((slot) => slot !== original);
  return choices.length > 0 ? rng.pick(choices) : null;
}

export function spawnGardenActor(
  state: GardenState,
  rng: RandomSource,
  forcedKind?: GardenActorKind,
  forcedSlot?: number,
): GardenActor | null {
  const tuning = TUNING[state.difficulty];
  const slots = emptySlots(state);
  if (slots.length === 0 || state.actors.length >= tuning.maxActors + (state.frenzyRemaining > 0 ? 2 : 0)) {
    return null;
  }

  const slot = forcedSlot !== undefined && slots.includes(forcedSlot) ? forcedSlot : rng.pick(slots);
  const actorRoll = rng.next();
  const goldenEnd = tuning.goldenChance;
  const bunnyEnd = goldenEnd + tuning.bunnyChance;
  const flowerpotEnd = bunnyEnd + tuning.flowerpotChance;
  const armoredEnd = flowerpotEnd + tuning.armoredChance;
  const kind = forcedKind ?? (
    state.frenzyRemaining > 0
      ? "mole"
      : actorRoll < goldenEnd
        ? "golden"
        : actorRoll < bunnyEnd
          ? "bunny"
          : actorRoll < flowerpotEnd
            ? "flowerpot"
            : actorRoll < armoredEnd
              ? "armored"
              : "mole"
  );
  const progress = Math.min(1, state.elapsed / ROUND_SECONDS);
  const lifetimeScale = kind === "armored" ? 1.55 : kind === "flowerpot" ? 1.25 : 1;
  const lifetime = Math.max(0.58, (tuning.actorLifetime - progress * 0.28) * lifetimeScale);
  const shouldFake = kind === "mole" && state.frenzyRemaining <= 0 && rng.next() < tuning.fakeOutChance * (0.4 + progress);
  const remainingSlots = slots.filter((candidate) => candidate !== slot);
  const actor: GardenActor = {
    id: state.nextActorId,
    kind,
    slot,
    age: 0,
    lifetime,
    revealAt: shouldFake ? 0.24 : 0,
    fakeOutSlot: shouldFake ? pickDifferentSlot(rng, remainingSlots, slot) : null,
    requiredCharge: kind === "armored" ? ARMORED_BONK_SECONDS : 0,
  };
  state.nextActorId += 1;
  state.actors.push(actor);
  return actor;
}

function resolveExpiredActor(state: GardenState, actor: GardenActor): void {
  if (actor.kind === "mole" || actor.kind === "armored") {
    state.combo = 0;
    state.message = "A rascal got a carrot!";
  } else if (actor.kind === "golden") {
    state.message = "The golden mole slipped away…";
  }
}

function advanceActors(state: GardenState, deltaSeconds: number): void {
  const survivors: GardenActor[] = [];
  for (const actor of state.actors) {
    actor.age += deltaSeconds;
    if (actor.fakeOutSlot !== null && actor.age >= actor.revealAt) {
      const targetOccupied = state.actors.some(
        (other) => other.id !== actor.id && other.slot === actor.fakeOutSlot,
      );
      if (!targetOccupied) actor.slot = actor.fakeOutSlot;
      actor.fakeOutSlot = null;
      actor.revealAt = 0;
    }
    if (actor.age >= actor.lifetime) {
      resolveExpiredActor(state, actor);
    } else {
      survivors.push(actor);
    }
  }
  state.actors = survivors;
}

function spawnInterval(state: GardenState, rng: RandomSource): number {
  const tuning = TUNING[state.difficulty];
  const progress = Math.min(1, state.elapsed / ROUND_SECONDS);
  const base = tuning.slowInterval + (tuning.fastInterval - tuning.slowInterval) * progress;
  return base * (0.84 + rng.next() * 0.32);
}

export function updateGarden(state: GardenState, deltaSeconds: number, rng: RandomSource): void {
  if (state.phase !== "playing" || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  const step = 1 / 120;
  state.stepRemainder += Math.min(deltaSeconds, 1);
  while (state.stepRemainder >= step - 0.000_000_001 && state.phase === "playing") {
    state.stepRemainder = Math.max(0, state.stepRemainder - step);
    state.elapsed += step;
    state.remaining = Math.max(0, ROUND_SECONDS - state.elapsed);
    state.frenzyRemaining = Math.max(0, state.frenzyRemaining - step);
    if (state.heldSlot !== null) state.bonkCharge = Math.min(1.5, state.bonkCharge + step);
    if (
      state.gridSize === GARDEN_BASE_SLOTS
      && state.elapsed >= GARDEN_EXPANSION_AT - 0.000_001
    ) {
      state.gridSize = GARDEN_EXPANDED_SLOTS;
      state.spawnIn = Math.min(state.spawnIn, 0.12);
      state.message = "The back garden opened — twelve holes!";
    }
    state.spawnIn -= step;
    advanceActors(state, step);

    if (state.spawnIn <= 0) {
      spawnGardenActor(state, rng);
      if (state.frenzyRemaining > 0 && rng.next() < 0.58) spawnGardenActor(state, rng, "mole");
      state.spawnIn += spawnInterval(state, rng);
    }

    if (state.elapsed >= ROUND_SECONDS - 0.000_001 || state.hearts <= 0) {
      state.elapsed = Math.min(ROUND_SECONDS, state.elapsed);
      state.remaining = 0;
      state.phase = "finished";
      state.stepRemainder = 0;
      state.actors = [];
      state.heldSlot = null;
      state.bonkCharge = 0;
      state.message = state.hearts <= 0 ? "The bunnies need a cuddle break." : "Garden saved!";
    }
  }
  if (state.stepRemainder < 0.000_000_001) state.stepRemainder = 0;
}

export type GardenTapResult =
  | "mole"
  | "bunny"
  | "golden"
  | "flowerpot"
  | "armored"
  | "empty"
  | "hidden";

export function tapGardenSlot(state: GardenState, slot: number, chargeSeconds = 0): GardenTapResult {
  if (state.phase !== "playing") return "empty";
  const actorIndex = state.actors.findIndex((candidate) => candidate.slot === slot);
  if (actorIndex < 0) {
    state.combo = 0;
    state.message = "Rustle… nothing there!";
    return "empty";
  }
  const actor = state.actors[actorIndex];
  if (!actor) return "empty";
  if (actor.revealAt > actor.age) {
    state.combo = 0;
    state.message = "A sneaky fake-out!";
    return "hidden";
  }

  if (actor.kind === "armored" && chargeSeconds < actor.requiredCharge) {
    state.combo = 0;
    state.message = `Hold to charge this helmet! ${Math.round(chargeSeconds / actor.requiredCharge * 100)}%`;
    return "armored";
  }
  state.actors.splice(actorIndex, 1);

  if (actor.kind === "bunny") {
    state.hearts = Math.max(0, state.hearts - 1);
    state.combo = 0;
    state.message = state.hearts > 0 ? "Oh! Spare the baby bunnies ♥" : "Bunny cuddle break!";
    if (state.hearts <= 0) {
      state.phase = "finished";
      state.actors = [];
    }
    return "bunny";
  }

  if (actor.kind === "flowerpot") {
    state.score = Math.max(0, state.score - FLOWERPOT_PENALTY);
    state.combo = 0;
    state.flowerpotPenalties += 1;
    state.message = `Decoy flowerpot! −${FLOWERPOT_PENALTY}`;
    return "flowerpot";
  }

  if (actor.kind === "golden") {
    state.frenzyRemaining = 7;
    state.actors = state.actors.filter((candidate) => candidate.kind === "mole");
    state.score += 250;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.spawnIn = Math.min(state.spawnIn, 0.12);
    state.message = "GOLDEN FRENZY — double points!";
    return "golden";
  }

  const tuning = TUNING[state.difficulty];
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const comboBonus = Math.min(200, (state.combo - 1) * 12);
  const multiplier = state.frenzyRemaining > 0 ? 2 : 1;
  const armorMultiplier = actor.kind === "armored" ? 2 : 1;
  state.score += (tuning.basePoints * armorMultiplier + comboBonus) * multiplier;
  if (actor.kind === "armored") {
    state.armoredCleared += 1;
    state.message = "Charged bonk! Helmet popped.";
    return "armored";
  }
  state.message = state.combo >= 3 ? `${state.combo}× garden streak!` : "Carrot rescued!";
  return "mole";
}

export function beginGardenBonk(state: GardenState, slot: number): boolean {
  if (state.phase !== "playing" || !Number.isInteger(slot) || slot < 0 || slot >= state.gridSize) return false;
  state.heldSlot = slot;
  state.bonkCharge = 0;
  return true;
}

export function releaseGardenBonk(state: GardenState, slot = state.heldSlot): GardenTapResult {
  if (slot === null || slot !== state.heldSlot) return "empty";
  const charge = state.bonkCharge;
  state.heldSlot = null;
  state.bonkCharge = 0;
  return tapGardenSlot(state, slot, charge);
}

export function cancelGardenBonk(state: GardenState): void {
  state.heldSlot = null;
  state.bonkCharge = 0;
}

export function finishGarden(state: GardenState, message = "Garden run ended"): void {
  state.phase = "finished";
  state.stepRemainder = 0;
  state.actors = [];
  state.heldSlot = null;
  state.bonkCharge = 0;
  state.message = message;
}
