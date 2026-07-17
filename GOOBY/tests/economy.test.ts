import { describe, expect, it } from "vitest";
import { createEconomy, grantReward, levelForXp, spendCoins, xpRequiredForLevel } from "../src/core/contracts/economy";
import { createDefaultSave } from "../src/core/contracts/save";
import { purchaseCatalogItem, visibleInventory } from "../src/scenes/shops";

describe("economy", () => {
  it("advances levels from cumulative XP", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(xpRequiredForLevel(3)).toBe(400);
    expect(grantReward(createEconomy(), { coins: 5, xp: 400 })).toEqual({ coins: 45, xp: 400, level: 3 });
  });

  it("refuses unaffordable purchases without mutating state", () => {
    const economy = createEconomy();
    expect(spendCoins(economy, 41)).toBeNull();
    expect(spendCoins(economy, 12)).toEqual({ ...economy, coins: 28 });
    expect(economy.coins).toBe(40);
  });

  it("persists an idempotency receipt so a retried purchase charges exactly once", () => {
    const initial = createDefaultSave(1_000);
    const request = { itemId: "crisp-carrot", requestId: "retry-safe-0001" };
    const first = purchaseCatalogItem(initial, request);
    const retry = purchaseCatalogItem(first.state, request);

    expect(first.status).toBe("purchased");
    expect(retry.status).toBe("duplicate");
    expect(retry.state.economy.coins).toBe(initial.economy.coins - 4);
    expect(retry.state.inventory["crisp-carrot"]).toBe(1);
    expect(visibleInventory(retry.state.inventory)).toEqual({
      carrot: 3,
      "crisp-carrot": 1,
    });
    expect(initial).toEqual(createDefaultSave(1_000));
  });

  it("does not reserve failed request ids or mutate balances", () => {
    const initial = createDefaultSave(2_000);
    const invalid = purchaseCatalogItem(initial, {
      itemId: "crisp-carrot",
      requestId: "short",
    });
    expect(invalid.status).toBe("invalid-request");
    expect(invalid.state).toEqual(initial);

    const retry = purchaseCatalogItem(invalid.state, {
      itemId: "crisp-carrot",
      requestId: "retry-valid-0002",
    });
    expect(retry.status).toBe("purchased");
    expect(retry.state.economy.coins).toBe(36);
  });
});
