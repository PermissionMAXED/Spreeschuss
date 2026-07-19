import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  PACKER_BOARD_SIZES,
  createPackingSession,
  generatePackingBoard,
  packingComplete,
  packingEfficiency,
  packingPayout,
  placePicnicPiece,
  rotateCells,
  trySessionPlacement,
} from "./logic.ts";

function key(cell) {
  return `${cell.x},${cell.y}`;
}

test("seeded 5×5 through 7×7 boards are connected exact-cover polyomino puzzles", () => {
  for (let seed = 1; seed <= 80; seed += 1) {
    for (const size of PACKER_BOARD_SIZES) {
      let board = generatePackingBoard(new SeededRng(seed), size);
      const ids = new Set();
      for (const piece of board.pieces) {
        assert.ok(piece.cells.length >= 2 && piece.cells.length <= 5);
        assert.equal(new Set(piece.cells.map(key)).size, piece.cells.length);
        const visited = new Set([key(piece.cells[0])]);
        const queue = [piece.cells[0]];
        while (queue.length > 0) {
          const current = queue.shift();
          for (const neighbor of piece.cells) {
            if (Math.abs(neighbor.x - current.x) + Math.abs(neighbor.y - current.y) !== 1) continue;
            if (!visited.has(key(neighbor))) {
              visited.add(key(neighbor));
              queue.push(neighbor);
            }
          }
        }
        assert.equal(visited.size, piece.cells.length, `seed ${seed} size ${size} disconnected piece`);
        const placed = placePicnicPiece(board, piece.id, piece.solutionX, piece.solutionY, 0);
        assert.equal(placed.outcome.kind, "placed");
        board = placed.board;
        ids.add(piece.id);
      }
      assert.equal(ids.size, board.pieces.length);
      assert.equal(packingComplete(board), true);
      assert.equal(packingEfficiency(board), 1);
    }
  }
});

test("rotation is normalized, reversible, and keeps every cell unique", () => {
  const board = generatePackingBoard(new SeededRng(41), 7);
  for (const piece of board.pieces) {
    assert.deepEqual(rotateCells(piece.cells, 4), rotateCells(piece.cells, 0));
    assert.deepEqual(rotateCells(piece.cells, -1), rotateCells(piece.cells, 3));
    for (let turn = 0; turn < 4; turn += 1) {
      const rotated = rotateCells(piece.cells, turn);
      assert.equal(rotated.length, piece.cells.length);
      assert.equal(new Set(rotated.map(key)).size, rotated.length);
      assert.equal(Math.min(...rotated.map(({ x }) => x)), 0);
      assert.equal(Math.min(...rotated.map(({ y }) => y)), 0);
    }
  }
});

test("outside and overlapping drops are rejected without corrupting placements", () => {
  const source = generatePackingBoard(new SeededRng(8), 5);
  const first = source.pieces[0];
  const second = source.pieces[1];
  assert.ok(first && second);
  const outside = placePicnicPiece(source, first.id, 5, 5, 0);
  assert.deepEqual(outside.outcome, { kind: "invalid", reason: "outside" });
  assert.equal(outside.board.placements.length, 0);
  const placed = placePicnicPiece(outside.board, first.id, first.solutionX, first.solutionY, 0);
  assert.equal(placed.outcome.kind, "placed");
  const overlap = placePicnicPiece(
    placed.board,
    second.id,
    placed.board.placements[0].cells[0].x,
    placed.board.placements[0].cells[0].y,
    0,
  );
  assert.equal(overlap.outcome.kind, "invalid");
  assert.equal(overlap.board.placements.length, 1);
});

test("a perfect seeded session advances 5→6→7 and earns a capped balanced payout", () => {
  const rng = new SeededRng(2026);
  const session = createPackingSession(rng);
  for (const expectedSize of PACKER_BOARD_SIZES) {
    assert.equal(session.board.size, expectedSize);
    const puzzle = session.board;
    for (const piece of puzzle.pieces) {
      const outcome = trySessionPlacement(
        session,
        rng,
        piece.id,
        piece.solutionX,
        piece.solutionY,
        0,
      );
      assert.equal(outcome.kind, "placed");
    }
  }
  assert.equal(session.finished, true);
  assert.equal(session.completedBoards, 3);
  assert.equal(session.lives, 3);
  const payout = packingPayout(session);
  assert.ok(payout.score > 2_000);
  assert.ok(payout.coins <= 40);
  assert.ok(payout.xp <= 90);
});

test("three invalid drops consume exactly three lives and end safely", () => {
  const rng = new SeededRng(7);
  const session = createPackingSession(rng);
  const piece = session.board.pieces[0];
  assert.ok(piece);
  for (let life = 2; life >= 0; life -= 1) {
    const result = trySessionPlacement(session, rng, piece.id, 99, 99, 0);
    assert.equal(result.kind, "invalid");
    assert.equal(session.lives, life);
  }
  assert.equal(session.finished, true);
  assert.deepEqual(packingPayout(session), { score: 0, coins: 0, xp: 0 });
});

test("equal seeds produce identical boards", () => {
  assert.deepEqual(
    generatePackingBoard(new SeededRng(123), 7),
    generatePackingBoard(new SeededRng(123), 7),
  );
  assert.notDeepEqual(
    generatePackingBoard(new SeededRng(123), 7),
    generatePackingBoard(new SeededRng(124), 7),
  );
});
