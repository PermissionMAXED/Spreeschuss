import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import { CarrotCatchSimulation } from "./logic.ts";
import { BunnyHopSimulation } from "../bunny-hop/logic.ts";
import { PancakePeakSimulation } from "../pancake-peak/logic.ts";

/** Replays one scripted run and returns a comparable transcript. */
function transcribe(createGame, script, seconds) {
  const game = createGame();
  const events = [];
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    script(game, frame);
    game.update(1 / 60);
    events.push(...game.drainEvents());
  }
  return { events, snapshot: game.snapshot() };
}

const runs = [
  {
    id: "carrot-catch",
    create: (seed) => () => new CarrotCatchSimulation(new SeededRng(seed)),
    script: (game, frame) => {
      // Sweep the basket back and forth plus a keyboard nudge every second.
      game.moveBasket(0.5 + 0.35 * Math.sin(frame / 40));
      if (frame % 60 === 0) game.moveBasketBy(0.02);
    },
    seconds: 40,
  },
  {
    id: "bunny-hop",
    create: (seed) => () => new BunnyHopSimulation(new SeededRng(seed), "night"),
    script: (game, frame) => {
      game.steerAxis(Math.sin(frame / 25));
      if (frame % 90 === 0) game.jump();
    },
    seconds: 12,
  },
  {
    id: "pancake-peak",
    create: (seed) => () => new PancakePeakSimulation(new SeededRng(seed), { endlessTier: true }),
    script: (game, frame) => {
      if (frame > 0 && frame % 75 === 0) game.drop();
    },
    seconds: 12,
  },
];

for (const { id, create, script, seconds } of runs) {
  test(`${id} replays byte-identical transcripts for the same seed`, () => {
    const first = transcribe(create(0xf00d), script, seconds);
    const second = transcribe(create(0xf00d), script, seconds);
    assert.ok(first.events.length > 0);
    assert.deepEqual(second.events, first.events);
    assert.deepEqual(second.snapshot, first.snapshot);
  });

  test(`${id} diverges for a different seed`, () => {
    const first = transcribe(create(0xf00d), script, seconds);
    const other = transcribe(create(0xbeef), script, seconds);
    assert.notDeepEqual(other.snapshot, first.snapshot);
  });
}
