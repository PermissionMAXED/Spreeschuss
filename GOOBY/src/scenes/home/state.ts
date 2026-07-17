import type { Clock } from "../../core/contracts/clock";
import type { SaveState } from "../../core/contracts/save";
import {
  advanceSimulation,
  applyNeedDelta,
  type NeedKey,
} from "../../core/contracts/simulation";
import {
  HOME_DECOR_CATALOG,
  HOME_GRID_SIZE,
  HOME_ZONE_BLUEPRINTS,
  type DecorId,
  type HomeRect,
} from "../../data/home";
import type { HomeZoneId } from "../../core/contracts/scenes";

const DECOR_PREFIX = "__home.decor.v1|";
const HARVEST_DAY_KEY = "__home.harvest.day";
const HARVEST_COUNT_KEY = "__home.harvest.count";
const DAY_MS = 24 * 60 * 60 * 1_000;
export const DAILY_CARROT_LIMIT = 3;

export interface DecorPlacement {
  readonly instanceId: string;
  readonly decorId: DecorId;
  readonly zone: HomeZoneId;
  readonly gridX: number;
  readonly gridZ: number;
  readonly quarterTurns: 0 | 1 | 2 | 3;
  readonly slotId: string | null;
}

export interface PlacementRequest {
  readonly instanceId: string;
  readonly decorId: DecorId;
  readonly zone: HomeZoneId;
  readonly x: number;
  readonly z: number;
  readonly quarterTurns?: 0 | 1 | 2 | 3;
  readonly slotId?: string | null;
}

export type PlacementFailure =
  | "invalid-instance"
  | "invalid-coordinate"
  | "wrong-zone"
  | "unknown-slot"
  | "slot-rejects-decor"
  | "out-of-bounds"
  | "blocked"
  | "occupied";

export type PlacementValidation =
  | { readonly valid: true; readonly placement: DecorPlacement }
  | { readonly valid: false; readonly reason: PlacementFailure };

function snap(value: number): number {
  return Math.round(value / HOME_GRID_SIZE);
}

function worldRect(placement: DecorPlacement): HomeRect {
  const definition = HOME_DECOR_CATALOG[placement.decorId];
  const rotated = placement.quarterTurns % 2 === 1;
  return {
    center: [placement.gridX * HOME_GRID_SIZE, placement.gridZ * HOME_GRID_SIZE],
    size: rotated
      ? [definition.footprint[1], definition.footprint[0]]
      : definition.footprint,
  };
}

function overlaps(left: HomeRect, right: HomeRect): boolean {
  const xDistance = Math.abs(left.center[0] - right.center[0]);
  const zDistance = Math.abs(left.center[1] - right.center[1]);
  return (
    xDistance < (left.size[0] + right.size[0]) / 2 - 0.001 &&
    zDistance < (left.size[1] + right.size[1]) / 2 - 0.001
  );
}

function contains(outer: HomeRect, inner: HomeRect): boolean {
  return (
    Math.abs(inner.center[0] - outer.center[0]) + inner.size[0] / 2 <= outer.size[0] / 2 + 0.001 &&
    Math.abs(inner.center[1] - outer.center[1]) + inner.size[1] / 2 <= outer.size[1] / 2 + 0.001
  );
}

