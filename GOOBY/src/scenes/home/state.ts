import type { Clock } from "../../core/contracts/clock";
import type { AssetKey } from "../../core/contracts/assets";
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
import { CATALOG_BY_ID, type FurnitureCatalogItem } from "../../data/catalog";

const DECOR_PREFIX = "__home.decor.v1|";
const CATALOG_DECOR_PREFIX = "__home.catalog.v1|";
const HARVEST_DAY_KEY = "__home.harvest.day";
const HARVEST_COUNT_KEY = "__home.harvest.count";
const DAY_MS = 24 * 60 * 60 * 1_000;
export const DAILY_CARROT_LIMIT = 3;
export const NOUGAT_DISPENSER_DECOR_ID = "nougatschleuse";
export const HAZELNUT_NOUGAT_SPREAD_ID = "hazelnut-nougat-spread" as const;

export interface DecorPlacement {
  readonly instanceId: string;
  readonly decorId: string;
  readonly zone: HomeZoneId;
  readonly gridX: number;
  readonly gridZ: number;
  readonly quarterTurns: 0 | 1 | 2 | 3;
  readonly slotId: string | null;
}

export interface PlacementRequest {
  readonly instanceId: string;
  readonly decorId: string;
  readonly zone: HomeZoneId;
  readonly x: number;
  readonly z: number;
  readonly quarterTurns?: 0 | 1 | 2 | 3;
  readonly slotId?: string | null;
}

export type PlacementFailure =
  | "invalid-instance"
  | "invalid-coordinate"
  | "unknown-decor"
  | "inventory-exhausted"
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

const CATALOG_FOOTPRINTS = Object.freeze({
  tiny: [0.75, 0.75],
  small: [1.15, 1.05],
  medium: [1.7, 1.4],
  large: [2.5, 1.9],
} as const);

export interface ResolvedDecorDefinition {
  readonly assetKey: AssetKey | null;
  readonly footprint: readonly [width: number, depth: number];
  readonly allowedZones: readonly HomeZoneId[];
  readonly catalogItem: FurnitureCatalogItem | null;
  readonly inventoryId: string | null;
}

export function resolveDecorDefinition(decorId: string): ResolvedDecorDefinition | null {
  if (decorId in HOME_DECOR_CATALOG) {
    const definition = HOME_DECOR_CATALOG[decorId as DecorId];
    return {
      assetKey: definition.assetKey,
      footprint: definition.footprint,
      allowedZones: definition.allowedZones,
      catalogItem: null,
      inventoryId: null,
    };
  }
  const item = CATALOG_BY_ID.get(decorId);
  if (item?.kind !== "furniture") return null;
  return {
    assetKey: null,
    footprint: CATALOG_FOOTPRINTS[item.footprint],
    allowedZones: item.zones,
    catalogItem: item,
    inventoryId: item.id,
  };
}

function worldRect(placement: DecorPlacement): HomeRect {
  const definition = resolveDecorDefinition(placement.decorId);
  if (!definition) throw new Error(`Unknown decor in placement: ${placement.decorId}`);
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
  inventory?: Readonly<Record<string, number>>,
): PlacementValidation {
  if (!/^[a-z0-9-]{1,64}$/u.test(request.instanceId)) {
    return { valid: false, reason: "invalid-instance" };
  }
  if (!Number.isFinite(request.x) || !Number.isFinite(request.z)) {
    return { valid: false, reason: "invalid-coordinate" };
  }

  const definition = resolveDecorDefinition(request.decorId);
  if (!definition) return { valid: false, reason: "unknown-decor" };
  if (!definition.allowedZones.includes(request.zone)) {
    return { valid: false, reason: "wrong-zone" };
  }
  if (inventory && definition.inventoryId) {
    const owned = inventory[definition.inventoryId] ?? 0;
    const used = existing.filter(
      ({ decorId, instanceId }) => decorId === request.decorId && instanceId !== request.instanceId,
    ).length;
    if (used >= owned) return { valid: false, reason: "inventory-exhausted" };
  }

  const blueprint = HOME_ZONE_BLUEPRINTS[request.zone];
  let x = request.x;
  let z = request.z;
  const slotId = request.slotId ?? null;
  if (slotId) {
    const slot = blueprint.decorSlots.find(({ id }) => id === slotId);
    if (!slot) return { valid: false, reason: "unknown-slot" };
    if (
      definition.catalogItem
        ? !definition.catalogItem.zones.includes(request.zone)
        : !slot.allowedDecor.includes(request.decorId as DecorId)
    ) {
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
  inventory?: Readonly<Record<string, number>>,
): { readonly placements: readonly DecorPlacement[]; readonly validation: PlacementValidation } {
  const validation = validateDecorPlacement(request, existing, inventory);
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
  inventory?: Readonly<Record<string, number>>,
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
  }, inventory);
}

