import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const PACKER_BOARD_SIZES = [5, 6, 7] as const;
export const PACKER_STARTING_LIVES = 3;
export const PACKER_STEP_SECONDS = 1 / 120;

export interface GridCell {
  readonly x: number;
  readonly y: number;
}

export interface PicnicPiece {
  readonly id: string;
  readonly kind: number;
  readonly cells: readonly GridCell[];
  readonly solutionX: number;
  readonly solutionY: number;
  readonly initialRotation: number;
}

export interface PackedPlacement {
  readonly pieceId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly cells: readonly GridCell[];
}

export interface PackingBoard {
  readonly size: number;
  readonly pieces: readonly PicnicPiece[];
  readonly placements: readonly PackedPlacement[];
  readonly invalidAttempts: number;
}

export type PackingOutcome =
  | { readonly kind: "placed"; readonly completed: boolean }
  | { readonly kind: "invalid"; readonly reason: "outside" | "overlap" | "missing" };

export interface PackingSession {
  boardIndex: number;
  board: PackingBoard;
  lives: number;
  score: number;
  elapsedSeconds: number;
  boardElapsedSeconds: number;
  completedBoards: number;
  actions: number;
  finished: boolean;
}

const PIECE_CELL_SIZES = [3, 4, 5] as const;

function normalized(cells: readonly GridCell[]): readonly GridCell[] {
  if (cells.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
  }
  return cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function rotateCells(cells: readonly GridCell[], quarterTurns: number): readonly GridCell[] {
  let rotated = cells.map((cell) => ({ ...cell }));
  const turns = ((Math.floor(quarterTurns) % 4) + 4) % 4;
  for (let turn = 0; turn < turns; turn += 1) {
    rotated = rotated.map((cell) => ({ x: -cell.y, y: cell.x }));
    rotated = normalized(rotated).map((cell) => ({ ...cell }));
  }
  return normalized(rotated);
}

function segmentSizes(total: number, rng: RandomSource): readonly number[] {
  const sizes: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    if (remaining <= 5 && remaining >= 2) {
      sizes.push(remaining);
      break;
    }
    let size = rng.pick(PIECE_CELL_SIZES);
    if (remaining - size === 1) size -= 1;
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

function serpentineCells(size: number): readonly GridCell[] {
  const cells: GridCell[] = [];
  for (let y = 0; y < size; y += 1) {
    if (y % 2 === 0) {
      for (let x = 0; x < size; x += 1) cells.push({ x, y });
    } else {
      for (let x = size - 1; x >= 0; x -= 1) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Partitions a seeded serpentine path into connected 2–5-cell polyominoes.
 * The canonical solution tiles every board cell exactly once, which makes
 * every generated 5×5, 6×6, and 7×7 picnic solvable.
 */
export function generatePackingBoard(rng: RandomSource, size: number): PackingBoard {
  if (!Number.isInteger(size) || size < 3 || size > 9) {
    throw new RangeError("Packing board size must be an integer from 3 through 9");
  }
  const path = serpentineCells(size);
  const sizes = segmentSizes(path.length, rng);
  const pieces: PicnicPiece[] = [];
  let cursor = 0;
  for (const [index, cellCount] of sizes.entries()) {
    const absolute = path.slice(cursor, cursor + cellCount);
    cursor += cellCount;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (const cell of absolute) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
    }
    pieces.push({
      id: `picnic-${size}-${index}`,
      kind: rng.int(0, 8),
      cells: normalized(absolute),
      solutionX: minX,
      solutionY: minY,
      initialRotation: rng.int(0, 4),
    });
  }
  return { size, pieces, placements: [], invalidAttempts: 0 };
}

function occupiedKeys(board: PackingBoard, exceptPieceId?: string): ReadonlySet<string> {
  const occupied = new Set<string>();
  for (const placement of board.placements) {
    if (placement.pieceId === exceptPieceId) continue;
    for (const cell of placement.cells) occupied.add(`${cell.x},${cell.y}`);
  }
  return occupied;
}

export function placePicnicPiece(
  board: PackingBoard,
  pieceId: string,
  x: number,
  y: number,
  rotation: number,
): { readonly board: PackingBoard; readonly outcome: PackingOutcome } {
  const piece = board.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return {
      board: { ...board, invalidAttempts: board.invalidAttempts + 1 },
      outcome: { kind: "invalid", reason: "missing" },
    };
  }
  const local = rotateCells(piece.cells, rotation);
  const cells = local.map((cell) => ({ x: Math.floor(x) + cell.x, y: Math.floor(y) + cell.y }));
  if (cells.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= board.size || cell.y >= board.size)) {
    return {
      board: { ...board, invalidAttempts: board.invalidAttempts + 1 },
      outcome: { kind: "invalid", reason: "outside" },
    };
  }
  const occupied = occupiedKeys(board, pieceId);
  if (cells.some((cell) => occupied.has(`${cell.x},${cell.y}`))) {
    return {
      board: { ...board, invalidAttempts: board.invalidAttempts + 1 },
      outcome: { kind: "invalid", reason: "overlap" },
    };
  }
  const placement: PackedPlacement = {
    pieceId,
    x: Math.floor(x),
    y: Math.floor(y),
    rotation: ((Math.floor(rotation) % 4) + 4) % 4,
    cells,
  };
  const placements = [
    ...board.placements.filter((candidate) => candidate.pieceId !== pieceId),
    placement,
  ];
  const next = { ...board, placements };
  return { board: next, outcome: { kind: "placed", completed: packingComplete(next) } };
}

export function removePicnicPiece(board: PackingBoard, pieceId: string): PackingBoard {
  return {
    ...board,
    placements: board.placements.filter((placement) => placement.pieceId !== pieceId),
  };
}

export function packingComplete(board: PackingBoard): boolean {
  if (board.placements.length !== board.pieces.length) return false;
  return occupiedKeys(board).size === board.size * board.size;
}

export function packingEfficiency(board: PackingBoard): number {
  let occupied = 0;
  for (const placement of board.placements) occupied += placement.cells.length;
  if (occupied === 0) return 0;
  const accuracy = occupied / (occupied + board.invalidAttempts * 2);
  const coverage = Math.min(1, occupied / (board.size * board.size));
  return Math.max(0, Math.min(1, accuracy * coverage));
}

export function createPackingSession(rng: RandomSource): PackingSession {
  return {
    boardIndex: 0,
    board: generatePackingBoard(rng, PACKER_BOARD_SIZES[0]),
    lives: PACKER_STARTING_LIVES,
    score: 0,
    elapsedSeconds: 0,
    boardElapsedSeconds: 0,
    completedBoards: 0,
    actions: 0,
    finished: false,
  };
}

export function stepPackingSession(session: PackingSession, deltaSeconds: number): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("Packing delta must be finite and non-negative");
  }
  if (session.finished) return;
  session.elapsedSeconds += deltaSeconds;
  session.boardElapsedSeconds += deltaSeconds;
}

