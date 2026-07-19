import { describe, expect, it } from "vitest";
import {
  BURROW_COLUMNS,
  BURROW_ROWS,
  BurrowRound,
  generateBurrowLevel,
  solveBurrowLevel,
  type BurrowLevel,
} from "./model";

describe("Burrow Dig generation and flood model", () => {
  it("solver-proves 200 deterministic 8×10 levels with limited energy", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const level = generateBurrowLevel(seed);
      const proof = solveBurrowLevel(level);
      expect(level.rows).toBe(BURROW_ROWS);
      expect(level.columns).toBe(BURROW_COLUMNS);
      expect(level.cells).toHaveLength(BURROW_ROWS * BURROW_COLUMNS);
      expect(level.solverValidated).toBe(true);
      expect(proof.solvable, `seed ${seed}`).toBe(true);
      expect(proof.energyLeft, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(level.solution[0]).toBe(level.start);
      expect(level.solution.at(-1)).toBe(level.exit);
      expect(level.cells.some(({ kind }) => kind === "water-source")).toBe(true);
      expect(level.cells.some(({ kind }) => kind === "rock")).toBe(true);
      expect(level.cells.some(({ kind }) => kind === "root")).toBe(true);
      expect(level.cells.some(({ kind }) => kind === "worm")).toBe(true);
      expect(level.cells.some(({ kind }) => kind === "treat")).toBe(true);
    }
  });

  it("can play every solver path to the exit and awards leftover-energy score", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const level = generateBurrowLevel(seed);
      const round = new BurrowRound(level);
      for (const index of level.solution.slice(1)) {
        const cell = level.cells[index];
        expect(cell, `seed ${seed}, cell ${index}`).toBeDefined();
        const result = round.dig(cell?.row ?? -1, cell?.column ?? -1);
        expect(result.moved, `seed ${seed}, cell ${index}`).toBe(true);
      }
      expect(round.finished, `seed ${seed}`).toBe(true);
      expect(round.reason, `seed ${seed}`).toBe("exit");
      expect(round.energy, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(round.score, `seed ${seed}`).toBeGreaterThanOrEqual(round.energy * 45);
    }
  });

  it("telegraphs water before it blocks a move", () => {
    const level: BurrowLevel = {
      seed: 1,
      rows: 2,
      columns: 2,
      start: 0,
      exit: 3,
      initialEnergy: 4,
      solverValidated: true,
      solution: [0, 2, 3],
      cells: [
        { row: 0, column: 0, kind: "tunnel", floodAt: 10 },
        { row: 0, column: 1, kind: "water-source", floodAt: 2 },
        { row: 1, column: 0, kind: "rock", floodAt: 10 },
        { row: 1, column: 1, kind: "exit", floodAt: 10 },
      ],
    };
    const round = new BurrowRound(level);
    expect(round.floodState(1)).toBe("warning");
    expect(round.dig(1, 0)).toMatchObject({ outcome: "rock", moved: false });
    expect(round.dig(0, 1)).toMatchObject({ outcome: "flooded", moved: false });
    expect(round.turns).toBe(2);
  });

  it("makes rocks consume shovel energy while roots cost two", () => {
    const base = generateBurrowLevel(12);
    const level: BurrowLevel = {
      ...base,
      start: 0,
      exit: 9,
      initialEnergy: 5,
      solution: [0, 8, 9],
      cells: base.cells.map((cell, index) => ({
        ...cell,
        kind: index === 0 ? "tunnel" : index === 1 ? "rock" : index === 8 ? "root" : cell.kind,
        floodAt: 99,
      })),
    };
    const round = new BurrowRound(level);
    expect(round.dig(0, 1)).toMatchObject({ outcome: "rock", energySpent: 1, moved: false });
    expect(round.energy).toBe(4);
    expect(round.dig(1, 0)).toMatchObject({ outcome: "root", energySpent: 2, moved: true });
    expect(round.energy).toBe(2);
  });
});
