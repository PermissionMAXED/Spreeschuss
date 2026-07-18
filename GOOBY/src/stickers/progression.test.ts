import { describe, expect, it } from "vitest";
import {
  EventBus,
  type GameEvents,
} from "../core/contracts/events";
import {
  SaveStateSchema,
  createDefaultSave,
  type CanonicalSaveState,
} from "../core/contracts/save";
import {
  MINIGAME_IDS,
  SHOP_IDS,
  type ShopId,
} from "../core/contracts/scenes";
import {
  STICKER_IDS,
  STICKER_PAGE_IDS,
  stickersOnPage,
} from "../core/contracts/stickers";
import {
  ACHIEVEMENT_DEFINITIONS,
} from "../data/achievements";
import { CityRouteMachine } from "../scenes/city";
import { purchaseCatalogItem } from "../scenes/shops/economy";
import {
  bindCoreAchievementEvents,
  signalFromCityTransition,
  signalFromGoobyReaction,
  signalFromMinigameSettlement,
  signalFromPurchase,
  signalFromStateChanged,
} from "./adapters";
import { StickerCelebrationQueue } from "./celebrations";
import {
  achievementProgress,
  hasClaimedPageReward,
  isStickerNew,
  markStickerSeen,
  processAchievementSignal,
  type AchievementSignal,
  type AchievementUpdate,
} from "./progression";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

function freshState(): CanonicalSaveState {
  return SaveStateSchema.parse(createDefaultSave(0));
}

function allReachableSignals(): readonly AchievementSignal[] {
  const signals: AchievementSignal[] = [
    { type: "care:pet-completed", occurredAt: 1, localMonth: 1 },
    { type: "care:feed-completed", occurredAt: 2 },
    { type: "care:bath-completed", occurredAt: 3 },
    {
      type: "care:sleep-started",
      occurredAt: 4,
      sleepId: "sleep-0",
      localHour: 23,
    },
    {
      type: "care:sleep-completed",
      occurredAt: DAY_MS,
      sleepId: "sleep-0",
      startedLocalHour: 23,
    },
    {
      type: "care:wake-completed",
      occurredAt: 2 * DAY_MS + 6 * HOUR_MS,
      sleepId: "sleep-early",
      localHour: 6,
      gentle: true,
      early: true,
    },
    {
      type: "care:harvest-completed",
      occurredAt: 6,
      harvestId: "harvest-0",
      harvested: true,
    },
    {
      type: "care:outfit-equipped",
      occurredAt: 7,
      actionId: "outfit-0",
      itemId: "sunny-bucket-hat",
      owned: true,
    },
    {
      type: "care:decor-placed",
      occurredAt: 8,
      placementId: "placement-0",
      itemId: "apricot-floor-cushion",
      placed: true,
    },
    { type: "progression:level-changed", occurredAt: 9, level: 5 },
  ];

  for (let trip = 0; trip < 5; trip += 1) {
    const shopId = SHOP_IDS[trip % SHOP_IDS.length] as ShopId;
    signals.push({
      type: "city:leg-completed",
      occurredAt: 100 + trip * 2,
      tripId: `trip-${trip}`,
      leg: "outbound",
      shopId,
      recoveries: 0,
    });
    signals.push({
      type: "city:leg-completed",
      occurredAt: 101 + trip * 2,
      tripId: `trip-${trip}`,
      leg: "home",
      shopId,
      recoveries: 0,
    });
  }
  for (const [index, shopId] of SHOP_IDS.entries()) {
    signals.push({
      type: "shop:purchase-completed",
      occurredAt: 200 + index,
      requestId: `purchase-${index}`,
      shopId,
      itemId: `owned-item-${index}`,
      status: "purchased",
    });
  }
  for (let run = 0; run < 100; run += 1) {
    const minigameId = MINIGAME_IDS[run % MINIGAME_IDS.length];
    if (!minigameId) throw new Error("The frozen minigame roster cannot be empty");
    signals.push({
      type: "minigame:run-settled",
      occurredAt: 1_000 + run,
      runId: `run-${run}`,
      minigameId,
      score: run === 1 ? 20 : 10,
      previousBest: run === 1 ? 10 : run === 0 ? 0 : 10,
    });
  }
  for (let day = 2; day <= 7; day += 1) {
    signals.push({
      type: "care:sleep-completed",
      occurredAt: day * DAY_MS,
      sleepId: `sleep-${day}`,
      startedLocalHour: 20,
    });
  }
  signals.push(
    { type: "care:pet-completed", occurredAt: 300, localMonth: 4 },
    { type: "care:pet-completed", occurredAt: 301, localMonth: 7 },
    { type: "care:pet-completed", occurredAt: 302, localMonth: 10 },
  );
  return signals;
}