export function removeDecorPlacement(
  existing: readonly DecorPlacement[],
  instanceId: string,
): readonly DecorPlacement[] {
  return existing.filter((placement) => placement.instanceId !== instanceId);
}

function decorKey(placement: DecorPlacement): string {
  const prefix = resolveDecorDefinition(placement.decorId)?.inventoryId
    ? CATALOG_DECOR_PREFIX
    : DECOR_PREFIX;
  return [
    prefix.slice(0, -1),
    placement.zone,
    placement.instanceId,
    placement.decorId,
    placement.gridX.toString(),
    placement.gridZ.toString(),
    placement.quarterTurns.toString(),
    placement.slotId ?? "-",
  ].join("|");
}

export function findAvailableDecorPlacement(
  existing: readonly DecorPlacement[],
  decorId: string,
  zone: HomeZoneId,
  instanceId: string,
  inventory?: Readonly<Record<string, number>>,
): PlacementValidation {
  const definition = resolveDecorDefinition(decorId);
  if (!definition) return { valid: false, reason: "unknown-decor" };
  if (inventory && definition.inventoryId && (inventory[definition.inventoryId] ?? 0) <= 0) {
    return { valid: false, reason: "inventory-exhausted" };
  }
  const blueprint = HOME_ZONE_BLUEPRINTS[zone];
  const candidates: Array<{ readonly x: number; readonly z: number; readonly slotId: string | null }> = [
    ...blueprint.decorSlots.map(({ id, position }) => ({ x: position[0], z: position[1], slotId: id })),
  ];
  const minX = blueprint.bounds.center[0] - blueprint.bounds.size[0] / 2;
  const maxX = blueprint.bounds.center[0] + blueprint.bounds.size[0] / 2;
  const minZ = blueprint.bounds.center[1] - blueprint.bounds.size[1] / 2;
  const maxZ = blueprint.bounds.center[1] + blueprint.bounds.size[1] / 2;
  for (let z = minZ; z <= maxZ; z += HOME_GRID_SIZE) {
    for (let x = minX; x <= maxX; x += HOME_GRID_SIZE) candidates.push({ x, z, slotId: null });
  }
  for (const candidate of candidates) {
    const validation = validateDecorPlacement({
      instanceId,
      decorId,
      zone,
      x: candidate.x,
      z: candidate.z,
      slotId: candidate.slotId,
    }, existing, inventory);
    if (validation.valid) return validation;
  }
  return { valid: false, reason: "out-of-bounds" };
}

function sanitizeDecorPlacements(
  save: SaveState,
  placements: readonly DecorPlacement[],
): readonly DecorPlacement[] {
  const valid: DecorPlacement[] = [];
  for (const placement of placements) {
    const validation = validateDecorPlacement({
      ...placement,
      x: placement.gridX * HOME_GRID_SIZE,
      z: placement.gridZ * HOME_GRID_SIZE,
    }, valid, save.inventory);
    if (validation.valid) valid.push(validation.placement);
  }
  return valid;
}

export function persistDecorPlacements(
  save: SaveState,
  placements: readonly DecorPlacement[],
): SaveState {
  const inventory = Object.fromEntries(
    Object.entries(save.inventory).filter(
      ([key]) => !key.startsWith(DECOR_PREFIX) && !key.startsWith(CATALOG_DECOR_PREFIX),
    ),
  );
  for (const placement of sanitizeDecorPlacements(save, placements)) inventory[decorKey(placement)] = 1;
  return { ...save, inventory };
}

