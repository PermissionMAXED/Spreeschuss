import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const BUNNY_WORLD_WIDTH = 360;
export const BUNNY_VIEW_HEIGHT = 640;

/** Horizontal slack (px) that always counts as standing on a platform. */
export const LANDING_MARGIN_PX = 13;
/** Extra horizontal slack that opens a coyote window instead of a miss. */
export const COYOTE_EXTRA_MARGIN_PX = 26;
/** How long a near-miss stays recoverable by steering back over the edge. */
export const COYOTE_WINDOW_SECONDS = 0.12;
/** Feather double jumps stored at once. */
export const FEATHER_MAX_CHARGES = 2;
/** Jump taps pressed while still rising stay buffered this long. */
export const JUMP_BUFFER_SECONDS = 0.12;
export const HOP_VELOCITY = 385;
export const SPRING_VELOCITY = 505;

export type PlatformKind = "static" | "moving" | "crumble" | "spring";
export type HeightBand = "meadow" | "sunset" | "clouds" | "space";
export type PickupKind = "carrot" | "star" | "feather";
export type BunnyHopVariant = "day" | "night";

export interface HopPlatform {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly kind: PlatformKind;
  readonly velocityX: number;
  readonly crumbleSeconds: number | null;
}

export interface HopPickup {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly kind: PickupKind;
}

export type BunnyHopEvent =
  | { readonly type: "land"; readonly kind: PlatformKind; readonly x: number; readonly y: number; readonly coyote: boolean }
  | { readonly type: "pickup"; readonly kind: PickupKind; readonly x: number; readonly y: number; readonly points: number }
  | { readonly type: "double-jump"; readonly x: number; readonly y: number; readonly remainingCharges: number }
  | { readonly type: "band"; readonly band: HeightBand }
  | { readonly type: "fall" };

export interface BunnyHopSnapshot {
  readonly elapsed: number;
  readonly bunnyX: number;
  readonly bunnyY: number;
  readonly velocityY: number;
  readonly steering: number;
  readonly cameraBottom: number;
  readonly maxHeight: number;
  readonly score: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly pickups: number;
  readonly featherCharges: number;
  readonly doubleJumps: number;
  readonly coyoteRemaining: number;
  readonly variant: BunnyHopVariant;
  readonly band: HeightBand;
  readonly platforms: readonly HopPlatform[];
  readonly pickupItems: readonly HopPickup[];
  readonly ended: boolean;
  readonly disposed: boolean;
}

/**
 * Pure landing arbiter shared by the simulation and its tests. A descending
 * crossing within the landing margin is a landing; a crossing inside the
 * extra coyote margin is a recoverable near-miss instead of a silent drop.
 */
export function resolveCrossing(
  bunnyX: number,
  platformX: number,
  platformWidth: number,
): "land" | "coyote" | "miss" {
  const distance = wrappedDistance(bunnyX, platformX);
  if (distance <= platformWidth / 2 + LANDING_MARGIN_PX) return "land";
  if (distance <= platformWidth / 2 + LANDING_MARGIN_PX + COYOTE_EXTRA_MARGIN_PX) return "coyote";
  return "miss";
}

export function bunnyHopDifficulty(height: number): {
  readonly platformWidth: number;
  readonly gap: number;
  readonly movingChance: number;
  readonly crumbleChance: number;
  readonly horizontalSpeed: number;
} {
  const progress = Math.min(1, Math.max(0, height / 3_200));
  return {
    platformWidth: 104 - progress * 32,
    gap: 66 + progress * 20,
    movingChance: 0.07 + progress * 0.23,
    crumbleChance: 0.05 + progress * 0.2,
    horizontalSpeed: 42 + progress * 78,
  };
}

export function heightBand(height: number): HeightBand {
  if (height >= 2_800) return "space";
  if (height >= 1_800) return "clouds";
  if (height >= 900) return "sunset";
  return "meadow";
}

export function wrapHorizontal(x: number): number {
  return ((x % BUNNY_WORLD_WIDTH) + BUNNY_WORLD_WIDTH) % BUNNY_WORLD_WIDTH;
}

