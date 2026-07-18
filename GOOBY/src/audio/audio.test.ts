import { describe, expect, it } from "vitest";
import { ASSET_KEYS } from "../core/contracts/assets";
import { DEFAULT_AUDIO_BUS_VOLUMES } from "../core/contracts/audio";
import { FakeClock } from "../core/contracts/clock";
import { EventBus } from "../core/contracts/events";
import { SeededRng } from "../core/contracts/rng";
import {
  AUDIO_ASSET_CUES,
  AUDIO_ASSET_KEYS,
  SFX_CONCURRENCY_CAPS,
  SOUND_CUES,
  type AudioEvents,
  type SoundRequest,
} from "./contracts";
import {
  type MusicMixer,
  type MusicTheme,
  type MusicTrack,
  ZoneMusicDirector,
  themeForZone,
} from "./music-director";
import {
  SoundDirector,
  musicZoneForRoute,
  soundRequestFor,
  voiceCueForGooby,
  type SfxPlayer,
} from "./sound-director";
import {
  ProceduralSynthBank,
  SYNTH_RECIPES,
  synthAudibility,
  type NoiseVoice,
  type SynthVoiceOutput,
  type ToneVoice,
} from "./synth-bank";

class SpyTrack implements MusicTrack {
  readonly gains: Array<readonly [number, number]> = [];
  readonly stops: number[] = [];

  setGain(gain: number, fadeSeconds: number): void {
    this.gains.push([gain, fadeSeconds]);
  }

  stop(fadeSeconds: number): void {
    this.stops.push(fadeSeconds);
  }
}

class SpyMixer implements MusicMixer {
  readonly starts: Array<{ readonly theme: MusicTheme; readonly gain: number; readonly track: SpyTrack }> = [];
  readonly masters: Array<readonly [number, number]> = [];
  readonly ducks: Array<readonly [number, number]> = [];
  readonly paused: boolean[] = [];
  disposed = false;

  start(theme: MusicTheme, initialGain: number): MusicTrack {
    const track = new SpyTrack();
    this.starts.push({ theme, gain: initialGain, track });
    return track;
  }

  setMasterGain(gain: number, fadeSeconds: number): void {
    this.masters.push([gain, fadeSeconds]);
  }

  duck(gain: number, durationSeconds: number): void {
    this.ducks.push([gain, durationSeconds]);
  }

  setPaused(paused: boolean): void {
    this.paused.push(paused);
  }

  dispose(): void {
    this.disposed = true;
  }
}

class SpyPlayer implements SfxPlayer {
  readonly requests: SoundRequest[] = [];
  readonly muteStates: boolean[] = [];

  play(request: SoundRequest): void {
    this.requests.push(request);
  }

  setMuted(muted: boolean): void {
    this.muteStates.push(muted);
  }
}

class SpyVoiceOutput implements SynthVoiceOutput {
  count = 0;
  energy = 0;

  tone(voice: ToneVoice, _pitch: number, gain: number): void {
    this.count += 1;
    this.energy += voice.duration * voice.gain * gain;
  }

  noise(voice: NoiseVoice, _pitch: number, gain: number): void {
    this.count += 1;
    this.energy += voice.duration * voice.gain * gain;
  }
}

