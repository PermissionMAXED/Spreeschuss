import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const BUNNY_WORLD_WIDTH = 360;
export const BUNNY_VIEW_HEIGHT = 640;

export type PlatformKind = "static" | "moving" | "crumble" | "spring";
export type HeightBand = "meadow" | "sunset" | "clouds" | "space";
export type PickupKind = "carrot" | "star";

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
  | { readonly type: "land"; readonly kind: PlatformKind; readonly x: number; readonly y: number }
  | { readonly type: "pickup"; readonly kind: PickupKind; readonly x: number; readonly y: number; readonly points: number }
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
  readonly band: HeightBand;
  readonly platforms: readonly HopPlatform[];
  readonly pickupItems: readonly HopPickup[];
  readonly ended: boolean;
  readonly disposed: boolean;
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
  private velocityY = 385;
  private steering = 0;
  private cameraBottom = 0;
  private maxHeight = 38;
  private bonusScore = 0;
  private combo = 0;
  private bestCombo = 0;
  private pickups = 0;
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

  public constructor(private readonly rng: RandomSource) {
    this.generatePlatforms(900);
  }

  public setSteering(normalizedX: number): void {
    if (this.disposed) return;
    this.steering = Math.min(1, Math.max(-1, normalizedX * 2 - 1));
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
      const landing = this.platforms
        .filter((platform) =>
          platform.crumbleSeconds === null &&
          previousBottom >= platform.y &&
          nextBottom <= platform.y &&
          wrappedDistance(this.bunnyX, platform.x) <= platform.width / 2 + 13
        )
        .sort((a, b) => b.y - a.y)[0];
      if (landing) this.land(landing);
    }

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

  private land(platform: HopPlatform): void {
    this.bunnyY = platform.y + 18;
    this.velocityY = platform.kind === "spring" ? 505 : 385;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.bonusScore += 14 + Math.min(60, this.combo * 2) + (platform.kind === "spring" ? 35 : 0);
    if (platform.kind === "crumble") {
      this.platforms = this.platforms.map((candidate) =>
        candidate.id === platform.id ? { ...candidate, crumbleSeconds: 0.3 } : candidate
      );
    }
    this.events.push({ type: "land", kind: platform.kind, x: this.bunnyX, y: platform.y });
  }

  private collectPickups(): void {
    const retained: HopPickup[] = [];
    for (const pickup of this.pickupItems) {
      if (wrappedDistance(this.bunnyX, pickup.x) < 26 && Math.abs(this.bunnyY - pickup.y) < 28) {
        const points = pickup.kind === "star" ? 120 : 45;
        this.pickups += 1;
        this.bonusScore += points;
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
        this.pickupItems.push({
          id: this.nextId,
          x: platform.x,
          y: platform.y + 34,
          kind: this.rng.next() < 0.16 ? "star" : "carrot",
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
    this.ended = true;
    this.disposed = true;
  }
}
