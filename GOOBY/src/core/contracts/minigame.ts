import type { Clock } from "./clock";
import type { RandomSource } from "./rng";
import type { MinigameId } from "./scenes";

/** Every player-facing manifest string ships in both supported languages. */
export interface LocalizedText {
  readonly en: string;
  readonly de: string;
}

export const MINIGAME_CATEGORIES = [
  "action",
  "puzzle",
  "rhythm",
  "care",
  "skill",
] as const;
export type MinigameCategory = (typeof MINIGAME_CATEGORIES)[number];

/** Shared feedback cues a minigame may emit through the injected audio port. */
export const MINIGAME_AUDIO_CUES = [
  "hit",
  "miss",
  "combo",
  "countdown",
  "go",
  "win",
  "lose",
  "score",
] as const;
export type MinigameAudioCue = (typeof MINIGAME_AUDIO_CUES)[number];

export interface MinigameTutorialStep {
  readonly icon: string;
  readonly title: LocalizedText;
  readonly body: LocalizedText;
}

export const MINIGAME_TUTORIAL_MIN_STEPS = 2;
export const MINIGAME_TUTORIAL_MAX_STEPS = 4;

/**
 * Development-only provenance marker. Checkpoint stubs are fully playable and
 * are never branded as stubs in player-facing strings; only this metadata
 * records that a dedicated specialist build is still expected.
 */
export interface MinigameDevMetadata {
  readonly cpStub: true;
  readonly checkpoint: "CP1";
}

export interface MinigameManifest {
  readonly id: MinigameId;
  readonly title: LocalizedText;
  readonly instructions: LocalizedText;
  readonly icon: string;
  readonly category: MinigameCategory;
  /** True when the module renders into the shared 3D stage instead of DOM. */
  readonly stage3d: boolean;
  /** Between two and four onboarding steps, localized in both languages. */
  readonly tutorial: readonly MinigameTutorialStep[];
  /** Non-empty set of shared audio cues the module emits. */
  readonly audioCues: readonly MinigameAudioCue[];
  readonly unlockLevel: number;
  readonly dev?: MinigameDevMetadata;
}

function assertLocalized(text: LocalizedText, label: string): void {
  if (text.en.trim().length === 0 || text.de.trim().length === 0) {
    throw new Error(`${label} must provide non-empty English and German strings`);
  }
}

/** Throws when a manifest violates the frozen CP1 metadata contract. */
export function validateMinigameManifest(manifest: MinigameManifest): MinigameManifest {
  assertLocalized(manifest.title, `Manifest ${manifest.id} title`);
  assertLocalized(manifest.instructions, `Manifest ${manifest.id} instructions`);
  if (manifest.icon.trim().length === 0) {
    throw new Error(`Manifest ${manifest.id} requires an icon glyph`);
  }
  if (
    manifest.tutorial.length < MINIGAME_TUTORIAL_MIN_STEPS ||
    manifest.tutorial.length > MINIGAME_TUTORIAL_MAX_STEPS
  ) {
    throw new Error(`Manifest ${manifest.id} tutorial requires two to four steps`);
  }
  for (const [index, step] of manifest.tutorial.entries()) {
    assertLocalized(step.title, `Manifest ${manifest.id} tutorial step ${index} title`);
    assertLocalized(step.body, `Manifest ${manifest.id} tutorial step ${index} body`);
  }
  if (manifest.audioCues.length === 0) {
    throw new Error(`Manifest ${manifest.id} must declare at least one audio cue`);
  }
  if (new Set(manifest.audioCues).size !== manifest.audioCues.length) {
    throw new Error(`Manifest ${manifest.id} audio cues must be unique`);
  }
  if (!Number.isInteger(manifest.unlockLevel) || manifest.unlockLevel < 1) {
    throw new Error(`Manifest ${manifest.id} unlock level must be a positive integer`);
  }
  return manifest;
}

export interface MinigamePayout {
  readonly coins: number;
  readonly xp: number;
  readonly score: number;
}

export type MinigameRunId = string;

