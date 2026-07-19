import type { MinigamePayout } from "../../core/contracts/minigame";

export const BURROW_ROWS = 10;
export const BURROW_COLUMNS = 8;
export const BURROW_START_ENERGY = 26;
export const BURROW_FLOOD_WARNING_TURNS = 2;

export type BurrowCellKind =
  | "soil"
  | "tunnel"
  | "rock"
  | "root"
  | "worm"
  | "treat"
  | "water-source"
  | "exit";

export interface BurrowCell {
  readonly row: number;
  readonly column: number;
  readonly kind: BurrowCellKind;
  readonly floodAt: number;
}

export interface BurrowLevel {
  readonly seed: number;
  readonly rows: number;
  readonly columns: number;
  readonly start: number;
  readonly exit: number;
  readonly initialEnergy: number;
  readonly cells: readonly BurrowCell[];
  readonly solution: readonly number[];
  readonly solverValidated: true;
}

export interface BurrowSolution {
  readonly solvable: boolean;
  readonly path: readonly number[];
  readonly energyLeft: number;
  readonly turns: number;
}

export type DigOutcome =
  | "soil"
  | "root"
  | "worm"
  | "treat"
  | "exit"
  | "rock"
  | "flooded"
  | "invalid"
  | "tired"
  | "finished";

export interface DigResult {
  readonly outcome: DigOutcome;
  readonly moved: boolean;
  readonly energySpent: number;
  readonly index: number;
}

type Direction = "up" | "down" | "left" | "right";

class LevelRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.next() * (maxExclusive - minInclusive)) + minInclusive;
  }
}

export function burrowIndex(row: number, column: number, columns = BURROW_COLUMNS): number {
  return row * columns + column;
}

export function burrowCoordinates(
  index: number,
  columns = BURROW_COLUMNS,
): { readonly row: number; readonly column: number } {
  return { row: Math.floor(index / columns), column: index % columns };
}

export function burrowDigCost(kind: BurrowCellKind): number {
  if (kind === "root") return 2;
  if (kind === "rock") return Number.POSITIVE_INFINITY;
  if (kind === "tunnel") return 0;
  return 1;
}

export function burrowNeighbors(
  index: number,
  rows: number,
  columns: number,
): readonly number[] {
  const { row, column } = burrowCoordinates(index, columns);
  const neighbors: number[] = [];
  if (row > 0) neighbors.push(burrowIndex(row - 1, column, columns));
  if (row < rows - 1) neighbors.push(burrowIndex(row + 1, column, columns));
  if (column > 0) neighbors.push(burrowIndex(row, column - 1, columns));
  if (column < columns - 1) neighbors.push(burrowIndex(row, column + 1, columns));
  return neighbors;
}

export function solveBurrowLevel(level: Omit<BurrowLevel, "solution" | "solverValidated">): BurrowSolution {
  interface SearchState {
    readonly index: number;
    readonly energy: number;
    readonly turn: number;
    readonly path: readonly number[];
  }
  const queue: SearchState[] = [{
    index: level.start,
    energy: level.initialEnergy,
    turn: 0,
    path: [level.start],
  }];
  const bestEnergy = new Map<string, number>();
  const maximumTurns = level.rows * level.columns * 2;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) continue;
    if (current.index === level.exit) {
      return {
        solvable: true,
        path: current.path,
        energyLeft: current.energy,
        turns: current.turn,
      };
    }
    if (current.turn >= maximumTurns) continue;
    for (const nextIndex of burrowNeighbors(current.index, level.rows, level.columns)) {
      const cell = level.cells[nextIndex];
      if (!cell || cell.kind === "rock") continue;
      const nextTurn = current.turn + 1;
      if (cell.floodAt <= nextTurn) continue;
      const nextEnergy = current.energy - burrowDigCost(cell.kind);
      if (nextEnergy < 0) continue;
      const visitKey = `${nextIndex}:${nextTurn}`;
      if ((bestEnergy.get(visitKey) ?? -1) >= nextEnergy) continue;
      bestEnergy.set(visitKey, nextEnergy);
      queue.push({
        index: nextIndex,
        energy: nextEnergy,
        turn: nextTurn,
        path: [...current.path, nextIndex],
      });
    }
  }
  return { solvable: false, path: [], energyLeft: -1, turns: 0 };
}

export function generateBurrowLevel(seed: number): BurrowLevel {
  const normalizedSeed = Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = createCandidate((normalizedSeed + Math.imul(attempt, 0x9e3779b9)) >>> 0);
    const proof = solveBurrowLevel(candidate);
    if (proof.solvable) {
      return {
        ...candidate,
        seed: normalizedSeed,
        solution: proof.path,
        solverValidated: true,
      };
    }
  }
  const fallback = createFallback(normalizedSeed);
  const proof = solveBurrowLevel(fallback);
  if (!proof.solvable) throw new Error(`Burrow level ${normalizedSeed} failed its solver proof`);
  return {
    ...fallback,
    solution: proof.path,
    solverValidated: true,
  };
}