describe("audio event mapping", () => {
  it("maps the complete interaction surface to specific cues", () => {
    expect((["tap", "confirm", "back", "open", "close", "denied"] as const).map((action) =>
      soundRequestFor({ type: "ui", action }).cue,
    )).toEqual(["ui-tap", "ui-confirm", "ui-back", "ui-open", "ui-close", "ui-denied"]);
    expect((["pet", "tickle", "poke", "feed", "chew", "bathe", "sleep", "wake"] as const).map((action) =>
      soundRequestFor({ type: "gooby", action }).cue,
    )).toEqual(["pet", "tickle", "poke", "feed", "chew", "bathe", "sleep", "wake"]);
    expect((["engine-start", "engine-loop", "engine-stop", "skid", "brake", "pickup", "recovery"] as const).map((action) =>
      soundRequestFor({ type: "car", action }).cue,
    )).toEqual(["engine-start", "engine-loop", "engine-stop", "skid", "brake", "pickup", "recovery"]);
    expect((["hit", "miss", "combo", "countdown", "go", "win", "lose", "score"] as const).map((action) =>
      soundRequestFor({ type: "minigame", action }).cue,
    )).toEqual([
      "minigame-hit",
      "minigame-miss",
      "minigame-combo",
      "minigame-countdown",
      "minigame-go",
      "minigame-win",
      "minigame-lose",
      "minigame-score",
    ]);
    expect(soundRequestFor({ type: "economy", action: "purchase" }).duckMusic).toBe(true);
    expect(soundRequestFor({ type: "minigame", action: "combo", combo: 12 }, 1).pitch).toBeGreaterThan(1.4);
    expect(soundRequestFor({ type: "minigame", action: "win" }).duckMusic).toBe(true);
    expect(voiceCueForGooby("tickle")).toBe("voice-giggle");
    expect(soundRequestFor({ type: "voice", cue: "voice-cheer", priority: 2 }).bus).toBe("voice");
  });

  it("maps every frozen route and rejects unknown routes", () => {
    expect(musicZoneForRoute("home:bathroom")).toBe("home:bathroom");
    expect(musicZoneForRoute("city:drive")).toBe("city");
    expect(musicZoneForRoute("shop:fluff-salon")).toBe("shop:fluff-salon");
    expect(musicZoneForRoute("minigame:rhythm-hop")).toBe("minigame:rhythm-hop");
    expect(musicZoneForRoute("teleport:shop")).toBeNull();
  });

  it("lets high-priority nonverbal voice cues interrupt lower-priority cues", () => {
    const player = new SpyPlayer();
    const director = new SoundDirector(
      player,
      new ZoneMusicDirector(new SpyMixer()),
      new FakeClock(0),
      new SeededRng(7),
    );
    expect(director.play({ type: "voice", cue: "voice-sleepy", priority: 0 })).toBe(true);
    expect(director.play({ type: "voice", cue: "voice-yawn", priority: 0 })).toBe(true);
    expect(director.play({ type: "voice", cue: "voice-cheer", priority: 2 })).toBe(true);
    expect(director.play({ type: "voice", cue: "voice-curious", priority: 1 })).toBe(false);
    expect(player.requests.map(({ cue }) => cue)).toEqual([
      "voice-sleepy",
      "voice-yawn",
      "voice-cheer",
    ]);
  });

  it("consumes typed events, varies pitch, ducks music, and enforces caps", () => {
    const player = new SpyPlayer();
    const mixer = new SpyMixer();
    const music = new ZoneMusicDirector(mixer);
    const clock = new FakeClock(1_000);
    const director = new SoundDirector(player, music, clock, new SeededRng(42));
    const events = new EventBus<AudioEvents>();
    director.bindAudioEvents(events);

    events.emit("audio:zone", { zone: "home:living-room" });
    events.emit("audio:gooby", { action: "feed" });
    events.emit("audio:minigame", { action: "combo", combo: 7 });
    for (let index = 0; index < 20; index += 1) events.emit("audio:minigame", { action: "hit", combo: index });

    expect(mixer.starts[0]?.theme).toBe("home");
    expect(mixer.ducks.length).toBeGreaterThanOrEqual(2);
    expect(player.requests.filter(({ group }) => group === "gameplay")).toHaveLength(SFX_CONCURRENCY_CAPS.gameplay);
    expect(new Set(player.requests.map(({ pitch }) => pitch)).size).toBeGreaterThan(2);
    expect(player.requests.find(({ cue }) => cue === "feed")?.bus).toBe("sfx");
    events.emit("audio:ui", { action: "tap" });
    events.emit("audio:voice", { cue: "voice-giggle", bus: "voice", priority: 2 });
    expect(player.requests.find(({ cue }) => cue === "ui-tap")?.bus).toBe("ui");
    expect(player.requests.find(({ cue }) => cue === "voice-giggle")?.bus).toBe("voice");

    clock.advance(2_000);
    events.emit("audio:minigame", { action: "hit", combo: 1 });
    expect(player.requests.filter(({ group }) => group === "gameplay")).toHaveLength(SFX_CONCURRENCY_CAPS.gameplay + 1);
  });
});