export function isFatalFall(bunnyY: number, cameraBottom: number): boolean {
  return bunnyY < cameraBottom - 95;
}

export function bunnyHopPayout(score: number, maxHeight: number, pickups: number): MinigamePayout {
  const safeScore = Math.max(0, Math.floor(score));
  return {
    score: safeScore,
    coins: Math.min(120, Math.floor(safeScore / 90) + Math.floor(pickups / 3)),
    xp: Math.min(250, 8 + Math.floor(maxHeight / 45) + pickups * 2),
  };
}

function wrappedDistance(a: number, b: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, BUNNY_WORLD_WIDTH - direct);
}

export class BunnyHopSimulation {
  private elapsed = 0;
  private bunnyX = BUNNY_WORLD_WIDTH / 2;
  private bunnyY = 38;
  private velocityY = HOP_VELOCITY;
  private steering = 0;
  private cameraBottom = 0;
  private maxHeight = 38;
  private bonusScore = 0;
  private combo = 0;
  private bestCombo = 0;
  private pickups = 0;
  private featherCharges = 0;
  private doubleJumps = 0;
  private jumpBufferSeconds = 0;
  private coyote: { readonly platformId: number; remaining: number } | null = null;
  private platforms: HopPlatform[] = [{
    id: 1,
    x: BUNNY_WORLD_WIDTH / 2,
    y: 0,
    width: 136,
    kind: "static",
    velocityX: 0,
    crumbleSeconds: null,
  }];
  private pickupItems: HopPickup[] = [];
  private events: BunnyHopEvent[] = [];
  private nextId = 2;
  private generatedThrough = 0;
  private lastGeneratedX = BUNNY_WORLD_WIDTH / 2;
  private currentBand: HeightBand = "meadow";
  private ended = false;
  private disposed = false;

  private readonly rng: RandomSource;
  private readonly variant: BunnyHopVariant;

  public constructor(rng: RandomSource, variant: BunnyHopVariant = "day") {
    this.rng = rng;
    this.variant = variant;
    this.generatePlatforms(900);
  }

  public setSteering(normalizedX: number): void {
    if (this.disposed) return;
    this.steering = Math.min(1, Math.max(-1, normalizedX * 2 - 1));
  }

  /** Direct steering axis in [-1, 1] for keyboard input. */
  public steerAxis(axis: number): void {
    if (this.disposed || !Number.isFinite(axis)) return;
    this.steering = Math.min(1, Math.max(-1, axis));
  }

  /**
   * Feather double jump. Fires immediately while falling with a stored
   * charge; taps while still rising stay buffered for a short fairness
   * window so the jump triggers the instant the descent begins.
   */
  public jump(): void {
    if (this.ended || this.disposed) return;
    this.jumpBufferSeconds = JUMP_BUFFER_SECONDS;
    this.tryDoubleJump();
  }

  private tryDoubleJump(): void {
    if (this.jumpBufferSeconds <= 0 || this.velocityY > 0 || this.featherCharges <= 0) return;
    this.featherCharges -= 1;
    this.doubleJumps += 1;
    this.jumpBufferSeconds = 0;
    this.velocityY = HOP_VELOCITY;
    this.bonusScore += 6;
    this.events.push({
      type: "double-jump",
      x: this.bunnyX,
      y: this.bunnyY,
      remainingCharges: this.featherCharges,
    });
  }

