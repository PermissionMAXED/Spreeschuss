import type { Clock } from "../core/contracts/clock";
import type { RandomSource } from "../core/contracts/rng";

export const PARTICLE_KINDS = [
  "hearts",
  "crumbs",
  "bubbles",
  "sparkles",
  "zzz",
  "confetti",
  "coin",
  "dust",
  "splash",
  "stars",
] as const;

export type ParticleKind = (typeof PARTICLE_KINDS)[number];

interface ParticlePreset {
  readonly symbols: readonly string[];
  readonly colors: readonly string[];
  readonly lifetimeMs: number;
  readonly speed: number;
  readonly spread: number;
  readonly gravity: number;
  readonly size: number;
}

const PARTICLE_PRESETS: Readonly<Record<ParticleKind, ParticlePreset>> = {
  hearts: { symbols: ["♥", "❤", "✦"], colors: ["#ef7182", "#f79cac", "#ffd1d8"], lifetimeMs: 920, speed: 95, spread: 88, gravity: -24, size: 22 },
  crumbs: { symbols: ["•", "·", "▪"], colors: ["#c98445", "#e7aa61", "#9a6337"], lifetimeMs: 620, speed: 72, spread: 120, gravity: 220, size: 13 },
  bubbles: { symbols: ["○", "◌", "◯"], colors: ["#88dfea", "#bceff3", "#ffffff"], lifetimeMs: 1_180, speed: 78, spread: 65, gravity: -48, size: 25 },
  sparkles: { symbols: ["✦", "✧", "⋆"], colors: ["#ffd86b", "#fff2aa", "#ffffff"], lifetimeMs: 760, speed: 90, spread: 120, gravity: 18, size: 21 },
  zzz: { symbols: ["Z", "z", "ᶻ"], colors: ["#b9a8e8", "#ddd3fa", "#8c80c2"], lifetimeMs: 1_720, speed: 45, spread: 28, gravity: -18, size: 23 },
  confetti: { symbols: ["▮", "◆", "●"], colors: ["#f46f77", "#f8cd55", "#65c7bc", "#7c9cf5"], lifetimeMs: 1_350, speed: 160, spread: 230, gravity: 260, size: 13 },
  coin: { symbols: ["●", "◉", "✦"], colors: ["#f8c84b", "#ffe68b", "#d99b24"], lifetimeMs: 900, speed: 125, spread: 75, gravity: 170, size: 20 },
  dust: { symbols: ["·", "•", "◦"], colors: ["#d9bf9b", "#bda17d", "#ead8bc"], lifetimeMs: 690, speed: 70, spread: 170, gravity: 72, size: 16 },
  splash: { symbols: ["●", "•", "◆"], colors: ["#65cfdf", "#b8edf3", "#ffffff"], lifetimeMs: 780, speed: 150, spread: 155, gravity: 245, size: 15 },
  stars: { symbols: ["★", "☆", "✦"], colors: ["#ffcf55", "#fff0a5", "#ff9f68"], lifetimeMs: 1_040, speed: 112, spread: 145, gravity: 90, size: 21 },
};

class LocalRng implements RandomSource {
  constructor(private state = 0x45d9f3b) {}

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) throw new RangeError("Expected a non-empty particle range");
    return Math.floor(this.next() * (maxExclusive - minInclusive)) + minInclusive;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length)];
    if (item === undefined) throw new RangeError("Cannot choose from an empty particle list");
    return item;
  }
}

export class ParticleState {
  active = false;
  kind: ParticleKind = "hearts";
  symbol = "♥";
  color = "#ef7182";
  x = 0;
  y = 0;
  originX = 0;
  originY = 0;
  velocityX = 0;
  velocityY = 0;
  gravity = 0;
  rotation = 0;
  spin = 0;
  scale = 1;
  opacity = 0;
  size = 20;
  bornAt = 0;
  lifetimeMs = 1;
}

/**
 * Fixed storage: emission reinitializes existing states and never creates
 * particle objects. When saturated, the oldest visible particle is recycled.
 */
export class ParticlePool {
  readonly states: readonly ParticleState[];
  private cursor = 0;

  constructor(
    readonly capacity = 96,
    private readonly rng: RandomSource = new LocalRng(),
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError("Particle capacity must be positive");
    this.states = Array.from({ length: capacity }, () => new ParticleState());
  }

  get activeCount(): number {
    let count = 0;
    for (const state of this.states) if (state.active) count += 1;
    return count;
  }

  emit(kind: ParticleKind, x: number, y: number, count: number, nowMs: number, intensity = 1): number {
    const requested = Math.max(0, Math.floor(count));
    const amount = Math.min(requested, this.capacity);
    const preset = PARTICLE_PRESETS[kind];
    const safeIntensity = Math.max(0.2, Math.min(2, intensity));
    for (let index = 0; index < amount; index += 1) {
      const state = this.acquire();
      const angle = -Math.PI * (0.15 + this.rng.next() * 0.7);
      const speed = preset.speed * safeIntensity * (0.62 + this.rng.next() * 0.58);
      state.active = true;
      state.kind = kind;
      state.symbol = this.rng.pick(preset.symbols);
      state.color = this.rng.pick(preset.colors);
      state.originX = x + (this.rng.next() - 0.5) * Math.min(30, preset.spread * 0.2);
      state.originY = y + (this.rng.next() - 0.5) * 12;
      state.x = state.originX;
      state.y = state.originY;
      state.velocityX = Math.cos(angle) * preset.spread * (0.35 + this.rng.next() * 0.65);
      state.velocityY = Math.sin(angle) * speed;
      state.gravity = preset.gravity;
      state.rotation = (this.rng.next() - 0.5) * 45;
      state.spin = (this.rng.next() - 0.5) * 210;
      state.scale = 0.55 + this.rng.next() * 0.45;
      state.opacity = 0;
      state.size = preset.size * (0.78 + this.rng.next() * 0.44);
      state.bornAt = nowMs + index * 12;
      state.lifetimeMs = preset.lifetimeMs * (0.82 + this.rng.next() * 0.36);
    }
    return amount;
  }

