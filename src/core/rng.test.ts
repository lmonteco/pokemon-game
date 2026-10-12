import { describe, expect, it } from 'vitest';
import { RNG_STREAMS, Rng, createRngStreams } from './rng';

describe('seeded RNG', () => {
  it('replays the same sequence from the same seed', () => {
    const a = Rng.fromSeed('route-1', 'combat');
    const b = Rng.fromSeed('route-1', 'combat');
    for (let i = 0; i < 1000; i += 1) {
      expect(b.nextUint32()).toBe(a.nextUint32());
    }
  });

  it('diverges on a different seed', () => {
    const a = Rng.fromSeed('route-1', 'combat');
    const b = Rng.fromSeed('route-2', 'combat');
    const first = [a.nextUint32(), a.nextUint32(), a.nextUint32()];
    const second = [b.nextUint32(), b.nextUint32(), b.nextUint32()];
    expect(second).not.toEqual(first);
  });

  // A regression guard, not a restatement of the implementation. These numbers
  // were produced by this generator; if a refactor changes the algorithm, the
  // saves and the recorded balance runs of every earlier build stop matching,
  // and this is the test that says so out loud.
  it('matches its recorded output vector', () => {
    const rng = Rng.fromSeed('DEEPWILD', 'combat');
    const drawn = [
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
    ];
    expect(drawn).toEqual([4132060135, 1418365092, 1033006423, 4230042724, 2548223456, 1302303348]);
  });

  // nextInt32 is the allocation-free draw: a word above 2^31-1 does not fit
  // V8's small integer representation, so returning it unsigned boxes a number
  // on every call. The two methods must stay bit-identical, or the signed one
  // would quietly become a second random sequence.
  it('draws the same bits signed as unsigned', () => {
    const signed = Rng.fromSeed('same-bits', 'combat');
    const unsigned = Rng.fromSeed('same-bits', 'combat');
    let sawNegative = false;
    for (let i = 0; i < 500; i += 1) {
      const s = signed.nextInt32();
      expect(s >>> 0).toBe(unsigned.nextUint32());
      expect(s).toBe(s | 0);
      sawNegative = sawNegative || s < 0;
    }
    // Half the draws should have the top bit set, so this is not a vacuous test.
    expect(sawNegative).toBe(true);
  });

  it('keeps named streams independent', () => {
    const run = createRngStreams('floor-7');
    const reference = createRngStreams('floor-7');

    // Burn a thousand loot rolls. A combat roll afterwards must be unchanged:
    // this is the property that lets the balance simulator vary the drop table
    // and still compare the fight.
    for (let i = 0; i < 1000; i += 1) {
      run.loot.nextUint32();
    }
    expect(run.combat.nextUint32()).toBe(reference.combat.nextUint32());
  });

  it('gives every stream a different starting position', () => {
    const run = createRngStreams('floor-7');
    const firstDraws = RNG_STREAMS.map((stream) => run[stream].nextUint32());
    expect(new Set(firstDraws).size).toBe(RNG_STREAMS.length);
  });

  it('never gets stuck on the zero state', () => {
    // xoshiro's one fixed point: from all zeroes it would emit zeroes forever.
    const rng = Rng.fromState({ s0: 0, s1: 0, s2: 0, s3: 0 });
    const draws = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];
    expect(draws.some((d) => d !== 0)).toBe(true);
  });

  it('keeps nextFloat inside [0, 1)', () => {
    const rng = Rng.fromSeed('bounds', 'cosmetic');
    let min = 1;
    let max = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    // Sanity on distribution: 100k draws should reach both ends of the range.
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });

  it('rolls nextInt uniformly', () => {
    // 3 does not divide 2^32, which is exactly the case where a naive `% 3`
    // skews. Rejection sampling is what keeps the balance simulator's measured
    // rates honest, so this asserts a tight band around a third each.
    const rng = Rng.fromSeed('uniformity', 'loot');
    const buckets = [0, 0, 0];
    const draws = 300_000;
    for (let i = 0; i < draws; i += 1) {
      const slot = rng.nextInt(3);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(3);
      buckets[slot] = (buckets[slot] ?? 0) + 1;
    }
    for (const count of buckets) {
      const deviation = Math.abs(count - draws / 3) / (draws / 3);
      expect(deviation).toBeLessThan(0.02);
    }
  });

  it('rejects a non-positive nextInt bound', () => {
    const rng = Rng.fromSeed('guards', 'combat');
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-1)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
  });

  it('includes both ends of nextIntBetween', () => {
    const rng = Rng.fromSeed('ends', 'spawn');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(rng.nextIntBetween(-2, 2));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('clones without the copy disturbing the original', () => {
    const rng = Rng.fromSeed('clone', 'ai');
    rng.nextUint32();
    const copy = rng.clone();
    for (let i = 0; i < 10; i += 1) {
      copy.nextUint32();
    }
    const reference = Rng.fromSeed('clone', 'ai');
    reference.nextUint32();
    expect(rng.nextUint32()).toBe(reference.nextUint32());
  });

  it('saves and restores a generator position exactly', () => {
    const rng = Rng.fromSeed('save', 'dungeon');
    for (let i = 0; i < 77; i += 1) {
      rng.nextUint32();
    }
    const restored = Rng.fromState(rng.state);
    for (let i = 0; i < 100; i += 1) {
      expect(restored.nextUint32()).toBe(rng.nextUint32());
    }
  });

  it('forks reproducibly from the same parent position and label', () => {
    const childA = Rng.fromSeed('fork', 'dungeon').fork('floor-3');
    const childB = Rng.fromSeed('fork', 'dungeon').fork('floor-3');
    for (let i = 0; i < 20; i += 1) {
      expect(childB.nextUint32()).toBe(childA.nextUint32());
    }
  });

  it('forks differently per label, and draws from a fork do not move the parent', () => {
    const sameLabel = Rng.fromSeed('fork', 'dungeon').fork('floor-3');
    const otherLabel = Rng.fromSeed('fork', 'dungeon').fork('floor-4');
    expect(otherLabel.nextUint32()).not.toBe(sameLabel.nextUint32());

    // A fork costs the parent exactly one draw, whatever the child then does.
    const parent = Rng.fromSeed('fork', 'dungeon');
    const twin = Rng.fromSeed('fork', 'dungeon');
    const child = parent.fork('floor-3');
    for (let i = 0; i < 500; i += 1) {
      child.nextUint32();
    }
    twin.nextUint32();
    expect(parent.nextUint32()).toBe(twin.nextUint32());
  });

  it('shuffles in place, reproducibly', () => {
    const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const b = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    Rng.fromSeed('shuffle', 'loot').shuffle(a);
    Rng.fromSeed('shuffle', 'loot').shuffle(b);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(a).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('picks from a list and refuses an empty one', () => {
    const rng = Rng.fromSeed('pick', 'loot');
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
