/**
 * Seeded RNG for the whole simulation (GDD 9.3, 9.4).
 *
 * `Math.random()` is banned in the simulation paths; see
 * `no-wall-clock.test.ts`, which fails the test run if it reappears. Every
 * random number in DEEPWILD comes from here, from a named stream, so a run is
 * reproducible from its seed string alone.
 *
 * Algorithm: xoshiro128**. Four 32-bit words of state, a handful of shifts and
 * two multiplies per draw, passes the usual statistical batteries at this size,
 * and - the reason it is here rather than a one-line LCG - it has no weak low
 * bits, so `nextInt(2)` is as fair as `nextFloat()`.
 *
 * All arithmetic is 32-bit integer arithmetic via `Math.imul` and `>>>`, which
 * is exact in every JS engine. No doubles are involved until `nextFloat`, so
 * the sequence is identical on every machine.
 */

import { HASH_SEED, hashString, hashUint32 } from './hash';

/**
 * The independent random streams. Keeping them separate means a loot roll can
 * never shift a combat roll: fight the same floor with a different drop table
 * and the fight still plays out the same way, which is what makes the balance
 * simulator in GDD 9.3 able to isolate one variable.
 *
 * These are system names, not content. No species, move or item names here.
 */
export const RNG_STREAMS = ['dungeon', 'spawn', 'combat', 'loot', 'ai', 'cosmetic'] as const;

export type RngStream = (typeof RNG_STREAMS)[number];

/** The four words of generator state. Enough to save, restore or diff a run. */
export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

const TWO_POW_32 = 0x100000000;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * splitmix32. Used only to expand a single seed word into four well-mixed
 * state words; a raw string hash would leave xoshiro's state too correlated
 * for the first few draws.
 */
function splitmix32(state: number): { value: number; next: number } {
  let z = (state + 0x9e3779b9) >>> 0;
  let v = z;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x735a2d97) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  z = z >>> 0;
  return { value: v, next: z };
}