export function validateDecorPlacement(
  request: PlacementRequest,
  existing: readonly DecorPlacement[],
): PlacementValidation {
  if (!/^[a-z0-9-]{1,24}$/u.test(request.instanceId)) {
    return { valid: false, reason: "invalid-instance" };
  }
  if (!Number.isFinite(request.x) || !Number.isFinite(request.z)) {
    return { valid: false, reason: "invalid-coordinate" };
  }

  const definition = HOME_DECOR_CATALOG[request.decorId];
  if (!definition.allowedZones.includes(request.zone)) {
    return { valid: false, reason: "wrong-zone" };
  }

  const blueprint = HOME_ZONE_BLUEPRINTS[request.zone];
  let x = request.x;
  let z = request.z;
  const slotId = request.slotId ?? null;
  if (slotId) {
    const slot = blueprint.decorSlots.find(({ id }) => id === slotId);
    if (!slot) return { valid: false, reason: "unknown-slot" };
    if (!slot.allowedDecor.includes(request.decorId)) {
      return { valid: false, reason: "slot-rejects-decor" };
    }
    [x, z] = slot.position;
  }

  const placement: DecorPlacement = {
    instanceId: request.instanceId,
    decorId: request.decorId,
    zone: request.zone,
    gridX: snap(x),
    gridZ: snap(z),
    quarterTurns: request.quarterTurns ?? 0,
    slotId,
  };
  const footprint = worldRect(placement);
  if (!contains(blueprint.bounds, footprint)) return { valid: false, reason: "out-of-bounds" };
  if (blueprint.blocked.some((rect) => overlaps(rect, footprint))) {
    return { valid: false, reason: "blocked" };
  }
  if (
    existing.some(
      (other) =>
        other.zone === request.zone &&
        other.instanceId !== request.instanceId &&
        overlaps(worldRect(other), footprint),
    )
  ) {
    return { valid: false, reason: "occupied" };
  }
  return { valid: true, placement };
}

export function upsertDecorPlacement(
  existing: readonly DecorPlacement[],
  request: PlacementRequest,
): { readonly placements: readonly DecorPlacement[]; readonly validation: PlacementValidation } {
  const validation = validateDecorPlacement(request, existing);
  if (!validation.valid) return { placements: existing, validation };
  return {
    placements: [
      ...existing.filter(({ instanceId }) => instanceId !== request.instanceId),
      validation.placement,
    ],
    validation,
  };
}

export function rotateDecorPlacement(
  existing: readonly DecorPlacement[],
  instanceId: string,
): { readonly placements: readonly DecorPlacement[]; readonly validation: PlacementValidation } {
  const current = existing.find((placement) => placement.instanceId === instanceId);
  if (!current) {
    return { placements: existing, validation: { valid: false, reason: "invalid-instance" } };
  }
  return upsertDecorPlacement(existing, {
    instanceId,
    decorId: current.decorId,
    zone: current.zone,
    x: current.gridX * HOME_GRID_SIZE,
    z: current.gridZ * HOME_GRID_SIZE,
    quarterTurns: ((current.quarterTurns + 1) % 4) as 0 | 1 | 2 | 3,
    slotId: current.slotId,
  });
}

export function removeDecorPlacement(
  existing: readonly DecorPlacement[],
  instanceId: string,
): readonly DecorPlacement[] {
  return existing.filter((placement) => placement.instanceId !== instanceId);
}

function decorKey(placement: DecorPlacement): string {
  return [
    DECOR_PREFIX.slice(0, -1),
    placement.zone,
    placement.instanceId,
    placement.decorId,
    placement.gridX.toString(),
    placement.gridZ.toString(),
    placement.quarterTurns.toString(),
    placement.slotId ?? "-",
  ].join("|");
}

export function persistDecorPlacements(
  save: SaveState,
  placements: readonly DecorPlacement[],
): SaveState {
  const inventory = Object.fromEntries(
    Object.entries(save.inventory).filter(([key]) => !key.startsWith(DECOR_PREFIX)),
  );
  for (const placement of placements) inventory[decorKey(placement)] = 1;
  return { ...save, inventory };
}

export function restoreDecorPlacements(save: SaveState): readonly DecorPlacement[] {
  const restored: DecorPlacement[] = [];
  for (const [key, value] of Object.entries(save.inventory)) {
    if (!key.startsWith(DECOR_PREFIX) || value !== 1) continue;
    const [, zone, instanceId, decorId, x, z, turns, slot] = key.split("|");
    if (
      !zone ||
      !instanceId ||
      !decorId ||
      !x ||
      !z ||
      !turns ||
      !slot ||
      !(zone in HOME_ZONE_BLUEPRINTS) ||
      !(decorId in HOME_DECOR_CATALOG)
    ) {
      continue;
    }
    const parsedX = Number(x);
    const parsedZ = Number(z);
    const parsedTurns = Number(turns);
    if (
      !Number.isInteger(parsedX) ||
      !Number.isInteger(parsedZ) ||
      !Number.isInteger(parsedTurns) ||
      parsedTurns < 0 ||
      parsedTurns > 3
    ) {
      continue;
    }
    const candidate: DecorPlacement = {
      instanceId,
      decorId: decorId as DecorId,
      zone: zone as HomeZoneId,
      gridX: parsedX,
      gridZ: parsedZ,
      quarterTurns: parsedTurns as 0 | 1 | 2 | 3,
      slotId: slot === "-" ? null : slot,
    };
    const validation = validateDecorPlacement(
      {
        ...candidate,
        x: candidate.gridX * HOME_GRID_SIZE,
        z: candidate.gridZ * HOME_GRID_SIZE,
      },
      restored,
    );
    if (validation.valid) restored.push(validation.placement);
  }
  return restored;
}

