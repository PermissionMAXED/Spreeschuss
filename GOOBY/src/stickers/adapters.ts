import type {
  EventBus,
  GameEvents,
} from "../core/contracts/events";
import type { MinigameSettlementReceipt } from "../core/contracts/minigame";
import type {
  CityDriveState,
  ShopId,
} from "../core/contracts/scenes";
import type {
  PurchaseRequest,
  PurchaseResult,
} from "../scenes/shops/economy";
import type { AchievementSignal } from "./progression";

interface SignalTime {
  readonly occurredAt: number;
  readonly localMonth?: number;
}

function withLocalMonth<T extends object>(
  value: T,
  time: SignalTime,
): T & SignalTime {
  return {
    ...value,
    occurredAt: time.occurredAt,
    ...(time.localMonth === undefined ? {} : { localMonth: time.localMonth }),
  };
}

/** Maps the existing post-action reaction event; failed feeds never emit it. */
export function signalFromGoobyReaction(
  reaction: GameEvents["gooby:reaction"],
  time: SignalTime,
): AchievementSignal | null {
  if (reaction.kind === "pet") {
    return withLocalMonth({ type: "care:pet-completed" as const }, time);
  }
  if (reaction.kind === "feed") {
    return withLocalMonth({ type: "care:feed-completed" as const }, time);
  }
  return null;
}

/** Uses the canonical economy carried by the existing state event. */
export function signalFromStateChanged(
  changed: GameEvents["state:changed"],
  time: SignalTime,
): AchievementSignal {
  return withLocalMonth({
    type: "progression:level-changed" as const,
    level: changed.economy.level,
  }, time);
}

/**
 * Binds the two existing foundational event-bus sources that carry enough
 * post-action truth on their own. Rich city, purchase, sleep, and settlement
 * outcomes use the typed adapters below at their existing completion hooks.
 */
export function bindCoreAchievementEvents(
  events: Pick<EventBus<GameEvents>, "on">,
  captureTime: () => SignalTime,
  onSignal: (signal: AchievementSignal) => void,
): () => void {
  const removeReaction = events.on("gooby:reaction", (reaction) => {
    const signal = signalFromGoobyReaction(reaction, captureTime());
    if (signal) onSignal(signal);
  });
  const removeState = events.on("state:changed", (changed) => {
    onSignal(signalFromStateChanged(changed, captureTime()));
  });
  return () => {
    removeReaction();
    removeState();
  };
}

/** Maps the canonical, already-idempotent minigame settlement receipt. */
export function signalFromMinigameSettlement(
  receipt: MinigameSettlementReceipt,
  previousBest: number,
  localMonth?: number,
): AchievementSignal {
  return {
    type: "minigame:run-settled",
    runId: receipt.runId,
    minigameId: receipt.minigameId,
    score: receipt.payout.score,
    previousBest,
    occurredAt: receipt.completedAt,
    ...(localMonth === undefined ? {} : { localMonth }),
  };
}

export interface CompletedCityLegContext extends SignalTime {
  readonly tripId: string;
  readonly recoveries: number;
}

/**
 * Converts only actual route-machine completion transitions. Merely selecting
 * a destination or entering the drive scene cannot earn a city sticker.
 */
export function signalFromCityTransition(
  previous: CityDriveState,
  next: CityDriveState,
  context: CompletedCityLegContext,
): AchievementSignal | null {
  if (
    previous.phase === "driving-outbound" &&
    next.phase === "arrived" &&
    previous.selected === next.selected
  ) {
    return withLocalMonth({
      type: "city:leg-completed" as const,
      tripId: context.tripId,
      leg: "outbound" as const,
      shopId: next.selected,
      recoveries: context.recoveries,
    }, context);
  }
  if (previous.phase === "driving-home" && next.phase === "destination-board") {
    return withLocalMonth({
      type: "city:leg-completed" as const,
      tripId: context.tripId,
      leg: "home" as const,
      shopId: previous.visited,
      recoveries: context.recoveries,
    }, context);
  }
  return null;
}

/** Failed, duplicate, locked, and unaffordable purchases produce no signal. */
export function signalFromPurchase(
  result: PurchaseResult,
  request: PurchaseRequest,
  shopId: ShopId,
  time: SignalTime,
): AchievementSignal | null {
  if (result.status !== "purchased" || !result.item) return null;
  return withLocalMonth({
    type: "shop:purchase-completed" as const,
    requestId: request.requestId,
    shopId,
    itemId: result.item.id,
    status: "purchased" as const,
  }, time);
}