function applyAll(
  state: CanonicalSaveState,
  signals: readonly AchievementSignal[],
): { readonly state: CanonicalSaveState; readonly updates: readonly AchievementUpdate[] } {
  const updates: AchievementUpdate[] = [];
  let current = state;
  for (const signal of signals) {
    const update = processAchievementSignal(current, signal);
    updates.push(update);
    current = update.state;
  }
  return { state: current, updates };
}

describe("achievement definitions and deterministic progression", () => {
  it("maps one reachable definition to each frozen sticker and page slot", () => {
    expect(ACHIEVEMENT_DEFINITIONS.map(({ id }) => id)).toEqual(STICKER_IDS);
    expect(new Set(ACHIEVEMENT_DEFINITIONS.map(({ id }) => id)).size).toBe(36);
    expect(STICKER_PAGE_IDS.map((page) => stickersOnPage(page).length)).toEqual([9, 9, 9, 9]);

    const reached = applyAll(freshState(), allReachableSignals()).state;
    expect(Object.keys(reached.stickers.unlocked).sort()).toEqual([...STICKER_IDS].sort());
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
      expect(achievementProgress(reached, definition)).toEqual({
        current: definition.target,
        target: definition.target,
        complete: true,
      });
    }
  });

  it("uses successful real care, drive, purchase, and arcade facts", () => {
    let state = freshState();
    const pet = signalFromGoobyReaction({ kind: "pet" }, { occurredAt: 10 });
    if (!pet) throw new Error("A real pet reaction must map to progression");
    state = processAchievementSignal(state, pet).state;
    expect(state.stickers.unlocked["sticker.care.first-pet"]).toBe(10);

    const route = new CityRouteMachine();
    route.selectDestination("carrot-market");
    route.confirmDeparture();
    const driving = route.state;
    route.arrive("carrot-market");
    const firstDrive = signalFromCityTransition(driving, route.state, {
      tripId: "first-real-drive",
      recoveries: 1,
      occurredAt: 20,
    });
    if (!firstDrive) throw new Error("A real arrival transition must map to progression");
    state = processAchievementSignal(state, firstDrive).state;
    expect(state.stickers.unlocked["sticker.city.first-trip"]).toBe(20);
    expect(state.stickers.unlocked["sticker.city.smooth-driver"]).toBeUndefined();

    const firstSettlement = signalFromMinigameSettlement({
      runId: "first-real-settlement",
      minigameId: "carrot-catch",
      payout: { score: 40, coins: 2, xp: 3 },
      bestScore: 40,
      completedAt: 30,
    }, 0);
    state = processAchievementSignal(state, firstSettlement).state;
    expect(state.stickers.unlocked["sticker.games.first-round"]).toBe(30);
    expect(state.stickers.unlocked["sticker.games.new-best"]).toBeUndefined();

    const improvedSettlement = signalFromMinigameSettlement({
      runId: "improved-real-settlement",
      minigameId: "carrot-catch",
      payout: { score: 50, coins: 2, xp: 3 },
      bestScore: 50,
      completedAt: 31,
    }, 40);
    state = processAchievementSignal(state, improvedSettlement).state;
    expect(state.stickers.unlocked["sticker.games.new-best"]).toBe(31);

    const request = { itemId: "crisp-carrot", requestId: "market-buy-0001" };
    const purchase = purchaseCatalogItem(state, request);
    const purchaseSignal = signalFromPurchase(
      purchase,
      request,
      "carrot-market",
      { occurredAt: 40 },
    );
    if (!purchaseSignal) throw new Error("A real successful purchase must map to progression");
    state = processAchievementSignal(SaveStateSchema.parse(purchase.state), purchaseSignal).state;
    expect(state.stickers.unlocked["sticker.city.market-day"]).toBe(40);

    const levelSignal = signalFromStateChanged({
      simulation: state.simulation,
      economy: { coins: state.economy.coins, xp: 1_600, level: 5 },
    }, { occurredAt: 50 });
    state = processAchievementSignal(state, levelSignal).state;
    expect(state.stickers.unlocked["sticker.care.level-five"]).toBe(50);
  });

  it("binds existing post-action event-bus facts and removes listeners cleanly", () => {
    const events = new EventBus<GameEvents>();
    const signals: AchievementSignal[] = [];
    let occurredAt = 0;
    const remove = bindCoreAchievementEvents(
      events,
      () => ({ occurredAt: occurredAt += 1 }),
      (signal) => signals.push(signal),
    );
    events.emit("gooby:reaction", { kind: "tickle" });
    events.emit("gooby:reaction", { kind: "pet" });
    events.emit("state:changed", {
      simulation: freshState().simulation,
      economy: { coins: 40, xp: 1_600, level: 5 },
    });
    expect(signals.map(({ type }) => type)).toEqual([
      "care:pet-completed",
      "progression:level-changed",
    ]);
    remove();
    events.emit("gooby:reaction", { kind: "feed" });
    expect(signals).toHaveLength(2);
  });

  it("ignores failed care actions and only accepts completed purchases", () => {
    let state = freshState();
    state = processAchievementSignal(state, {
      type: "care:harvest-completed",
      occurredAt: 1,
      harvestId: "quota-full",
      harvested: false,
    }).state;
    state = processAchievementSignal(state, {
      type: "care:outfit-equipped",
      occurredAt: 2,
      actionId: "not-owned",
      itemId: "sunny-bucket-hat",
      owned: false,
    }).state;
    state = processAchievementSignal(state, {
      type: "care:decor-placed",
      occurredAt: 3,
      placementId: "blocked",
      itemId: "apricot-floor-cushion",
      placed: false,
    }).state;
    expect(state.stickers.unlocked["sticker.care.garden-harvest"]).toBeUndefined();
    expect(state.stickers.unlocked["sticker.care.wardrobe-first-outfit"]).toBeUndefined();
    expect(state.stickers.unlocked["sticker.care.decorated-room"]).toBeUndefined();
  });

  it("is exactly-once for duplicate delivery and a serialized reload", () => {
    const signal: AchievementSignal = {
      type: "minigame:run-settled",
      occurredAt: 50,
      runId: "stable-run-id",
      minigameId: "carrot-catch",
      score: 10,
      previousBest: 0,
    };
    const first = processAchievementSignal(freshState(), signal);
    expect(first.duplicate).toBe(false);
    expect(first.newlyUnlocked).toContain("sticker.games.first-round");

    const duplicate = processAchievementSignal(first.state, signal);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.newlyUnlocked).toEqual([]);

    const reloaded = SaveStateSchema.parse(JSON.parse(JSON.stringify(first.state)));
    const afterReload = processAchievementSignal(reloaded, signal);
    expect(afterReload.duplicate).toBe(true);
    expect(afterReload.state).toBe(reloaded);
  });

  it("keeps every trigger exactly-once when the complete event stream replays", () => {
    const signals = allReachableSignals();
    const firstPass = applyAll(freshState(), signals).state;
    const unlockTimes = { ...firstPass.stickers.unlocked };
    const coins = firstPass.economy.coins;

    const replay = applyAll(
      SaveStateSchema.parse(JSON.parse(JSON.stringify(firstPass))),
      signals,
    );
    expect(replay.state.stickers.unlocked).toEqual(unlockTimes);
    expect(replay.state.economy.coins).toBe(coins);
    expect(replay.updates.every(({ newlyUnlocked }) => newlyUnlocked.length === 0)).toBe(true);
    expect(replay.updates.every(({ pageRewards }) => pageRewards.length === 0)).toBe(true);
  });

  it("grants each completed-page reward once, including after reload", () => {
    const initial = freshState();
    const completed = applyAll(initial, allReachableSignals());
    expect(completed.state.economy.coins).toBe(initial.economy.coins + 200);
    expect(STICKER_PAGE_IDS.every((page) => hasClaimedPageReward(completed.state, page))).toBe(true);
    expect(completed.updates.flatMap(({ pageRewards }) => pageRewards).map(({ page }) => page).sort())
      .toEqual([...STICKER_PAGE_IDS].sort());

    const reloaded = SaveStateSchema.parse(JSON.parse(JSON.stringify(completed.state)));
    const replayed = applyAll(reloaded, allReachableSignals());
    expect(replayed.state.economy.coins).toBe(completed.state.economy.coins);
    expect(replayed.updates.flatMap(({ pageRewards }) => pageRewards)).toEqual([]);
  });

  it("persists new badges and never rewrites unlock or seen timestamps", () => {
    const unlocked = processAchievementSignal(freshState(), {
      type: "care:pet-completed",
      occurredAt: 100,
    }).state;
    expect(isStickerNew(unlocked, "sticker.care.first-pet")).toBe(true);

    const seen = markStickerSeen(unlocked, "sticker.care.first-pet", 200);
    expect(isStickerNew(seen, "sticker.care.first-pet")).toBe(false);
    const seenAgain = markStickerSeen(seen, "sticker.care.first-pet", 300);
    expect(seenAgain).toBe(seen);
    expect(seenAgain.stickers.unlocked["sticker.care.first-pet"]).toBe(100);
  });
});

