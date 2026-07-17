import { z } from "zod";
import { createEconomy, levelForXp } from "./economy";
import type { MinigameSettlementReceipt } from "./minigame";
import type { SavePort } from "./platform";
import { MINIGAME_IDS, SHOP_IDS } from "./scenes";
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

const HighScoresSchema = z.partialRecord(
  z.enum(MINIGAME_IDS),
  z.number().int().nonnegative(),
);

const UiStateSchema = z
  .object({
    equipped: z.record(z.string(), z.string().min(1)).default({}),
    highScores: HighScoresSchema.default({}),
    sleepRationaleSeen: z.boolean().default(false),
  })
  .strict()
  .default({
    equipped: {},
    highScores: {},
    sleepRationaleSeen: false,
  });

const QuietHoursSchema = z
  .object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  })
  .strict();

const NotificationPolicySchema = z
  .object({
    quietHours: QuietHoursSchema.nullable().default(null),
    suppressWhenForeground: z.boolean().default(true),
  })
  .strict()
  .default({
    quietHours: null,
    suppressWhenForeground: true,
  });

const MinigamePayoutSchema = z
  .object({
    coins: z.number().finite().nonnegative(),
    xp: z.number().finite().nonnegative(),
    score: z.number().finite().nonnegative(),
  })
  .strict();

const MinigameSettlementSchema = z
  .object({
    runId: z.string().trim().min(1).max(128),
    minigameId: z.enum(MINIGAME_IDS),
    payout: MinigamePayoutSchema,
    bestScore: z.number().finite().nonnegative(),
    completedAt: z.number().finite(),
  })
  .strict() satisfies z.ZodType<MinigameSettlementReceipt>;

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
      haptics: z.boolean().default(true),
      notifications: z.boolean().default(true),
    }).strict(),
    ui: UiStateSchema,
    travel: z
      .object({
        visitedShops: z.array(z.enum(SHOP_IDS)).default([]),
      })
      .strict()
      .default({ visitedShops: [] }),
    dailyHarvest: z
      .object({
        day: z.number().int().nonnegative().nullable().default(null),
        count: z.number().int().nonnegative().default(0),
      })
      .strict()
      .default({ day: null, count: 0 }),
    notificationPolicy: NotificationPolicySchema,
    minigameSettlement: MinigameSettlementSchema.nullable().default(null),
  })
  .strict();

/** Additive input shape retained so pre-canonical v2 constructors remain compile-safe. */
export type SaveState = z.input<typeof SaveStateSchema>;
export type CanonicalSaveState = z.output<typeof SaveStateSchema>;

const SaveV1Schema = z.object({
  version: z.literal(1),
  name: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((name) => name || "Gooby"),
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
    settings: {
      muted: false,
      reducedMotion: false,
      haptics: true,
      notifications: true,
    },
    ui: {
      equipped: {},
      highScores: {},
      sleepRationaleSeen: false,
    },
    travel: { visitedShops: [] },
    dailyHarvest: { day: null, count: 0 },
    notificationPolicy: {
      quietHours: null,
      suppressWhenForeground: true,
    },
    minigameSettlement: null,
  };
}

export function migrateSave(input: unknown): CanonicalSaveState | null {
  const current = SaveStateSchema.safeParse(input);
  if (current.success) {
    return SaveStateSchema.parse({
      ...current.data,
      economy: { ...current.data.economy, level: levelForXp(current.data.economy.xp) },
    });
  }

  const old = SaveV1Schema.safeParse(input);
  if (!old.success) return null;
  return SaveStateSchema.parse({
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
    settings: {
      muted: false,
      reducedMotion: false,
      haptics: true,
      notifications: true,
    },
  });
}

export async function loadSave(
  port: SavePort,
  now: number,
): Promise<{ state: CanonicalSaveState; revision: number; recovered: boolean }> {
  const record = await port.load();
  if (!record) {
    return {
      state: SaveStateSchema.parse(createDefaultSave(now)),
      revision: 0,
      recovered: false,
    };
  }
  const state = migrateSave(record.payload);
  return state
    ? { state, revision: record.revision, recovered: false }
    : {
        state: SaveStateSchema.parse(createDefaultSave(now)),
        revision: record.revision,
        recovered: true,
      };
}

export async function commitSave(port: SavePort, expectedRevision: number, state: SaveState): Promise<number> {
  const validated = SaveStateSchema.parse(state);
  return (await port.commit(expectedRevision, validated)).revision;
}