export interface MinigameSettlementReceipt {
  readonly runId: MinigameRunId;
  readonly minigameId: MinigameId;
  readonly payout: MinigamePayout;
  readonly bestScore: number;
  readonly completedAt: number;
}

export type MinigameFeedbackEvent =
  | { readonly kind: "run-began"; readonly minigameId: MinigameId; readonly runId: MinigameRunId }
  | { readonly kind: "run-completed"; readonly receipt: MinigameSettlementReceipt }
  | { readonly kind: "run-exited"; readonly minigameId: MinigameId; readonly runId: MinigameRunId };

/** Shared audio/haptic/visual feedback is injected instead of being owned by a minigame. */
export interface MinigameFeedback {
  emit(event: MinigameFeedbackEvent): void;
}

/**
 * Settlement implementations must return the previously persisted receipt for a
 * duplicate run id and apply its payout at most once.
 */
export interface MinigameSettlementPersistence {
  getBestScore(minigameId: MinigameId): number;
  getSettlement(runId: MinigameRunId): MinigameSettlementReceipt | null;
  settle(receipt: MinigameSettlementReceipt): MinigameSettlementReceipt;
}

export interface MinigameLifecycle {
  readonly feedback: MinigameFeedback;
  readonly persistedBest: number;
  beginRun(): MinigameRunId;
  completeRun(runId: MinigameRunId, payout: MinigamePayout): MinigameSettlementReceipt;
  /** Exiting abandons the active run and never settles a payout. */
  exit(): void;
}

function validatePayout(payout: MinigamePayout): void {
  if (
    !Number.isFinite(payout.coins) ||
    !Number.isFinite(payout.xp) ||
    !Number.isFinite(payout.score) ||
    payout.coins < 0 ||
    payout.xp < 0 ||
    payout.score < 0
  ) {
    throw new RangeError("Minigame payout values must be finite and non-negative");
  }
}

export function createMinigameLifecycle(
  minigameId: MinigameId,
  clock: Clock,
  persistence: MinigameSettlementPersistence,
  feedback: MinigameFeedback,
): MinigameLifecycle {
  let activeRun: MinigameRunId | null = null;
  let sequence = 0;

  return {
    feedback,
    get persistedBest() {
      return persistence.getBestScore(minigameId);
    },
    beginRun() {
      if (activeRun) {
        feedback.emit({ kind: "run-exited", minigameId, runId: activeRun });
      }
      do {
        sequence += 1;
        activeRun = `${minigameId}:${clock.now()}:${sequence}`;
      } while (persistence.getSettlement(activeRun));
      feedback.emit({ kind: "run-began", minigameId, runId: activeRun });
      return activeRun;
    },
    completeRun(runId, payout) {
      const previous = persistence.getSettlement(runId);
      if (previous) return previous;
      if (runId !== activeRun) throw new Error("Cannot settle an inactive minigame run");
      validatePayout(payout);
      const receipt = persistence.settle({
        runId,
        minigameId,
        payout: { ...payout },
        bestScore: Math.max(persistence.getBestScore(minigameId), payout.score),
        completedAt: clock.now(),
      });
      activeRun = null;
      feedback.emit({ kind: "run-completed", receipt });
      return receipt;
    },
    exit() {
      if (!activeRun) return;
      const runId = activeRun;
      activeRun = null;
      feedback.emit({ kind: "run-exited", minigameId, runId });
    },
  };
}

export interface MinigameContext {
  readonly clock: Clock;
  readonly rng: RandomSource;
  readonly mount: HTMLElement;
  /** New integrations should use this explicit, replay-safe lifecycle. */
  readonly lifecycle?: MinigameLifecycle;
  /** @deprecated Use lifecycle.completeRun(runId, payout). */
  finish(payout: MinigamePayout): void;
}

export interface MinigameModule {
  readonly id: MinigameId;
  readonly title: string;
  readonly instructions: string;
  mount(context: MinigameContext): void | Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  update(deltaSeconds: number): void;
  payout(): MinigamePayout;
  dispose(): void;
}

export type MinigameFactory = () => MinigameModule;
