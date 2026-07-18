import { z } from "zod";
import { DEFAULT_AUDIO_BUS_VOLUMES } from "./audio";
import { createEconomy, levelForXp } from "./economy";
import { LANGUAGE_SETTINGS } from "./i18n";
import type { MinigameSettlementReceipt } from "./minigame";
import type { SavePort } from "./platform";
import { MINIGAME_IDS, SHOP_IDS } from "./scenes";
import { createSimulation } from "./simulation";
import { STICKER_IDS } from "./stickers";

export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.35;
export const UI_SCALE_DEFAULT = 1;

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

const VolumeSchema = z.number().min(0).max(1);

const AudioVolumesSchema = z
  .object({
    master: VolumeSchema.default(DEFAULT_AUDIO_BUS_VOLUMES.master),
    music: VolumeSchema.default(DEFAULT_AUDIO_BUS_VOLUMES.music),
    sfx: VolumeSchema.default(DEFAULT_AUDIO_BUS_VOLUMES.sfx),
    ui: VolumeSchema.default(DEFAULT_AUDIO_BUS_VOLUMES.ui),
    voice: VolumeSchema.default(DEFAULT_AUDIO_BUS_VOLUMES.voice),
  })
  .strict()
  .default({ ...DEFAULT_AUDIO_BUS_VOLUMES });

const SettingsSchema = z
  .object({
    muted: z.boolean(),
    reducedMotion: z.boolean(),
    haptics: z.boolean().default(true),
    notifications: z.boolean().default(true),
    uiScale: z.number().min(UI_SCALE_MIN).max(UI_SCALE_MAX).default(UI_SCALE_DEFAULT),
    volumes: AudioVolumesSchema,
    language: z.enum(LANGUAGE_SETTINGS).default("auto"),
  })
  .strict();

const StickerBookSchema = z
  .object({
    unlocked: z.partialRecord(z.enum(STICKER_IDS), z.number().finite()).default({}),
  })
  .strict()
  .default({ unlocked: {} });

const AchievementsSchema = z
  .object({
    unlocked: z.record(z.string().min(1), z.number().finite()).default({}),
  })
  .strict()
  .default({ unlocked: {} });

const MinigameStatSchema = z
  .object({
    plays: z.number().int().nonnegative(),
    bestScore: z.number().int().nonnegative(),
    totalScore: z.number().finite().nonnegative(),
    lastPlayedAt: z.number().finite().nullable(),
  })
  .strict();

const MinigameStatsSchema = z.partialRecord(z.enum(MINIGAME_IDS), MinigameStatSchema);

const DevWorkshopSchema = z
  .object({
    unlocked: z.boolean().default(false),
    flags: z.record(z.string().min(1), z.boolean()).default({}),
  })
  .strict()
  .default({ unlocked: false, flags: {} });

/**
 * Canonical save schema, version 3. Version-two payloads remain directly
 * parseable (all v3 additions carry defaults) and are canonicalized to
 * version 3 on output, so pre-CP1 constructors stay compile- and runtime-safe.
 */
export const SaveStateSchema = z
  .object({
    version: z
      .union([z.literal(2), z.literal(3)])
      .transform((): 3 => 3),
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
    settings: SettingsSchema,
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
    stickers: StickerBookSchema,
    achievements: AchievementsSchema,
    minigameStats: MinigameStatsSchema.default({}),
    devWorkshop: DevWorkshopSchema,
  })
  .strict();

/** Additive input shape retained so pre-canonical constructors remain compile-safe. */
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

export type SaveV1State = z.output<typeof SaveV1Schema>;

/**
 * The exact pre-CP1 canonical schema, kept as the explicit second link of the
 * v1 → v2 → v3 migration chain. Version-two payloads validate here before the
 * v3 defaults are applied, so no v2 field is ever silently dropped.
 */
export const SaveV2Schema = z
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
    settings: z
      .object({
        muted: z.boolean(),
        reducedMotion: z.boolean(),
        haptics: z.boolean().default(true),
        notifications: z.boolean().default(true),
      })
      .strict(),
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

export type SaveV2State = z.output<typeof SaveV2Schema>;

export function migrateSaveV1ToV2(old: SaveV1State): SaveV2State {
  return SaveV2Schema.parse({
    version: 2,
    profile: {
      name: old.name,
      onboardingComplete: old.onboardingComplete,
      createdAt: old.createdAt,
    },
    simulation: {
      needs: old.needs,
      lastSimulatedAt: old.lastSeenAt,
      sleep: null,
    },
    economy: {
      coins: old.coins,
      xp: old.xp,
      level: levelForXp(old.xp),
    },
    inventory: { carrot: old.carrots },
    settings: {
      muted: false,
      reducedMotion: false,
      haptics: true,
      notifications: true,
    },
  });
}

export function migrateSaveV2ToV3(old: SaveV2State): CanonicalSaveState {
  return SaveStateSchema.parse({
    ...old,
    version: 3,
    settings: {
      ...old.settings,
      uiScale: UI_SCALE_DEFAULT,
      volumes: { ...DEFAULT_AUDIO_BUS_VOLUMES },
      language: "auto",
    },
    stickers: { unlocked: {} },
    achievements: { unlocked: {} },
    minigameStats: {},
    devWorkshop: { unlocked: false, flags: {} },
  });
}

export function createDefaultSave(now: number): SaveState {
  return {
    version: 3,
    profile: { name: "Gooby", onboardingComplete: false, createdAt: now },
    simulation: createSimulation(now),
    economy: createEconomy(),
    inventory: { carrot: 3 },
    settings: {
      muted: false,
      reducedMotion: false,
      haptics: true,
      notifications: true,
      uiScale: UI_SCALE_DEFAULT,
      volumes: { ...DEFAULT_AUDIO_BUS_VOLUMES },
      language: "auto",
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
    stickers: { unlocked: {} },
    achievements: { unlocked: {} },
    minigameStats: {},
    devWorkshop: { unlocked: false, flags: {} },
  };
}

function repairDerivedLevel(state: CanonicalSaveState): CanonicalSaveState {
  return SaveStateSchema.parse({
    ...state,
    economy: { ...state.economy, level: levelForXp(state.economy.xp) },
  });
}

function payloadVersion(input: unknown): number | null {
  if (typeof input !== "object" || input === null || !("version" in input)) return null;
  const version = input.version;
  return typeof version === "number" ? version : null;
}

/**
 * Migration chain: v1 → v2 → v3. Each historical version validates against
 * its own frozen schema before stepping forward, so every field a previous
 * version persisted is preserved verbatim and only new fields gain defaults.
 */
export function migrateSave(input: unknown): CanonicalSaveState | null {
  const version = payloadVersion(input);
  if (version === 1) {
    const old = SaveV1Schema.safeParse(input);
    if (!old.success) return null;
    return repairDerivedLevel(migrateSaveV2ToV3(migrateSaveV1ToV2(old.data)));
  }
  if (version === 2) {
    const v2 = SaveV2Schema.safeParse(input);
    if (v2.success) return repairDerivedLevel(migrateSaveV2ToV3(v2.data));
    // A version-2 payload written by a v3 runtime may already carry v3 fields.
    const current = SaveStateSchema.safeParse(input);
    return current.success ? repairDerivedLevel(current.data) : null;
  }
  const current = SaveStateSchema.safeParse(input);
  return current.success ? repairDerivedLevel(current.data) : null;
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
