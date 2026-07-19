import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  codesMatch,
  conveyorSpeedAt,
  mailboxCountAt,
  SnailMailRound,
  spawnIntervalAt,
} from "./logic.ts";

function firstLetter(round) {
  for (let index = 0; index < 20 && round.letters.length === 0; index += 1) round.update(0.05);
  const letter = round.letters[0];
  assert.ok(letter, "expected a conveyor letter");
  return letter;
}

test("conveyor is deterministic and ramps from three to five triple-coded boxes", () => {
  const first = new SnailMailRound(new SeededRng(77));
  const second = new SnailMailRound(new SeededRng(77));
  for (let step = 0; step < 900; step += 1) {
    first.update(0.05);
    second.update(0.05);
  }
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.deepEqual(first.mailboxes, second.mailboxes);
  assert.equal(first.mailboxes.length, 5);
  assert.equal(mailboxCountAt(0), 3);
  assert.equal(mailboxCountAt(15), 4);
  assert.equal(mailboxCountAt(30), 5);
  assert.ok(conveyorSpeedAt(44) > conveyorSpeedAt(1));
  assert.ok(spawnIntervalAt(44) < spawnIntervalAt(1));
});

test("letters match color, symbol, and stamp rather than color alone", () => {
  const round = new SnailMailRound(new SeededRng(4));
  const letter = firstLetter(round);
  const target = round.mailboxes[letter.mailbox];
  assert.ok(target);
  assert.equal(codesMatch(letter, target), true);
  assert.equal(codesMatch(letter, { ...target, stamp: target.stamp === "snail" ? "cloud" : "snail" }), false);
  assert.equal(codesMatch(letter, { ...target, symbol: target.symbol === "moon" ? "star" : "moon" }), false);
});

test("wrong boxes break streaks while correct drag and flick deliveries score", () => {
  const round = new SnailMailRound(new SeededRng(13));
  let letter = firstLetter(round);
  const wrong = (letter.mailbox + 1) % round.mailboxes.length;
  assert.equal(round.deliver(letter.id, wrong, "drag"), "wrong-box");
  assert.equal(round.streak, 0);
  assert.equal(round.deliver(letter.id, letter.mailbox, "drag"), "delivered");
  assert.equal(round.delivered, 1);
  letter = firstLetter(round);
  assert.equal(round.deliver(letter.id, letter.mailbox, "flick"), "delivered");
  assert.equal(round.streak, 2);
  assert.ok(round.score > 60);
});

test("every fourth parcel requires a deliberate double-tap", () => {
  const round = new SnailMailRound(new SeededRng(2));
  for (let delivery = 1; delivery <= 4; delivery += 1) {
    const letter = firstLetter(round);
    assert.equal(letter.careful, delivery === 4);
    if (letter.careful) {
      assert.equal(round.deliver(letter.id, letter.mailbox, "flick"), "careful-required");
      assert.equal(round.letters.some(({ id }) => id === letter.id), true);
      assert.equal(round.deliver(letter.id, letter.mailbox, "double-tap"), "delivered");
    } else {
      assert.equal(round.deliver(letter.id, letter.mailbox, "drag"), "delivered");
    }
  }
  assert.equal(round.delivered, 4);
  assert.equal(round.bestStreak, 4);
});

test("letters eventually leave the belt and payout is finite and capped", () => {
  const round = new SnailMailRound(new SeededRng(8));
  firstLetter(round);
  for (let index = 0; index < 1_000; index += 1) round.update(0.05);
  assert.equal(round.finished, true);
  assert.ok(round.missed > 0);
  const payout = round.payout();
  assert.ok(Number.isInteger(payout.score));
  assert.ok(payout.coins <= 55);
  assert.ok(payout.xp <= 120);
});