describe("procedural synth completeness and audibility", () => {
  it("covers every frozen audio AssetKey and every semantic cue", () => {
    const frozenAudioKeys = ASSET_KEYS.filter((key) => key.startsWith("audio."));
    expect(AUDIO_ASSET_KEYS).toEqual(frozenAudioKeys);
    expect(Object.keys(AUDIO_ASSET_CUES).sort()).toEqual([...frozenAudioKeys].sort());
    expect(Object.keys(SYNTH_RECIPES).sort()).toEqual([...SOUND_CUES].sort());
  });

  it("schedules audible procedural voices for every asset with no files", () => {
    for (const key of AUDIO_ASSET_KEYS) {
      const output = new SpyVoiceOutput();
      new ProceduralSynthBank(output).playAsset(key);
      expect(output.count, key).toBeGreaterThan(0);
      expect(output.energy, key).toBeGreaterThan(0.002);
    }
    for (const cue of SOUND_CUES) expect(synthAudibility(cue), cue).toBeGreaterThan(0.002);
  });
});

describe("zone music", () => {
  it("resolves the complete home/city/shop/calm/action/lullaby/surf/cake set", () => {
    expect(themeForZone("home:kitchen")).toBe("home");
    expect(themeForZone("home:bedroom")).toBe("home");
    expect(themeForZone("city")).toBe("city");
    expect(themeForZone("shop:cloud-boutique")).toBe("shop");
    expect(themeForZone("minigame:rhythm-hop")).toBe("action");
    expect(themeForZone("minigame:memory-meadow")).toBe("calm");
    expect(themeForZone("minigame:shopping-surf")).toBe("surf");
    expect(themeForZone("minigame:cake-atelier")).toBe("cake");
    expect(themeForZone("calm")).toBe("calm");
    expect(themeForZone("action")).toBe("action");
    expect(themeForZone("lullaby")).toBe("lullaby");
  });

  it("crossfades transitions and persists mute across zone changes", () => {
    const mixer = new SpyMixer();
    const director = new ZoneMusicDirector(mixer, 1.5);
    director.setZone("home:living-room");
    director.setMuted(true);
    director.setZone("city");
    director.setZone("city");
    director.setMuted(false);

    expect(mixer.starts).toHaveLength(2);
    expect(mixer.starts[0]?.track.stops).toEqual([1.5]);
    expect(mixer.starts[1]?.track.gains).toEqual([[1, 1.5]]);
    expect(mixer.masters).toEqual([[0, 0.03], [1, 0.03]]);
    expect(director.currentTheme).toBe("city");
    expect(director.isMuted).toBe(false);
  });

  it("uses 1.2 second crossfades, shortens reduced motion, and pauses while hidden", () => {
    const mixer = new SpyMixer();
    const director = new ZoneMusicDirector(mixer);
    director.setZone("home:living-room");
    director.setZone("city");
    expect(mixer.starts[0]?.track.stops).toEqual([1.2]);
    expect(mixer.starts[1]?.track.gains).toEqual([[1, 1.2]]);

    director.setReducedMotion(true);
    director.setZone("minigame:memory-meadow");
    director.setZone("minigame:shopping-surf");
    director.setZone("minigame:cake-atelier");
    expect(mixer.starts.at(-2)?.track.stops).toEqual([0.03]);
    director.setHidden(true);
    director.setHidden(true);
    director.setHidden(false);
    expect(mixer.paused).toEqual([true, false]);
  });

  it("applies live persisted settings events", () => {
    const player = new SpyPlayer();
    const mixer = new SpyMixer();
    const director = new SoundDirector(
      player,
      new ZoneMusicDirector(mixer),
      new FakeClock(0),
      new SeededRng(1),
    );
    const events = new EventBus<AudioEvents>();
    director.bindAudioEvents(events);
    events.emit("audio:settings", {
      volumes: { ...DEFAULT_AUDIO_BUS_VOLUMES, music: 0.25 },
      muted: true,
      reducedMotion: true,
    });
    expect(player.muteStates.at(-1)).toBe(true);
    expect(director.isMuted).toBe(true);
  });
});