function createCandidate(
  seed: number,
): Omit<BurrowLevel, "solution" | "solverValidated"> {
  const rng = new LevelRandom(seed);
  const path: number[] = [];
  let column = rng.int(2, BURROW_COLUMNS - 2);
  path.push(burrowIndex(0, column));
  for (let row = 1; row < BURROW_ROWS; row += 1) {
    path.push(burrowIndex(row, column));
    const direction = rng.int(-1, 2);
    const nextColumn = Math.max(1, Math.min(BURROW_COLUMNS - 2, column + direction));
    if (nextColumn !== column) {
      column = nextColumn;
      path.push(burrowIndex(row, column));
    }
  }
  const start = path[0] ?? 0;
  const exit = path.at(-1) ?? burrowIndex(BURROW_ROWS - 1, column);
  const safePath = new Set(path);
  const startColumn = burrowCoordinates(start).column;
  const sourceColumn = startColumn < BURROW_COLUMNS / 2 ? BURROW_COLUMNS - 1 : 0;
  const source = burrowIndex(0, sourceColumn);

  const kinds: BurrowCellKind[] = [];
  for (let index = 0; index < BURROW_ROWS * BURROW_COLUMNS; index += 1) {
    if (index === start) {
      kinds.push("tunnel");
    } else if (index === exit) {
      kinds.push("exit");
    } else if (index === source) {
      kinds.push("water-source");
    } else if (safePath.has(index)) {
      const roll = rng.next();
      kinds.push(roll < 0.18 ? "treat" : roll < 0.34 ? "root" : "soil");
    } else {
      const roll = rng.next();
      kinds.push(
        roll < 0.2
          ? "rock"
          : roll < 0.34
            ? "root"
            : roll < 0.44
              ? "worm"
              : roll < 0.55
                ? "treat"
                : "soil",
      );
    }
  }

  const floodDistances = floodDistanceMap(kinds, source);
  const cells = kinds.map((kind, index): BurrowCell => {
    const { row, column: cellColumn } = burrowCoordinates(index);
    const distance = floodDistances[index] ?? Number.POSITIVE_INFINITY;
    const pathGrace = safePath.has(index) ? 14 : 0;
    return {
      row,
      column: cellColumn,
      kind,
      floodAt: Number.isFinite(distance) ? 4 + distance + pathGrace : Number.POSITIVE_INFINITY,
    };
  });
  return {
    seed,
    rows: BURROW_ROWS,
    columns: BURROW_COLUMNS,
    start,
    exit,
    initialEnergy: BURROW_START_ENERGY,
    cells,
  };
}

function floodDistanceMap(kinds: readonly BurrowCellKind[], source: number): readonly number[] {
  const distances = Array.from(
    { length: BURROW_ROWS * BURROW_COLUMNS },
    () => Number.POSITIVE_INFINITY,
  );
  distances[source] = 0;
  const queue = [source];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (index === undefined) continue;
    const distance = distances[index] ?? Number.POSITIVE_INFINITY;
    for (const neighbor of burrowNeighbors(index, BURROW_ROWS, BURROW_COLUMNS)) {
      if (kinds[neighbor] === "rock" || (distances[neighbor] ?? 0) <= distance + 1) continue;
      distances[neighbor] = distance + 1;
      queue.push(neighbor);
    }
  }
  return distances;
}

function createFallback(
  seed: number,
): Omit<BurrowLevel, "solution" | "solverValidated"> {
  const column = 3 + (seed % 2);
  const start = burrowIndex(0, column);
  const exit = burrowIndex(BURROW_ROWS - 1, column);
  const cells = Array.from(
    { length: BURROW_ROWS * BURROW_COLUMNS },
    (_, index): BurrowCell => {
      const { row, column: cellColumn } = burrowCoordinates(index);
      const onPath = cellColumn === column;
      return {
        row,
        column: cellColumn,
        kind: index === start
          ? "tunnel"
          : index === exit
            ? "exit"
            : onPath
              ? row % 3 === 0
                ? "treat"
                : "soil"
              : cellColumn === 0 && row === 0
                ? "water-source"
                : "rock",
        floodAt: onPath ? 999 : row + cellColumn + 4,
      };
    },
  );
  return {
    seed,
    rows: BURROW_ROWS,
    columns: BURROW_COLUMNS,
    start,
    exit,
    initialEnergy: BURROW_START_ENERGY,
    cells,
  };
}

export class BurrowRound {
  private positionIndex: number;
  private shovelEnergy: number;
  private turnCount = 0;
  private scoreTotal = 0;
  private treatsTotal = 0;
  private wormsTotal = 0;
  private completed = false;
  private completionReason: "exit" | "energy" | "flood" | null = null;
  private readonly dug = new Set<number>();

