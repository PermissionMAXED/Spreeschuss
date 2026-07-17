export interface Economy {
  readonly coins: number;
  readonly xp: number;
  readonly level: number;
}

export const createEconomy = (): Economy => ({ coins: 40, xp: 0, level: 1 });

export function xpRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError("Level must be a positive integer");
  return 100 * (level - 1) * (level - 1);
}

export function levelForXp(xp: number): number {
  const safeXp = Math.max(0, Math.floor(xp));
  return Math.max(1, Math.floor(Math.sqrt(safeXp / 100)) + 1);
}

export function grantReward(economy: Economy, reward: { coins?: number; xp?: number }): Economy {
  const coins = Math.max(0, Math.floor(economy.coins + (reward.coins ?? 0)));
  const xp = Math.max(0, Math.floor(economy.xp + (reward.xp ?? 0)));
  return { coins, xp, level: levelForXp(xp) };
}

export function spendCoins(economy: Economy, amount: number): Economy | null {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("Spend amount must be non-negative");
  return economy.coins < amount ? null : { ...economy, coins: economy.coins - amount };
}