  update(nowMs: number): void {
    for (const state of this.states) {
      if (!state.active) continue;
      const elapsedMs = nowMs - state.bornAt;
      if (elapsedMs < 0) continue;
      const progress = elapsedMs / state.lifetimeMs;
      if (progress >= 1) {
        state.active = false;
        state.opacity = 0;
        continue;
      }
      const elapsedSeconds = elapsedMs / 1_000;
      state.x = state.originX + state.velocityX * elapsedSeconds;
      state.y = state.originY + state.velocityY * elapsedSeconds + 0.5 * state.gravity * elapsedSeconds ** 2;
      state.rotation += state.spin * Math.min(elapsedSeconds, 0.032);
      state.scale = 0.55 + Math.sin(Math.min(1, progress) * Math.PI) * 0.65;
      state.opacity = Math.min(1, progress * 8) * Math.min(1, (1 - progress) * 4);
    }
  }

  clear(): void {
    for (const state of this.states) {
      state.active = false;
      state.opacity = 0;
    }
  }

  private acquire(): ParticleState {
    for (let offset = 0; offset < this.capacity; offset += 1) {
      const index = (this.cursor + offset) % this.capacity;
      const state = this.states[index];
      if (!state) continue;
      if (!state.active) {
        this.cursor = (index + 1) % this.capacity;
        return state;
      }
    }
    const recycled = this.states[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!recycled) throw new Error("Particle pool lost a reusable slot");
    return recycled;
  }
}

export interface DomFxOptions {
  readonly capacity?: number;
  readonly clock?: Clock;
  readonly rng?: RandomSource;
}

export class DomFx {
  readonly pool: ParticlePool;
  private readonly elements: readonly HTMLSpanElement[];
  private readonly clock: Clock | null;
  private frame = 0;
  private disposed = false;

  constructor(
    private readonly layer: HTMLElement,
    options: DomFxOptions = {},
  ) {
    this.clock = options.clock ?? null;
    this.pool = new ParticlePool(options.capacity ?? 96, options.rng);
    const fragment = document.createDocumentFragment();
    const elements: HTMLSpanElement[] = [];
    for (let index = 0; index < this.pool.capacity; index += 1) {
      const element = document.createElement("span");
      element.className = "gooby-particle";
      element.hidden = true;
      element.style.position = "absolute";
      element.style.pointerEvents = "none";
      element.style.willChange = "transform, opacity";
      element.style.filter = "drop-shadow(0 2px 2px #5d465044)";
      fragment.append(element);
      elements.push(element);
    }
    this.elements = elements;
    layer.append(fragment);
  }

  hearts(x: number, y: number, count = 5): void {
    this.burst("hearts", x, y, count);
  }

  crumbs(x: number, y: number, count = 7): void {
    this.burst("crumbs", x, y, count);
  }

  bubbles(x: number, y: number, count = 10): void {
    this.burst("bubbles", x, y, count);
  }

  sparkles(x: number, y: number, count = 8): void {
    this.burst("sparkles", x, y, count);
  }

  zzz(x: number, y: number, count = 3): void {
    this.burst("zzz", x, y, count);
  }

  confetti(x: number, y: number, count = 24): void {
    this.burst("confetti", x, y, count, 1.2);
  }

  coins(x: number, y: number, count = 8): void {
    this.burst("coin", x, y, count);
  }

  dust(x: number, y: number, count = 9): void {
    this.burst("dust", x, y, count);
  }

  splash(x: number, y: number, count = 12): void {
    this.burst("splash", x, y, count, 1.15);
  }

  stars(x: number, y: number, count = 9): void {
    this.burst("stars", x, y, count);
  }

  burst(kind: ParticleKind, x: number, y: number, count: number, intensity = 1): void {
    if (this.disposed) return;
    this.pool.emit(kind, x, y, count, this.now(), intensity);
    if (this.frame === 0) this.frame = requestAnimationFrame(this.animate);
  }

  clear(): void {
    this.pool.clear();
    for (const element of this.elements) element.hidden = true;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pool.clear();
    this.layer.replaceChildren();
  }

  private readonly animate = (): void => {
    this.frame = 0;
    if (this.disposed) return;
    this.pool.update(this.now());
    for (let index = 0; index < this.pool.capacity; index += 1) {
      const state = this.pool.states[index];
      const element = this.elements[index];
      if (!state || !element) continue;
      element.hidden = !state.active;
      if (!state.active) continue;
      element.textContent = state.symbol;
      element.dataset.kind = state.kind;
      element.style.color = state.color;
      element.style.fontSize = `${state.size}px`;
      element.style.opacity = state.opacity.toFixed(3);
      element.style.transform = `translate3d(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px, 0) rotate(${state.rotation.toFixed(1)}deg) scale(${state.scale.toFixed(2)})`;
    }
    if (this.pool.activeCount > 0) this.frame = requestAnimationFrame(this.animate);
  };

  private now(): number {
    return this.clock?.now() ?? performance.now();
  }
}

export * from "./director";
