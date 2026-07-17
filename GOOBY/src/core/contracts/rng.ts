export interface RandomSource {
  /** Returns a value in [0, 1). */
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

/** Mulberry32: tiny, fast and stable across JavaScript runtimes. */
export class SeededRng implements RandomSource {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new RangeError("Expected a non-empty integer range");
    }
    return Math.floor(this.next() * (maxExclusive - minInclusive)) + minInclusive;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Cannot choose from an empty collection");
    return items[this.int(0, items.length)] as T;
  }
}