  public update(deltaSeconds: number): void {
    if (this.ended || this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    let remaining = Math.min(deltaSeconds, 2);
    while (remaining > 0 && !this.ended) {
      const step = Math.min(1 / 120, remaining);
      this.step(step);
      remaining -= step;
    }
  }

  private step(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.updatePlatforms(deltaSeconds);

    const previousY = this.bunnyY;
    const previousBottom = previousY - 18;
    const horizontalSpeed = 155 + Math.min(85, this.maxHeight / 30);
    this.bunnyX = wrapHorizontal(this.bunnyX + this.steering * horizontalSpeed * deltaSeconds);
    this.velocityY -= 720 * deltaSeconds;
    this.bunnyY += this.velocityY * deltaSeconds;
    const nextBottom = this.bunnyY - 18;

    if (this.velocityY <= 0) {
      const crossings = this.platforms.filter((platform) =>
        platform.crumbleSeconds === null &&
        previousBottom >= platform.y &&
        nextBottom <= platform.y
      );
      const landing = crossings
        .filter((platform) => resolveCrossing(this.bunnyX, platform.x, platform.width) === "land")
        .sort((a, b) => b.y - a.y)[0];
      if (landing) {
        this.coyote = null;
        this.land(landing);
      } else {
        const nearMiss = crossings
          .filter((platform) => resolveCrossing(this.bunnyX, platform.x, platform.width) === "coyote")
          .sort((a, b) => b.y - a.y)[0];
        if (nearMiss) this.coyote = { platformId: nearMiss.id, remaining: COYOTE_WINDOW_SECONDS };
        this.recoverCoyote(nextBottom, deltaSeconds);
      }
      if (this.jumpBufferSeconds > 0) this.tryDoubleJump();
    } else {
      this.coyote = null;
    }
    this.jumpBufferSeconds = Math.max(0, this.jumpBufferSeconds - deltaSeconds);

    this.collectPickups();
    this.maxHeight = Math.max(this.maxHeight, this.bunnyY);
    this.cameraBottom = Math.max(0, this.maxHeight - 270);
    this.generatePlatforms(this.cameraBottom + BUNNY_VIEW_HEIGHT + 260);
    this.platforms = this.platforms.filter((platform) => platform.y >= this.cameraBottom - 170);
    this.pickupItems = this.pickupItems.filter((pickup) => pickup.y >= this.cameraBottom - 100);

    const nextBand = heightBand(this.maxHeight);
    if (nextBand !== this.currentBand) {
      this.currentBand = nextBand;
      this.events.push({ type: "band", band: nextBand });
    }
    if (this.elapsed > 0.8 && isFatalFall(this.bunnyY, this.cameraBottom)) {
      this.ended = true;
      this.events.push({ type: "fall" });
    }
  }

  private updatePlatforms(deltaSeconds: number): void {
    this.platforms = this.platforms.flatMap((platform) => {
      if (platform.crumbleSeconds !== null) {
        const remaining = platform.crumbleSeconds - deltaSeconds;
        return remaining <= 0 ? [] : [{ ...platform, crumbleSeconds: remaining }];
      }
      if (platform.kind !== "moving") return [platform];
      let x = platform.x + platform.velocityX * deltaSeconds;
      let velocityX = platform.velocityX;
      if (x < platform.width / 2 || x > BUNNY_WORLD_WIDTH - platform.width / 2) {
        velocityX *= -1;
        x = Math.min(BUNNY_WORLD_WIDTH - platform.width / 2, Math.max(platform.width / 2, x));
      }
      return [{ ...platform, x, velocityX }];
    });
  }

  /** Steering back over a near-missed edge inside the window still lands. */
  private recoverCoyote(nextBottom: number, deltaSeconds: number): void {
    const coyote = this.coyote;
    if (!coyote || this.velocityY > 0) return;
    const platform = this.platforms.find(
      (candidate) => candidate.id === coyote.platformId && candidate.crumbleSeconds === null,
    );
    if (
      platform &&
      resolveCrossing(this.bunnyX, platform.x, platform.width) === "land" &&
      nextBottom <= platform.y &&
      nextBottom >= platform.y - 46
    ) {
      this.coyote = null;
      this.land(platform, true);
      return;
    }
    coyote.remaining -= deltaSeconds;
    if (coyote.remaining <= 0) this.coyote = null;
  }

  private land(platform: HopPlatform, coyote = false): void {
    this.bunnyY = platform.y + 18;
    this.velocityY = platform.kind === "spring" ? SPRING_VELOCITY : HOP_VELOCITY;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.bonusScore += 14 + Math.min(60, this.combo * 2) + (platform.kind === "spring" ? 35 : 0);
    if (platform.kind === "crumble") {
      this.platforms = this.platforms.map((candidate) =>
        candidate.id === platform.id ? { ...candidate, crumbleSeconds: 0.3 } : candidate
      );
    }
    this.events.push({ type: "land", kind: platform.kind, x: this.bunnyX, y: platform.y, coyote });
  }

  private collectPickups(): void {
    const retained: HopPickup[] = [];
    for (const pickup of this.pickupItems) {
      if (wrappedDistance(this.bunnyX, pickup.x) < 26 && Math.abs(this.bunnyY - pickup.y) < 28) {
        const points = pickup.kind === "star" ? 120 : pickup.kind === "feather" ? 60 : 45;
        this.pickups += 1;
        this.bonusScore += points;
        if (pickup.kind === "feather") {
          this.featherCharges = Math.min(FEATHER_MAX_CHARGES, this.featherCharges + 1);
        }
        this.events.push({ type: "pickup", kind: pickup.kind, x: pickup.x, y: pickup.y, points });
      } else {
        retained.push(pickup);
      }
    }
    this.pickupItems = retained;
  }

  private generatePlatforms(targetHeight: number): void {
    while (this.generatedThrough < targetHeight) {
      const difficulty = bunnyHopDifficulty(this.generatedThrough);
      const gap = difficulty.gap + (this.rng.next() - 0.5) * 18;
      this.generatedThrough += gap;
      const width = difficulty.platformWidth + this.rng.next() * 18;
      const maxShift = Math.min(135, 70 + this.generatedThrough / 40);
      this.lastGeneratedX = wrapHorizontal(this.lastGeneratedX + (this.rng.next() - 0.5) * maxShift * 2);
      const typeRoll = this.rng.next();
      const kind: PlatformKind = typeRoll < 0.08
        ? "spring"
        : typeRoll < 0.08 + difficulty.movingChance
          ? "moving"
          : typeRoll < 0.08 + difficulty.movingChance + difficulty.crumbleChance
            ? "crumble"
            : "static";
      const direction = this.rng.next() < 0.5 ? -1 : 1;
      const platform: HopPlatform = {
        id: this.nextId,
        x: Math.min(BUNNY_WORLD_WIDTH - width / 2, Math.max(width / 2, this.lastGeneratedX)),
        y: this.generatedThrough,
        width,
        kind,
        velocityX: kind === "moving" ? direction * difficulty.horizontalSpeed : 0,
        crumbleSeconds: null,
      };
      this.platforms.push(platform);
      this.lastGeneratedX = platform.x;
      if (this.nextId % 4 === 0 && this.rng.next() < 0.72) {
        const kindRoll = this.rng.next();
        this.pickupItems.push({
          id: this.nextId,
          x: platform.x,
          y: platform.y + 34,
          kind: kindRoll < 0.12 ? "feather" : kindRoll < 0.26 ? "star" : "carrot",
        });
      }
      this.nextId += 1;
    }
  }

  public drainEvents(): readonly BunnyHopEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  public snapshot(): BunnyHopSnapshot {
    return {
      elapsed: this.elapsed,
      bunnyX: this.bunnyX,
      bunnyY: this.bunnyY,
      velocityY: this.velocityY,
      steering: this.steering,
      cameraBottom: this.cameraBottom,
      maxHeight: this.maxHeight,
      score: Math.max(0, Math.floor(this.maxHeight * 0.48 + this.bonusScore)),
      combo: this.combo,
      bestCombo: this.bestCombo,
      pickups: this.pickups,
      featherCharges: this.featherCharges,
      doubleJumps: this.doubleJumps,
      coyoteRemaining: this.coyote?.remaining ?? 0,
      variant: this.variant,
      band: this.currentBand,
      platforms: this.platforms,
      pickupItems: this.pickupItems,
      ended: this.ended,
      disposed: this.disposed,
    };
  }

  public dispose(): void {
    this.platforms = [];
    this.pickupItems = [];
    this.events = [];
    this.coyote = null;
    this.jumpBufferSeconds = 0;
    this.ended = true;
    this.disposed = true;
  }
}
