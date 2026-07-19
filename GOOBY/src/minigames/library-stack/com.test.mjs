import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  LIBRARY_BOOK_COUNT,
  averageNeatness,
  createBook,
  createLibrarySession,
  deterministicWobble,
  dropLibraryBook,
  evaluateStack,
  libraryPayout,
  stackCenterOfMass,
  stepLibrarySession,
} from "./logic.ts";

function book(id, x, width, mass = 1) {
  return {
    id,
    kind: 0,
    x,
    width,
    height: 0.06,
    mass,
    bonus: false,
    phase: 0,
  };
}

test("center of mass is mass-weighted and centered stacks remain stable", () => {
  const books = [
    book("base", 0.5, 0.75, 3),
    book("middle", 0.52, 0.6, 2),
    book("top", 0.49, 0.42, 1),
  ];
  const expected = (0.5 * 3 + 0.52 * 2 + 0.49) / 6;
  assert.ok(Math.abs(stackCenterOfMass(books) - expected) < 1e-12);
  const stability = evaluateStack(books);
  assert.equal(stability.stable, true);
  assert.equal(stability.failingLevel, null);
  assert.ok(stability.wobble < 0.2);
});

test("an overhanging upper center of mass identifies the failing support", () => {
  const books = [
    book("base", 0.5, 0.6, 2),
    book("middle", 0.69, 0.42, 1),
    book("top", 0.82, 0.3, 5),
  ];
  const stability = evaluateStack(books);
  assert.equal(stability.stable, false);
  assert.equal(stability.wobble, 1);
  assert.ok(stability.failingLevel === 0 || stability.failingLevel === 1);
});

test("books and wobble replay deterministically for equal seeds and steps", () => {
  const firstRng = new SeededRng(551);
  const secondRng = new SeededRng(551);
  assert.deepEqual(createBook(firstRng, 0), createBook(secondRng, 0));
  const first = createLibrarySession(new SeededRng(81));
  const second = createLibrarySession(new SeededRng(81));
  for (let index = 0; index < 360; index += 1) {
    stepLibrarySession(first, 1 / 120);
    stepLibrarySession(second, 1 / 120);
  }
  assert.deepEqual(first, second);
  assert.equal(deterministicWobble(first), deterministicWobble(second));
});

test("unstable books land in the beanbag without damaging the existing tower", () => {
  const rng = new SeededRng(12);
  const session = createLibrarySession(rng);
  const first = dropLibraryBook(session, rng, 0.5);
  assert.equal(first.caught, false);
  const standing = session.books[0];
  const caught = dropLibraryBook(session, rng, 1.15);
  assert.equal(caught.caught, true);
  assert.equal(session.caught, 1);
  assert.equal(session.books.length, 1);
  assert.equal(session.books[0], standing);
  assert.equal(evaluateStack(session.books).stable, true);
});

test("a neat fifteen-book tower scores height, streak, and guaranteed bonus books", () => {
  const rng = new SeededRng(9001);
  const session = createLibrarySession(rng);
  for (let index = 0; index < LIBRARY_BOOK_COUNT; index += 1) {
    const result = dropLibraryBook(session, rng, 0.5);
    assert.equal(result.caught, false, `book ${index + 1} should remain stable`);
  }
  assert.equal(session.finished, true);
  assert.equal(session.books.length, LIBRARY_BOOK_COUNT);
  assert.equal(session.caught, 0);
  assert.equal(session.bestStreak, LIBRARY_BOOK_COUNT);
  assert.ok(session.bonusBooks >= 3);
  assert.equal(averageNeatness(session), 1);
  const payout = libraryPayout(session);
  assert.ok(payout.score > 4_000);
  assert.ok(payout.coins <= 40);
  assert.ok(payout.xp <= 90);
});

test("the injected timer ends a run without wall-clock reads", () => {
  const session = createLibrarySession(new SeededRng(5));
  stepLibrarySession(session, 49.5);
  assert.equal(session.finished, false);
  stepLibrarySession(session, 0.5);
  assert.equal(session.finished, true);
  assert.equal(session.remainingSeconds, 0);
});