export function trySessionPlacement(
  session: PackingSession,
  rng: RandomSource,
  pieceId: string,
  x: number,
  y: number,
  rotation: number,
): PackingOutcome {
  if (session.finished) return { kind: "invalid", reason: "missing" };
  session.actions += 1;
  const result = placePicnicPiece(session.board, pieceId, x, y, rotation);
  session.board = result.board;
  if (result.outcome.kind === "invalid") {
    session.lives = Math.max(0, session.lives - 1);
    if (session.lives === 0) session.finished = true;
    return result.outcome;
  }
  session.score += 35;
  if (!result.outcome.completed) return result.outcome;

  const efficiency = packingEfficiency(session.board);
  const size = session.board.size;
  const parSeconds = 18 + size * 7;
  const speed = Math.max(0, Math.min(1, 1 - session.boardElapsedSeconds / parSeconds));
  session.score += Math.round(700 * efficiency + 400 * speed + session.lives * 60);
  session.completedBoards += 1;
  if (session.boardIndex >= PACKER_BOARD_SIZES.length - 1) {
    session.finished = true;
  } else {
    session.boardIndex += 1;
    const nextSize = PACKER_BOARD_SIZES[session.boardIndex];
    if (nextSize !== undefined) session.board = generatePackingBoard(rng, nextSize);
    session.boardElapsedSeconds = 0;
  }
  return result.outcome;
}

export function packingPayout(session: Readonly<PackingSession>): MinigamePayout {
  const score = Math.max(0, Math.floor(session.score));
  return {
    score,
    coins: Math.min(40, Math.floor(score / 90)),
    xp: Math.min(90, Math.floor(score / 45) + session.completedBoards * 4),
  };
}
