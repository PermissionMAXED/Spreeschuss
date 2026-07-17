import { z } from "zod";
import type { Clock } from "../../core/contracts/clock";
import { grantReward, spendCoins } from "../../core/contracts/economy";
import type { SavePort } from "../../core/contracts/platform";
import type { ShopId } from "../../core/contracts/scenes";
import {
  commitSave,
  loadSave,
  SaveStateSchema,
  type SaveState,
} from "../../core/contracts/save";
import { applyNeedDelta } from "../../core/contracts/simulation";
import {
  CATALOG_BY_ID,
  type CatalogItem,
  type FoodCatalogItem,
} from "../../data/catalog";

const PURCHASE_RECEIPT_PREFIX = "__shop_purchase__";
const FALLBACK_REQUEST_STATE_KEY = Symbol.for("gooby.shop.purchase-request-state");
const MAX_COMMIT_ATTEMPTS = 4;

interface FallbackRequestState {
  entropy: string;
  sequence: number;
}

function createFallbackEntropy(): string {
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x1_0000_0000).toString(36).padStart(7, "0")).join("");
}

function isFallbackRequestState(value: unknown): value is FallbackRequestState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FallbackRequestState>;
  return typeof candidate.entropy === "string" &&
    candidate.entropy.length === 28 &&
    Number.isSafeInteger(candidate.sequence) &&
    (candidate.sequence ?? -1) >= 0;
}

function fallbackRequestState(): FallbackRequestState {
  const existing = Reflect.get(globalThis, FALLBACK_REQUEST_STATE_KEY) as unknown;
  if (isFallbackRequestState(existing)) return existing;
  const state: FallbackRequestState = {
    entropy: createFallbackEntropy(),
    sequence: 0,
  };
  Object.defineProperty(globalThis, FALLBACK_REQUEST_STATE_KEY, {
    configurable: false,
    enumerable: false,
    value: state,
    writable: false,
  });
  return state;
}

function nextFallbackRequestId(shopId: ShopId): string {
  const state = fallbackRequestState();
  state.sequence += 1;
  if (!Number.isSafeInteger(state.sequence)) {
    state.entropy = createFallbackEntropy();
    state.sequence = 1;
  }
  return `fallback-${shopId}-${state.entropy}-${state.sequence.toString(36).padStart(8, "0")}`;
}

/**
 * Scene-scoped source backed by one page-global fallback sequence. The random
 * session entropy separates full reloads; the sequence separates every scene
 * instance in the current page, without depending on wall-clock time.
 */
export class PurchaseRequestIdSource {
  next(shopId: ShopId): string {
    const crypto = globalThis.crypto;
    if (crypto && typeof crypto.randomUUID === "function") {
      try {
        return crypto.randomUUID();
      } catch {
        // Restricted webviews can expose crypto while rejecting randomUUID.
      }
    }
    return nextFallbackRequestId(shopId);
  }
}

export const PurchaseRequestSchema = z
  .object({
    itemId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/u),
  })
  .strict();

export interface PurchaseRequest {
  readonly itemId: string;
  readonly requestId: string;
}

export type PurchaseStatus =
  | "purchased"
  | "duplicate"
  | "insufficient-funds"
  | "level-locked"
  | "already-owned"
  | "invalid-request"
  | "unknown-item";

export interface PurchaseResult {
  readonly status: PurchaseStatus;
  readonly state: SaveState;
  readonly item?: CatalogItem;
  readonly message: string;
}

function receiptKey(requestId: string): string {
  return `${PURCHASE_RECEIPT_PREFIX}${requestId}`;
}

export function isPurchaseReceiptKey(key: string): boolean {
  return key.startsWith(PURCHASE_RECEIPT_PREFIX);
}

export function visibleInventory(inventory: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(inventory).filter(([key]) => !isPurchaseReceiptKey(key)));
}

/**
 * Pure atomic purchase reducer. The idempotency receipt is persisted in the
 * existing string-keyed inventory so retries across reloads cannot spend twice.
 */
