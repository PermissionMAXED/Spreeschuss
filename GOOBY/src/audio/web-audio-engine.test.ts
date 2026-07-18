import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_BUS_VOLUMES } from "../core/contracts/audio";
import {
  BUS_RAMP_SECONDS,
  GoobyWebAudioEngine,
  SameOriginAudioResolver,
} from "./web-audio-engine";

class FakeParam {
  value = 1;
  readonly ramps: Array<readonly [number, number]> = [];

  cancelScheduledValues(): void {}

  setValueAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number, at: number): void {
    this.value = value;
    this.ramps.push([value, at]);
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  readonly connections: FakeNode[] = [];

  connect<T extends FakeNode>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeScheduledSource extends FakeNode {
  readonly playbackRate = new FakeParam();
  readonly frequency = new FakeParam();
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  type: OscillatorType = "sine";
  onended: (() => void) | null = null;
  private ended: (() => void) | null = null;
  starts = 0;

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.ended?.();
    this.onended?.();
  }

  addEventListener(_type: string, callback: () => void): void {
    this.ended = callback;
  }
}

class FakeFilter extends FakeNode {
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  type: BiquadFilterType = "lowpass";
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
}

class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array;

  constructor(length: number, sampleRate: number) {
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  readonly currentTime = 4;
  readonly sampleRate = 16;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeScheduledSource[] = [];
  decodeCount = 0;

  createDynamicsCompressor(): DynamicsCompressorNode {
    return new FakeCompressor() as unknown as DynamicsCompressorNode;
  }

  createGain(): GainNode {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeBuffer(length, sampleRate) as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeScheduledSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createOscillator(): OscillatorNode {
    return new FakeScheduledSource() as unknown as OscillatorNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    return new FakeFilter() as unknown as BiquadFilterNode;
  }

  decodeAudioData(): Promise<AudioBuffer> {
    this.decodeCount += 1;
    return Promise.resolve(new FakeBuffer(16, 16) as unknown as AudioBuffer);
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

const response = (body: BodyInit | null, status = 200): Response => new Response(body, { status });
const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

describe("same-origin audio file resolution", () => {
  it("accepts a partial manifest, keeps loop points, and decodes each URL once", async () => {
    const manifest = {
      schemaVersion: 1,
      domain: "audio",
      sfx: { "ui-tap": { path: "assets/audio/tap.wav" } },
      music: {
        home: {
          output: {
            path: "/assets/audio/home.mp3",
            loopStartSeconds: 1.5,
            loopEndSeconds: 9.25,
          },
        },
      },
    };
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      return Promise.resolve(
        url.endsWith("manifest.json") ? Response.json(manifest) : response(new Uint8Array([1, 2, 3])),
      );
    });
    const context = new FakeAudioContext();
    const resolver = new SameOriginAudioResolver(fetcher, "/assets/audio/manifest.json", "https://gooby.test");

    const first = await resolver.resolveSfx("ui-tap", context as unknown as AudioContext);
    const second = await resolver.resolveSfx("ui-tap", context as unknown as AudioContext);
    const music = await resolver.resolveMusic("home", context as unknown as AudioContext);
    const missing = await resolver.resolveSfx("purchase", context as unknown as AudioContext);

    expect(first?.file.url).toBe("https://gooby.test/assets/audio/tap.wav");
    expect(second?.buffer).toBe(first?.buffer);
    expect(music?.file).toMatchObject({ loopStartSeconds: 1.5, loopEndSeconds: 9.25 });
    expect(missing).toBeNull();
    expect(context.decodeCount).toBe(2);
    expect(resolver.cacheSize).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("caches corrupt decode failures and rejects external URLs without requesting them", async () => {
    const manifest = {
      schemaVersion: 1,
      cues: {
        purchase: "/assets/audio/corrupt.wav",
        coin: "https://tracker.invalid/coin.mp3",
      },
    };
    const fetcher = vi.fn((input: RequestInfo | URL) => Promise.resolve(
      requestUrl(input).endsWith("manifest.json")
        ? Response.json(manifest)
        : response(new Uint8Array([0])),
    ));
    const context = new FakeAudioContext();
    context.decodeAudioData = () => {
      context.decodeCount += 1;
      return Promise.reject(new DOMException("corrupt", "EncodingError"));
    };
    const resolver = new SameOriginAudioResolver(fetcher, "/assets/audio/manifest.json", "https://gooby.test");

    await expect(resolver.resolveSfx("purchase", context as unknown as AudioContext)).resolves.toBeNull();
    await expect(resolver.resolveSfx("purchase", context as unknown as AudioContext)).resolves.toBeNull();
    await expect(resolver.resolveSfx("coin", context as unknown as AudioContext)).resolves.toBeNull();
    expect(context.decodeCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.some(([input]) => requestUrl(input).includes("tracker.invalid"))).toBe(false);
  });

  it("fetches a missing optional manifest only once", async () => {
    const fetcher = vi.fn(() => Promise.resolve(response(null, 404)));
    const resolver = new SameOriginAudioResolver(fetcher, "/assets/audio/manifest.json", "https://gooby.test");
    const context = new FakeAudioContext() as unknown as AudioContext;
    await resolver.resolveSfx("ui-tap", context);
    await resolver.resolveMusic("action", context);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("five-bus WebAudio mixer", () => {
  it("ramps bus changes for 30ms and hard-mutes without changing sliders", async () => {
    const context = new FakeAudioContext();
    const engine = new GoobyWebAudioEngine(() => context as unknown as AudioContext);
    await engine.unlock();
    const [master, music, sfx, ui, voice] = context.gains;

    expect([master?.gain.value, music?.gain.value, sfx?.gain.value, ui?.gain.value, voice?.gain.value])
      .toEqual([1, 0.8, 0.9, 0.8, 1]);
    engine.setBusVolume("music", 0.25);
    expect(music?.gain.ramps.at(-1)).toEqual([0.25, context.currentTime + BUS_RAMP_SECONDS]);

    engine.setMuted(true);
    engine.setBusVolume("master", 0.4);
    expect(master?.gain.ramps.at(-1)?.[0]).toBe(0);
    expect(engine.volumes).toMatchObject({ ...DEFAULT_AUDIO_BUS_VOLUMES, master: 0.4, music: 0.25 });

    engine.setMuted(false);
    expect(master?.gain.ramps.at(-1)).toEqual([0.4, context.currentTime + BUS_RAMP_SECONDS]);
  });

  it("counts each procedural SFX fallback while caching the missing manifest", async () => {
    const fetcher = vi.fn(() => Promise.resolve(response(null, 404)));
    const resolver = new SameOriginAudioResolver(fetcher, "/assets/audio/manifest.json", "https://gooby.test");
    const context = new FakeAudioContext();
    const engine = new GoobyWebAudioEngine(() => context as unknown as AudioContext, resolver);
    await engine.unlock();
    engine.play({ cue: "ui-tap", bus: "ui", group: "ui", pitch: 1, gain: 1, duckMusic: false });
    engine.play({ cue: "purchase", bus: "sfx", group: "reward", pitch: 1, gain: 1, duckMusic: false });
    await vi.waitFor(() => expect(engine.fallbackCount).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fades an asynchronously resolved music fallback and cancels rapid stale zones", async () => {
    const fetcher = vi.fn(() => Promise.resolve(response(null, 404)));
    const resolver = new SameOriginAudioResolver(fetcher, "/assets/audio/manifest.json", "https://gooby.test");
    const context = new FakeAudioContext();
    const engine = new GoobyWebAudioEngine(() => context as unknown as AudioContext, resolver);
    await engine.unlock();

    const home = engine.start("home", 0);
    home.setGain(1, 1.2);
    await vi.waitFor(() => expect(context.sources).toHaveLength(1));
    expect(context.gains.at(-1)?.gain.ramps.at(-1)).toEqual([1, context.currentTime + 1.2]);

    const stale = engine.start("city", 0);
    stale.setGain(1, 1.2);
    stale.stop(1.2);
    await Promise.resolve();
    expect(context.sources).toHaveLength(1);
  });
});