export function mutateNeed(
  save: SaveState,
  need: NeedKey,
  amount: number,
  clock: Clock,
): SaveState {
  const current = advanceSimulation(save.simulation, clock.now());
  return { ...save, simulation: applyNeedDelta(current, need, amount) };
}

export type FoodId = "carrot" | "apple" | "pancake";

const FOOD_NOURISHMENT: Readonly<Record<FoodId, number>> = {
  carrot: 22,
  apple: 16,
  pancake: 30,
};

export function feedFromInventory(
  save: SaveState,
  food: FoodId,
  clock: Clock,
): { readonly save: SaveState; readonly consumed: boolean } {
  const count = save.inventory[food] ?? 0;
  if (count <= 0 || save.simulation.sleep) return { save, consumed: false };
  const fed = mutateNeed(save, "hunger", FOOD_NOURISHMENT[food], clock);
  return {
    consumed: true,
    save: {
      ...fed,
      inventory: { ...fed.inventory, [food]: count - 1 },
    },
  };
}

export function applyScrubProgress(
  save: SaveState,
  progress: number,
  amount: number,
  clock: Clock,
): { readonly save: SaveState; readonly progress: number; readonly cleaned: boolean } {
  const nextProgress = Math.max(0, Math.min(1, progress + amount));
  if (nextProgress < 1) return { save, progress: nextProgress, cleaned: false };
  return {
    save: mutateNeed(save, "hygiene", 28, clock),
    progress: 0,
    cleaned: true,
  };
}

export function petGooby(save: SaveState, kind: "pet" | "tickle" | "poke", clock: Clock): SaveState {
  const amount = kind === "tickle" ? 2 : kind === "pet" ? 0.75 : 0.35;
  return mutateNeed(save, "fun", amount, clock);
}

export interface HarvestResult {
  readonly save: SaveState;
  readonly harvested: boolean;
  readonly harvestedToday: number;
  readonly remainingToday: number;
}

export function harvestCarrot(save: SaveState, clock: Clock): HarvestResult {
  const today = Math.max(0, Math.floor(clock.now() / DAY_MS));
  const storedDay = save.inventory[HARVEST_DAY_KEY];
  const harvestedBefore = storedDay === today ? (save.inventory[HARVEST_COUNT_KEY] ?? 0) : 0;
  if (harvestedBefore >= DAILY_CARROT_LIMIT) {
    return {
      save,
      harvested: false,
      harvestedToday: harvestedBefore,
      remainingToday: 0,
    };
  }
  const harvestedToday = harvestedBefore + 1;
  const inventory = {
    ...save.inventory,
    carrot: (save.inventory.carrot ?? 0) + 1,
    [HARVEST_DAY_KEY]: today,
    [HARVEST_COUNT_KEY]: harvestedToday,
  };
  return {
    save: { ...save, inventory },
    harvested: true,
    harvestedToday,
    remainingToday: DAILY_CARROT_LIMIT - harvestedToday,
  };
}

export function carrotsRemainingToday(save: SaveState, clock: Clock): number {
  const today = Math.max(0, Math.floor(clock.now() / DAY_MS));
  const count = save.inventory[HARVEST_DAY_KEY] === today
    ? (save.inventory[HARVEST_COUNT_KEY] ?? 0)
    : 0;
  return Math.max(0, DAILY_CARROT_LIMIT - count);
}
