import { describe, expect, it } from "vitest";
import { createEconomy, grantReward, levelForXp, spendCoins, xpRequiredForLevel } from "../src/core/contracts/economy";

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
});