  constructor(readonly level: BurrowLevel) {
    this.positionIndex = level.start;
    this.shovelEnergy = level.initialEnergy;
    this.dug.add(level.start);
  }

  get position(): number {
    return this.positionIndex;
  }

  get energy(): number {
    return this.shovelEnergy;
  }

  get turns(): number {
    return this.turnCount;
  }

  get score(): number {
    return this.scoreTotal;
  }

  get treats(): number {
    return this.treatsTotal;
  }

  get wormsDisturbed(): number {
    return this.wormsTotal;
  }

  get finished(): boolean {
    return this.completed;
  }

  get reason(): "exit" | "energy" | "flood" | null {
    return this.completionReason;
  }

  isDug(index: number): boolean {
    return this.dug.has(index);
  }

  floodState(index: number): "dry" | "warning" | "flooded" {
    const floodAt = this.level.cells[index]?.floodAt ?? Number.POSITIVE_INFINITY;
    if (floodAt <= this.turnCount) return "flooded";
    if (floodAt - this.turnCount <= BURROW_FLOOD_WARNING_TURNS) return "warning";
    return "dry";
  }

  move(direction: Direction): DigResult {
    const { row, column } = burrowCoordinates(this.positionIndex, this.level.columns);
    const target = {
      up: [row - 1, column],
      down: [row + 1, column],
      left: [row, column - 1],
      right: [row, column + 1],
    }[direction];
    return this.dig(target[0] ?? -1, target[1] ?? -1);
  }

  dig(row: number, column: number): DigResult {
    if (this.completed) {
      return { outcome: "finished", moved: false, energySpent: 0, index: this.positionIndex };
    }
    if (
      !Number.isInteger(row)
      || !Number.isInteger(column)
      || row < 0
      || row >= this.level.rows
      || column < 0
      || column >= this.level.columns
    ) {
      return { outcome: "invalid", moved: false, energySpent: 0, index: this.positionIndex };
    }
    const index = burrowIndex(row, column, this.level.columns);
    if (!burrowNeighbors(this.positionIndex, this.level.rows, this.level.columns).includes(index)) {
      return { outcome: "invalid", moved: false, energySpent: 0, index };
    }
    const cell = this.level.cells[index];
    if (!cell) return { outcome: "invalid", moved: false, energySpent: 0, index };
    if (cell.kind === "rock") {
      const spent = Math.min(1, this.shovelEnergy);
      this.shovelEnergy -= spent;
      this.turnCount += 1;
      this.checkTerminalHazards();
      return { outcome: "rock", moved: false, energySpent: spent, index };
    }
    if (cell.floodAt <= this.turnCount + 1) {
      this.turnCount += 1;
      this.checkTerminalHazards();
      return { outcome: "flooded", moved: false, energySpent: 0, index };
    }

    const firstDig = !this.dug.has(index);
    const cost = firstDig ? burrowDigCost(cell.kind) : 0;
    if (cost > this.shovelEnergy) {
      this.completed = true;
      this.completionReason = "energy";
      return { outcome: "tired", moved: false, energySpent: 0, index };
    }
    this.shovelEnergy -= cost;
    this.turnCount += 1;
    this.positionIndex = index;
    this.dug.add(index);
    let outcome: DigOutcome =
      cell.kind === "water-source" || cell.kind === "tunnel" ? "soil" : cell.kind;
    if (!firstDig && outcome !== "exit") outcome = "soil";
    if (firstDig) {
      if (cell.kind === "treat") {
        this.treatsTotal += 1;
        this.scoreTotal += 250;
      } else if (cell.kind === "worm") {
        this.wormsTotal += 1;
        this.scoreTotal = Math.max(0, this.scoreTotal - 90);
      } else {
        this.scoreTotal += cell.kind === "root" ? 35 : 20;
      }
    }
    if (index === this.level.exit) {
      this.scoreTotal += this.shovelEnergy * 45;
      this.completed = true;
      this.completionReason = "exit";
      outcome = "exit";
    } else {
      this.checkTerminalHazards();
    }
    return { outcome, moved: true, energySpent: cost, index };
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.scoreTotal));
    return {
      score,
      coins: Math.min(45, Math.floor(score / 180)),
      xp: Math.min(95, Math.floor(score / 70) + this.treatsTotal * 3),
    };
  }

  private checkTerminalHazards(): void {
    if ((this.level.cells[this.positionIndex]?.floodAt ?? Number.POSITIVE_INFINITY) <= this.turnCount) {
      this.completed = true;
      this.completionReason = "flood";
    } else if (this.shovelEnergy <= 0) {
      this.completed = true;
      this.completionReason = "energy";
    }
  }
}