describe("sticker celebration sequencing", () => {
  it("waits for gameplay results, de-duplicates, and marks stickers seen", () => {
    const update = processAchievementSignal(freshState(), {
      type: "minigame:run-settled",
      occurredAt: 100,
      runId: "result-run",
      minigameId: "carrot-catch",
      score: 10,
      previousBest: 0,
    });
    const queue = new StickerCelebrationQueue();
    queue.setGameplayResultsVisible(true);
    queue.enqueueUpdate(update);
    queue.enqueueUpdate(update);
    expect(queue.length).toBe(update.newlyUnlocked.length);
    expect(queue.next()).toBeNull();

    queue.setGameplayResultsVisible(false);
    const celebration = queue.next();
    expect(celebration).toEqual({
      kind: "sticker",
      stickerId: "sticker.games.first-round",
    });
    const seen = queue.dismiss(update.state, 200);
    expect(isStickerNew(seen, "sticker.games.first-round")).toBe(false);
  });

  it("hydrates only unseen unlocks after reload in frozen order", () => {
    const progressed = applyAll(freshState(), allReachableSignals()).state;
    const firstSeen = markStickerSeen(progressed, STICKER_IDS[0], 999);
    const reloaded = SaveStateSchema.parse(JSON.parse(JSON.stringify(firstSeen)));
    const queue = new StickerCelebrationQueue();
    queue.enqueueUnseen(reloaded);
    expect(queue.length).toBe(35);
    expect(queue.next()).toEqual({ kind: "sticker", stickerId: STICKER_IDS[1] });
  });
});