export function restoreDecorPlacements(save: SaveState): readonly DecorPlacement[] {
  const restored: DecorPlacement[] = [];
  for (const [key, value] of Object.entries(save.inventory)) {
    const persistedDecor = key.startsWith(DECOR_PREFIX) || key.startsWith(CATALOG_DECOR_PREFIX);
    if (!persistedDecor || value !== 1) continue;
    const [, zone, instanceId, decorId, x, z, turns, slot] = key.split("|");
    if (
      !zone ||
      !instanceId ||
      !decorId ||
      !(zone in HOME_ZONE_BLUEPRINTS) ||
      !resolveDecorDefinition(decorId)
    ) {
      continue;
    }
    if (x === undefined || z === undefined || turns === undefined || slot === undefined) {
      const legacy = findAvailableDecorPlacement(
        restored,
        decorId,
        zone as HomeZoneId,
        instanceId,
        save.inventory,
      );
      if (legacy.valid) restored.push(legacy.placement);
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
      decorId,
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
      save.inventory,
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

export type FoodId = "carrot" | "apple" | "pancake" | typeof HAZELNUT_NOUGAT_SPREAD_ID;

const FOOD_NOURISHMENT: Readonly<Record<FoodId, number>> = {
  carrot: 22,
  apple: 16,
  pancake: 30,
  [HAZELNUT_NOUGAT_SPREAD_ID]: 24,
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

export interface NougatDispenseResult {
  readonly save: SaveState;
  readonly dispensed: boolean;
  readonly consumed: boolean;
}

/**
 * The counter produces one generic serving and immediately routes it through
 * the same inventory-backed feeding mutation as every other home snack.
 */
export function dispenseHazelnutNougatSpread(
  save: SaveState,
  clock: Clock,
): NougatDispenseResult {
  if (save.simulation.sleep) return { save, dispensed: false, consumed: false };
  const stocked: SaveState = {
    ...save,
    inventory: {
      ...save.inventory,
      [HAZELNUT_NOUGAT_SPREAD_ID]: (save.inventory[HAZELNUT_NOUGAT_SPREAD_ID] ?? 0) + 1,
    },
  };
  const fed = feedFromInventory(stocked, HAZELNUT_NOUGAT_SPREAD_ID, clock);
  return { save: fed.save, dispensed: true, consumed: fed.consumed };
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

export function petGooby(
  save: SaveState,
  kind: "pet" | "tickle" | "poke" | "belly-rub",
  clock: Clock,
): SaveState {
  if (save.simulation.sleep) return save;
  const amount = kind === "belly-rub" ? 3.5 : kind === "tickle" ? 2 : kind === "pet" ? 0.75 : 0.35;
  return mutateNeed(save, "fun", amount, clock);
}

export interface HarvestResult {
  readonly save: SaveState;
  readonly harvested: boolean;
  readonly harvestedToday: number;
  readonly remainingToday: number;
}

function harvestLedger(
  save: SaveState,
  clock: Clock,
): { readonly day: number; readonly count: number } {
  const clockDay = Math.max(0, Math.floor(clock.now() / DAY_MS));
  const canonicalDay = save.dailyHarvest?.day ?? -1;
  const legacyDay = save.inventory[HARVEST_DAY_KEY] ?? -1;
  const highWaterDay = Math.max(canonicalDay, legacyDay);
  if (clockDay > highWaterDay) return { day: clockDay, count: 0 };
  const canonicalCount = canonicalDay === highWaterDay ? (save.dailyHarvest?.count ?? 0) : 0;
  const legacyCount = legacyDay === highWaterDay ? (save.inventory[HARVEST_COUNT_KEY] ?? 0) : 0;
  return {
    day: Math.max(clockDay, highWaterDay),
    count: Math.max(0, canonicalCount, legacyCount),
  };
}

export function harvestCarrot(save: SaveState, clock: Clock): HarvestResult {
  const ledger = harvestLedger(save, clock);
  const harvestedBefore = ledger.count;
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
    [HARVEST_DAY_KEY]: ledger.day,
    [HARVEST_COUNT_KEY]: harvestedToday,
  };
  return {
    save: {
      ...save,
      inventory,
      dailyHarvest: { day: ledger.day, count: harvestedToday },
    },
    harvested: true,
    harvestedToday,
    remainingToday: DAILY_CARROT_LIMIT - harvestedToday,
  };
}

export function carrotsRemainingToday(save: SaveState, clock: Clock): number {
  return Math.max(0, DAILY_CARROT_LIMIT - harvestLedger(save, clock).count);
}
