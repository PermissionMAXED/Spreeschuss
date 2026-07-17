import { z } from "zod";
import { createEconomy, levelForXp } from "./economy";
import type { SavePort } from "./platform";
import { createSimulation } from "./simulation";

const NeedsSchema = z.object({
  hunger: z.number().min(0).max(100),
  energy: z.number().min(0).max(100),
  hygiene: z.number().min(0).max(100),
  fun: z.number().min(0).max(100),
});

const SleepSchema = z
  .object({
    startedAt: z.number().finite(),
    completesAt: z.number().finite(),
  })
  .refine((sleep) => sleep.completesAt > sleep.startedAt, "Sleep must end after it starts");

export const SaveStateSchema = z
  .object({
    version: z.literal(2),
    profile: z.object({
      name: z.string().trim().min(1).max(20),
      onboardingComplete: z.boolean(),
      createdAt: z.number().finite(),
    }),
    simulation: z.object({
      needs: NeedsSchema,
      lastSimulatedAt: z.number().finite(),
      sleep: SleepSchema.nullable(),
    }),
    economy: z.object({
      coins: z.number().int().nonnegative(),
      xp: z.number().int().nonnegative(),
      level: z.number().int().positive(),
    }),
    inventory: z.record(z.string(), z.number().int().nonnegative()),
    settings: z.object({
      muted: z.boolean(),
      reducedMotion: z.boolean(),
    }),
  })
  .strict();

export type SaveState = z.infer<typeof SaveStateSchema>;

const SaveV1Schema = z.object({
  version: z.literal(1),
  name: z.string().default("Gooby"),
  onboardingComplete: z.boolean().default(false),
  createdAt: z.number().finite(),
  lastSeenAt: z.number().finite(),
  needs: NeedsSchema,
  coins: z.number().int().nonnegative().default(40),
  xp: z.number().int().nonnegative().default(0),
  carrots: z.number().int().nonnegative().default(3),
});

export function createDefaultSave(now: number): SaveState {
  return {
    version: 2,
    profile: { name: "Gooby", onboardingComplete: false, createdAt: now },
    simulation: createSimulation(now),
    economy: createEconomy(),
    inventory: { carrot: 3 },
    settings: { muted: false, reducedMotion: false },
  };
}

export function migrateSave(input: unknown): SaveState | null {
  const current = SaveStateSchema.safeParse(input);
  if (current.success) {
    return {
      ...current.data,
      economy: { ...current.data.economy, level: levelForXp(current.data.economy.xp) },
    };
  }

  const old = SaveV1Schema.safeParse(input);
  if (!old.success) return null;
  return {
    version: 2,
    profile: {
      name: old.data.name,
      onboardingComplete: old.data.onboardingComplete,
      createdAt: old.data.createdAt,
    },
    simulation: {
      needs: old.data.needs,
      lastSimulatedAt: old.data.lastSeenAt,
      sleep: null,
    },
    economy: {
      coins: old.data.coins,
      xp: old.data.xp,
      level: levelForXp(old.data.xp),
    },
    inventory: { carrot: old.data.carrots },
    settings: { muted: false, reducedMotion: false },
  };
}

export async function loadSave(
  port: SavePort,
  now: number,
): Promise<{ state: SaveState; revision: number; recovered: boolean }> {
  const record = await port.load();
  if (!record) return { state: createDefaultSave(now), revision: 0, recovered: false };
  const state = migrateSave(record.payload);
  return state
    ? { state, revision: record.revision, recovered: false }
    : { state: createDefaultSave(now), revision: record.revision, recovered: true };
}

export async function commitSave(port: SavePort, expectedRevision: number, state: SaveState): Promise<number> {
  const validated = SaveStateSchema.parse(state);
  return (await port.commit(expectedRevision, validated)).revision;
}
