import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const LIBRARY_BOOK_COUNT = 15;
export const LIBRARY_ROUND_SECONDS = 50;
export const LIBRARY_STEP_SECONDS = 1 / 120;

export interface StackBook {
  readonly id: string;
  readonly kind: number;
  readonly x: number;
  readonly width: number;
  readonly height: number;
  readonly mass: number;
  readonly bonus: boolean;
  readonly phase: number;
}

export interface StackStability {
  readonly stable: boolean;
  readonly centerOfMass: number;
  readonly wobble: number;
  readonly failingLevel: number | null;
}

export interface BookDropResult {
  readonly caught: boolean;
  readonly neatness: number;
  readonly points: number;
  readonly stability: StackStability;
  readonly bonus: boolean;
}

export interface LibrarySession {
  books: StackBook[];
  current: StackBook;
  movingX: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  score: number;
  attempts: number;
  caught: number;
  bonusBooks: number;
  neatnessTotal: number;
  neatStreak: number;
  bestStreak: number;
  finished: boolean;
  lastDrop: BookDropResult | null;
}

export function stackCenterOfMass(books: readonly StackBook[]): number {
  if (books.length === 0) return 0.5;
  let moment = 0;
  let mass = 0;
  for (const book of books) {
    moment += book.x * book.mass;
    mass += book.mass;
  }
  return mass > 0 ? moment / mass : 0.5;
}

/**
 * Evaluates every support interface from the shelf upward. At each level the
 * combined center of mass of all books above must remain inside the overlap
 * between the supporting book and the first supported book.
 */
export function evaluateStack(books: readonly StackBook[]): StackStability {
  if (books.length === 0) {
    return { stable: true, centerOfMass: 0.5, wobble: 0, failingLevel: null };
  }
  const towerCenter = stackCenterOfMass(books);
  const base = books[0];
  if (!base || base.x - base.width / 2 < 0 || base.x + base.width / 2 > 1) {
    return { stable: false, centerOfMass: towerCenter, wobble: 1, failingLevel: 0 };
  }
  let maxWobble = Math.min(1, Math.abs(towerCenter - base.x) / Math.max(0.01, base.width / 2));
  for (let supportIndex = 0; supportIndex < books.length - 1; supportIndex += 1) {
    const support = books[supportIndex];
    const firstAbove = books[supportIndex + 1];
    if (!support || !firstAbove) continue;
    const above = books.slice(supportIndex + 1);
    const center = stackCenterOfMass(above);
    const left = Math.max(support.x - support.width / 2, firstAbove.x - firstAbove.width / 2);
    const right = Math.min(support.x + support.width / 2, firstAbove.x + firstAbove.width / 2);
    const safeLeft = left + 0.012;
    const safeRight = right - 0.012;
    if (safeLeft >= safeRight) {
      return { stable: false, centerOfMass: towerCenter, wobble: 1, failingLevel: supportIndex };
    }
    const middle = (safeLeft + safeRight) / 2;
    const half = (safeRight - safeLeft) / 2;
    const wobble = Math.abs(center - middle) / Math.max(0.001, half);
    maxWobble = Math.max(maxWobble, Math.min(1, wobble));
    if (center <= safeLeft || center >= safeRight) {
      return {
        stable: false,
        centerOfMass: towerCenter,
        wobble: 1,
        failingLevel: supportIndex,
      };
    }
  }
  return {
    stable: true,
    centerOfMass: towerCenter,
    wobble: Math.max(0, Math.min(1, maxWobble)),
    failingLevel: null,
  };
}

export function createBook(rng: RandomSource, index: number): StackBook {
  const width = 0.34 + rng.next() * 0.38;
  const height = 0.045 + rng.next() * 0.038;
  const bonus = (index + 1) % 5 === 0 || rng.next() < 0.12;
  const density = 0.85 + rng.next() * 0.45 + (bonus ? 0.12 : 0);
  return {
    id: `book-${index}`,
    kind: rng.int(0, 8),
    x: 0.5,
    width,
    height,
    mass: width * height * density,
    bonus,
    phase: rng.next() * Math.PI * 2,
  };
}