export function purchaseCatalogItem(state: SaveState, request: PurchaseRequest): PurchaseResult {
  const safeState = SaveStateSchema.parse(state);
  const parsedRequest = PurchaseRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return {
      status: "invalid-request",
      state: safeState,
      message: "That purchase did not go through. Nothing was spent.",
    };
  }

  const item = CATALOG_BY_ID.get(parsedRequest.data.itemId);
  if (!item) {
    return {
      status: "unknown-item",
      state: safeState,
      message: "That item is not on the shelf. Nothing was spent.",
    };
  }

  const idempotencyKey = receiptKey(parsedRequest.data.requestId);
  if ((safeState.inventory[idempotencyKey] ?? 0) > 0) {
    return {
      status: "duplicate",
      state: safeState,
      item,
      message: "Already handled—your coins are safe.",
    };
  }

  if (safeState.economy.level < item.levelRequired) {
    return {
      status: "level-locked",
      state: safeState,
      item,
      message: `This will be ready at level ${item.levelRequired}. It will stay right here for you.`,
    };
  }

  if (!item.stackable && (safeState.inventory[item.id] ?? 0) > 0) {
    return {
      status: "already-owned",
      state: safeState,
      item,
      message: "You already own this one—no coins spent.",
    };
  }

  const economy = spendCoins(safeState.economy, item.price);
  if (!economy) {
    return {
      status: "insufficient-funds",
      state: safeState,
      item,
      message: `You need ${item.price - safeState.economy.coins} more coins. No hurry—it will stay in stock.`,
    };
  }

  const nextState = SaveStateSchema.parse({
    ...safeState,
    economy,
    inventory: {
      ...safeState.inventory,
      [item.id]: (safeState.inventory[item.id] ?? 0) + 1,
      [idempotencyKey]: 1,
    },
  });
  return {
    status: "purchased",
    state: nextState,
    item,
    message: `${item.name} is yours! ${item.price} coins well spent.`,
  };
}

export interface ConsumeFoodResult {
  readonly status: "consumed" | "not-food" | "not-owned" | "unknown-item";
  readonly state: SaveState;
  readonly item?: FoodCatalogItem;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export function consumeFood(state: SaveState, itemId: string): ConsumeFoodResult {
  const safeState = SaveStateSchema.parse(state);
  const item = CATALOG_BY_ID.get(itemId);
  if (!item) {
    return { status: "unknown-item", state: safeState, quantityBefore: 0, quantityAfter: 0 };
  }
  if (item.kind !== "food") {
    return { status: "not-food", state: safeState, quantityBefore: 0, quantityAfter: 0 };
  }
  const count = safeState.inventory[item.id] ?? 0;
  if (count <= 0) {
    return {
      status: "not-owned",
      state: safeState,
      item,
      quantityBefore: 0,
      quantityAfter: 0,
    };
  }
  return {
    status: "consumed",
    item,
    quantityBefore: count,
    quantityAfter: count - 1,
    state: SaveStateSchema.parse({
      ...safeState,
      simulation: applyNeedDelta(safeState.simulation, "hunger", item.hunger),
      economy: grantReward(safeState.economy, { xp: item.xp }),
      inventory: { ...safeState.inventory, [item.id]: count - 1 },
    }),
  };
}

export interface CommittedPurchaseResult extends PurchaseResult {
  readonly revision: number;
}

/**
 * Serializes purchases for one save adapter, then uses its compare-and-commit
 * revision to persist the inventory and sole coin balance as one transaction.
 */
export class ShopPurchaseService {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly save: SavePort,
    private readonly clock: Pick<Clock, "now">,
  ) {}

  purchase(request: PurchaseRequest): Promise<CommittedPurchaseResult> {
    const operation = this.queue.then(() => this.commitPurchase(request));
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async commitPurchase(request: PurchaseRequest): Promise<CommittedPurchaseResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const loaded = await loadSave(this.save, this.clock.now());
      const result = purchaseCatalogItem(loaded.state, request);
      if (result.status !== "purchased") return { ...result, revision: loaded.revision };
      try {
        const revision = await commitSave(this.save, loaded.revision, result.state);
        return { ...result, revision };
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Purchase could not be saved");
  }
}