/** Turns any seed string into a 32-bit word. Stable across runs and machines. */
export function seedToWord(seed: string): number {
  return hashString(HASH_SEED, seed);
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** Draws taken so far. Cheap desync detector: two runs should match here. */
  private drawn = 0;

  private constructor(s0: number, s1: number, s2: number, s3: number) {
    this.s0 = s0 >>> 0;
    this.s1 = s1 >>> 0;
    this.s2 = s2 >>> 0;
    this.s3 = s3 >>> 0;
    // All-zero state is the one fixed point of xoshiro: it would emit zeros
    // forever. Reachable only from a seed that hashes to exactly the wrong
    // word, but a silent dead generator is the kind of bug that eats a day.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = 0x9e3779b9;
    }
  }

  /** Builds a generator from a 32-bit word, expanding it through splitmix32. */
  static fromWord(word: number): Rng {
    let carry = word >>> 0;
    const words: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const mixed = splitmix32(carry);
      words.push(mixed.value);
      carry = mixed.next;
    }
    return new Rng(words[0] ?? 0, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0);
  }

  /** Builds a generator from a seed string and a stream name. */
  static fromSeed(seed: string, stream: RngStream): Rng {
    return Rng.fromWord(hashString(seedToWord(seed), `:${stream}`));
  }

  /** Restores a saved generator exactly. */
  static fromState(state: RngState): Rng {
    return new Rng(state.s0, state.s1, state.s2, state.s3);
  }

  /**
   * The raw generator output, as a *signed* 32 bit integer.
   *
   * This is the allocation-free draw and the one the hot path should use. The
   * signed type is not cosmetic: a value above 2^31-1 does not fit V8's small
   * integer representation, so returning an unsigned word allocates a boxed
   * number on every single call. Measured on this machine, `nextUint32` costs
   * about 15 bytes of heap per call and `nextInt32` costs nothing - which at
   * 60Hz with 200 projectiles is the difference between a quiet heap and a
   * scavenge every few seconds.
   *
   * The bit sequence is identical to `nextUint32`; only the interpretation of
   * the top bit differs. Use `>>> 0` at the point of use if you want the
   * unsigned value.
   */
  nextInt32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) | 0;

    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);

    this.drawn += 1;
    return result;
  }

  /**
   * The raw generator output as a uniform 32-bit unsigned integer. Convenient
   * for printing and for test vectors; prefer `nextInt32`, `nextInt` or
   * `nextFloat` inside a simulation step. See `nextInt32` for why.
   */
  nextUint32(): number {
    return this.nextInt32() >>> 0;
  }

  /** Uniform in [0, 1). 32 bits of resolution, exact in binary floating point. */
  nextFloat(): number {
    return (this.nextInt32() >>> 0) / TWO_POW_32;
  }

  /**
   * Uniform integer in [0, maxExclusive). Rejection sampled, so there is no
   * modulo bias: `nextInt(3)` really is one third each, which matters for
   * anything the balance simulator measures.
   */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`nextInt needs a positive integer bound, got ${maxExclusive}`);
    }
    if (maxExclusive === 1) {
      // Still draw, so that call counts stay comparable between runs.
      this.nextInt32();
      return 0;
    }
    const limit = TWO_POW_32 - (TWO_POW_32 % maxExclusive);
    let x = this.nextInt32() >>> 0;
    while (x >= limit) {
      x = this.nextInt32() >>> 0;
    }
    // The result is below maxExclusive, so it is always a small integer: this
    // return allocates nothing.
    return x % maxExclusive;
  }

  /** Uniform integer in [min, max], both ends included. */
  nextIntBetween(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError(`nextIntBetween needs integers, got ${min}..${max}`);
    }
    if (max < min) {
      throw new RangeError(`nextIntBetween needs min <= max, got ${min}..${max}`);
    }
    return min + this.nextInt(max - min + 1);
  }

  /** Uniform double in [min, max). */
  nextFloatBetween(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** True with probability `p`. p <= 0 never fires, p >= 1 always does. */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  /** One element, uniformly. Throws on an empty list rather than return undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('pick needs a non-empty list');
    }
    const chosen = items[this.nextInt(items.length)];
    if (chosen === undefined) {
      throw new RangeError('pick drew an index outside the list');
    }
    return chosen;
  }

  /** Fisher-Yates, in place, so shuffling a pooled array allocates nothing. */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(i + 1);
      const a = items[i];
      const b = items[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      items[i] = b;
      items[j] = a;
    }
  }

  /**
   * Derives a child generator from this one, consuming one draw. Use it for
   * per-floor or per-encounter sub-streams: the child is reproducible from the
   * parent's position, and draws from the child never move the parent.
   */
  fork(label: string): Rng {
    return Rng.fromWord(hashString(hashUint32(HASH_SEED, this.nextInt32()), label));
  }

  /** An independent copy, for speculative rolls that must not disturb the run. */
  clone(): Rng {
    const copy = new Rng(this.s0, this.s1, this.s2, this.s3);
    copy.drawn = this.drawn;
    return copy;
  }

  get state(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  /** Number of raw draws taken. Rejection retries count. */
  get draws(): number {
    return this.drawn;
  }

  /** Folds the generator position into a running state hash. */
  hash(h: number): number {
    return hashUint32(hashUint32(hashUint32(hashUint32(h, this.s0), this.s1), this.s2), this.s3);
  }
}

/** The full set of streams for one run, all derived from one seed string. */
export type RngStreams = { readonly [S in RngStream]: Rng };

export function createRngStreams(seed: string): RngStreams {
  const streams: Partial<Record<RngStream, Rng>> = {};
  for (const stream of RNG_STREAMS) {
    streams[stream] = Rng.fromSeed(seed, stream);
  }
  return streams as RngStreams;
}
