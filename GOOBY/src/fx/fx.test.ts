import { describe, expect, it } from "vitest";
import { EventBus } from "../core/contracts/events";
import { SeededRng } from "../core/contracts/rng";
import type { AudioEvents } from "../audio/contracts";
import {
  FxDirector,
  PARTICLE_KINDS,
  ParticlePool,
  particleForAudioEvent,
  type ParticleEmitter,
  type ParticleKind,
} from "./index";

class SpyEmitter implements ParticleEmitter {
  readonly bursts: Array<readonly [ParticleKind, number, number, number, number]> = [];
  clears = 0;

  burst(kind: ParticleKind, x: number, y: number, count: number, intensity = 1): void {
    this.bursts.push([kind, x, y, count, intensity]);
  }

  clear(): void {
    this.clears += 1;
  }
}

describe("fixed particle pool", () => {
  it("covers every requested polish effect without exceeding its cap", () => {
    const pool = new ParticlePool(24, new SeededRng(7));
    const identities = [...pool.states];

    for (const kind of PARTICLE_KINDS) {
      expect(pool.emit(kind, 120, 240, 100, 1_000)).toBe(24);
      expect(pool.activeCount).toBe(24);
      expect(new Set(pool.states.map((state) => state.kind))).toContain(kind);
      expect(pool.states).toEqual(identities);
    }
  });

  it("reuses the same particle objects after expiry and saturation", () => {
    const pool = new ParticlePool(3, new SeededRng(11));
    const first = pool.states[0];
    const second = pool.states[1];
    const third = pool.states[2];

    pool.emit("hearts", 0, 0, 3, 0);
    pool.emit("stars", 5, 5, 9, 20);
    expect(pool.activeCount).toBe(3);
    expect(pool.states).toEqual([first, second, third]);
    expect(pool.states.every(({ kind }) => kind === "stars")).toBe(true);

    pool.update(5_000);
    expect(pool.activeCount).toBe(0);
    pool.emit("bubbles", 10, 10, 2, 5_100);
    expect(pool.activeCount).toBe(2);
    expect(pool.states).toEqual([first, second, third]);
  });

  it("updates motion deterministically and clears all live particles", () => {
    const first = new ParticlePool(2, new SeededRng(23));
    const second = new ParticlePool(2, new SeededRng(23));
    first.emit("confetti", 50, 75, 2, 10);
    second.emit("confetti", 50, 75, 2, 10);
    first.update(310);
    second.update(310);

    expect(first.states.map(({ x, y, opacity }) => [x, y, opacity])).toEqual(
      second.states.map(({ x, y, opacity }) => [x, y, opacity]),
    );
    first.clear();
    expect(first.activeCount).toBe(0);
  });
});

describe("event-driven particle polish", () => {
  it("maps care, economy, cars, and every minigame result", () => {
    expect(particleForAudioEvent("audio:gooby", { action: "pet" })?.kind).toBe("hearts");
    expect(particleForAudioEvent("audio:gooby", { action: "chew" })?.kind).toBe("crumbs");
    expect(particleForAudioEvent("audio:gooby", { action: "bathe" })?.kind).toBe("bubbles");
    expect(particleForAudioEvent("audio:gooby", { action: "sleep" })?.kind).toBe("zzz");
    expect(particleForAudioEvent("audio:economy", { action: "coin" })?.kind).toBe("coin");
    expect(particleForAudioEvent("audio:car", { action: "skid" })?.kind).toBe("dust");
    expect((["hit", "miss", "combo", "countdown", "go", "win", "lose", "score"] as const).map((action) =>
      particleForAudioEvent("audio:minigame", { action })?.kind,
    )).toEqual(["sparkles", "stars", "stars", "sparkles", "dust", "confetti", "dust", "coin"]);
  });

  it("consumes the shared typed event stream at the supplied visual anchor", () => {
    const emitter = new SpyEmitter();
    const director = new FxDirector(emitter, () => 120, () => 340);
    const events = new EventBus<AudioEvents>();
    director.bindAudioEvents(events);
    events.emit("audio:gooby", { action: "tickle" });
    events.emit("audio:minigame", { action: "win", score: 900 });
    events.emit("audio:ui", { action: "tap" });

    expect(emitter.bursts).toEqual([
      ["sparkles", 120, 340, 9, 1.1],
      ["confetti", 120, 340, 28, 1.3],
    ]);
  });
});