export function createLibrarySession(rng: RandomSource): LibrarySession {
  return {
    books: [],
    current: createBook(rng, 0),
    movingX: 0.5,
    elapsedSeconds: 0,
    remainingSeconds: LIBRARY_ROUND_SECONDS,
    score: 0,
    attempts: 0,
    caught: 0,
    bonusBooks: 0,
    neatnessTotal: 0,
    neatStreak: 0,
    bestStreak: 0,
    finished: false,
    lastDrop: null,
  };
}

export function currentBookX(session: Readonly<LibrarySession>): number {
  const current = session.current;
  const amplitude = Math.max(0.08, (1 - current.width) / 2);
  const speed = 1.15 + Math.min(1.2, session.attempts * 0.045);
  return 0.5 + Math.sin(session.elapsedSeconds * speed * Math.PI + current.phase) * amplitude;
}

export function deterministicWobble(session: Readonly<LibrarySession>): number {
  const stability = evaluateStack(session.books);
  if (session.books.length < 2 || stability.wobble <= 0) return 0;
  const phase = session.books.reduce((total, book) => total + book.phase * book.mass, 0);
  return Math.sin(session.elapsedSeconds * 4.2 + phase) * stability.wobble * 2.8;
}

export function stepLibrarySession(session: LibrarySession, deltaSeconds: number): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("Library delta must be finite and non-negative");
  }
  if (session.finished) return;
  session.elapsedSeconds += deltaSeconds;
  session.remainingSeconds = Math.max(0, session.remainingSeconds - deltaSeconds);
  session.movingX = currentBookX(session);
  if (session.remainingSeconds <= 0) session.finished = true;
}

export function dropLibraryBook(
  session: LibrarySession,
  rng: RandomSource,
  x = session.movingX,
): BookDropResult | null {
  if (session.finished) return null;
  const current = { ...session.current, x: Math.max(-0.2, Math.min(1.2, x)) };
  const candidate = [...session.books, current];
  const stability = evaluateStack(candidate);
  const supportX = session.books.at(-1)?.x ?? 0.5;
  const distance = Math.abs(current.x - supportX);
  const neatness = Math.max(0, Math.min(1, 1 - distance / Math.max(0.12, current.width * 0.6)));
  session.attempts += 1;
  let points = 20;
  if (stability.stable) {
    session.books.push(current);
    session.neatnessTotal += neatness;
    session.neatStreak = neatness >= 0.78 ? session.neatStreak + 1 : 0;
    session.bestStreak = Math.max(session.bestStreak, session.neatStreak);
    if (current.bonus) session.bonusBooks += 1;
    const heightBonus = session.books.length * 16;
    const neatBonus = Math.round(neatness * 210);
    const specialBonus = current.bonus ? 260 : 0;
    points = 90 + heightBonus + neatBonus + specialBonus + Math.min(8, session.neatStreak) * 25;
    session.score += points;
  } else {
    session.caught += 1;
    session.neatStreak = 0;
  }
  const result: BookDropResult = {
    caught: !stability.stable,
    neatness,
    points,
    stability,
    bonus: current.bonus,
  };
  session.lastDrop = result;
  if (session.attempts >= LIBRARY_BOOK_COUNT) {
    session.finished = true;
  } else {
    session.current = createBook(rng, session.attempts);
    session.movingX = currentBookX(session);
  }
  return result;
}

export function averageNeatness(session: Readonly<LibrarySession>): number {
  return session.books.length > 0 ? session.neatnessTotal / session.books.length : 0;
}

export function libraryPayout(session: Readonly<LibrarySession>): MinigamePayout {
  const score = Math.max(0, Math.floor(session.score));
  return {
    score,
    coins: Math.min(40, Math.floor(score / 105)),
    xp: Math.min(90, Math.floor(score / 52) + session.bonusBooks * 2),
  };
}
