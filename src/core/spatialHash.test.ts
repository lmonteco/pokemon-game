import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { DEFAULT_CELL_SIZE, SpatialHash } from './spatialHash';

/**
 * The brute-force reference. Deliberately written the slow, obvious way -- a
 * nested loop and one square root's worth of arithmetic -- because the whole
 * point of comparing against it is that it is too simple to be wrong.
 */
function bruteForce(
  items: readonly { id: number; x: number; y: number; radius: number }[],
  x: number,
  y: number,
  radius: number,
): number[] {
  const found: number[] = [];

  for (const item of items) {
    const dx = item.x - x;
    const dy = item.y - y;
    const sum = item.radius + radius;

    if (dx * dx + dy * dy < sum * sum) {
      found.push(item.id);
    }
  }

  return found;
}

function sorted(ids: readonly number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

function idsFrom(out: Int32Array, count: number): number[] {
  return sorted(Array.from(out.subarray(0, count)));
}

describe('spatial hash construction', () => {
  it('covers the world with whole cells', () => {
    const hash = new SpatialHash(200, 100, 16, 32);

    // 200/32 is 6.25 columns, which has to round up: a grid that covered only
    // six columns would drop everything in the last 8 units of the room.
    expect(hash.columns).toBe(7);
    expect(hash.rows).toBe(4);
  });

  it('always has at least one cell, even for a world smaller than a cell', () => {
    const hash = new SpatialHash(4, 4, 8, DEFAULT_CELL_SIZE);

    expect(hash.columns).toBe(1);
    expect(hash.rows).toBe(1);
  });

  it('rejects nonsense dimensions rather than building a grid with no cells', () => {
    expect(() => new SpatialHash(0, 100, 8)).toThrow(RangeError);
    expect(() => new SpatialHash(100, -1, 8)).toThrow(RangeError);
    expect(() => new SpatialHash(100, 100, 0)).toThrow(RangeError);
    expect(() => new SpatialHash(100, 100, 2.5)).toThrow(RangeError);
    expect(() => new SpatialHash(100, 100, 8, 0)).toThrow(RangeError);
  });
});

describe('spatial hash capacity', () => {
  it('refuses the insert past its cap instead of growing', () => {
    const hash = new SpatialHash(256, 256, 3);

    expect(hash.insert(1, 10, 10, 2)).toBe(true);
    expect(hash.insert(2, 20, 20, 2)).toBe(true);
    expect(hash.insert(3, 30, 30, 2)).toBe(true);
    expect(hash.insert(4, 40, 40, 2)).toBe(false);
    expect(hash.count).toBe(3);
  });

  it('empties on clear and takes inserts again', () => {
    const hash = new SpatialHash(256, 256, 2);
    const out = new Int32Array(2);

    hash.insert(1, 10, 10, 4);
    hash.insert(2, 12, 10, 4);
    expect(hash.query(10, 10, 1, out)).toBe(2);

    hash.clear();
    expect(hash.count).toBe(0);
    expect(hash.query(10, 10, 1, out)).toBe(0);

    expect(hash.insert(7, 10, 10, 4)).toBe(true);
    expect(hash.query(10, 10, 1, out)).toBe(1);
    expect(out[0]).toBe(7);
  });

  it('throws on an output buffer that could silently truncate the result', () => {
    const hash = new SpatialHash(256, 256, 8);
    hash.insert(1, 10, 10, 4);

    expect(() => hash.query(10, 10, 4, new Int32Array(7))).toThrow(RangeError);
  });
});

describe('spatial hash overlap rule', () => {
  it('counts an overlap but not an exact touch', () => {
    const hash = new SpatialHash(256, 256, 4);
    const out = new Int32Array(4);

    hash.insert(1, 10, 10, 3);

    // Centres 8 apart, radii summing to 8: flush, and deliberately a miss, so
    // a projectile resting against a target is not re-hit every tick.
    expect(hash.query(18, 10, 5, out)).toBe(0);
    expect(hash.query(17.99, 10, 5, out)).toBe(1);
  });

  it('finds a neighbour across a cell boundary', () => {
    const hash = new SpatialHash(256, 256, 4, 32);
    const out = new Int32Array(4);

    // Column 0 and column 1, two units apart. A broadphase that only looked at
    // the query point's own cell would report nothing here, and the bug would
    // show up in play as shots passing through enemies every 32 units.
    hash.insert(1, 31, 50, 2);
    expect(hash.query(33, 50, 2, out)).toBe(1);
    expect(out[0]).toBe(1);
  });

  it('finds a large item whose centre is cells away from the query', () => {
    const hash = new SpatialHash(512, 512, 4, 16);
    const out = new Int32Array(4);

    // Radius 40 against a 16-unit cell: the item's centre is two and a half
    // cells from the query box, and only the expand-by-max-radius rule in
    // `query` brings it into view.
    hash.insert(1, 100, 100, 40);
    expect(hash.query(135, 100, 2, out)).toBe(1);
  });

  it('keeps items outside the grid findable by clamping them to the edge', () => {
    const hash = new SpatialHash(64, 64, 4, 32);
    const out = new Int32Array(4);

    // Walls make this unreachable in play, but an entity that escaped the room
    // through a bug elsewhere must still collide rather than quietly stop
    // existing to the broadphase.
    hash.insert(1, -40, -40, 3);
    expect(hash.query(-41, -39, 3, out)).toBe(1);
  });
});

describe('spatial hash against brute force', () => {
  /**
   * The acceptance criterion: over randomised positions the hash must return
   * *exactly* the brute-force set. Not a superset -- the hash does its own
   * narrow phase, so "maybe" is not an answer it is allowed to give.
   *
   * Seeded through the game's own RNG so a failure is reproducible from the
   * seed printed in the test name, rather than being a flake somebody reruns.
   */
  const CASES: readonly { seed: string; cellSize: number; items: number }[] = [
    { seed: 'broadphase-a', cellSize: 32, items: 240 },
    // A cell smaller than the items, so most items straddle several cells.
    { seed: 'broadphase-b', cellSize: 4, items: 120 },
    // A cell far bigger than the room, so everything lands in one bucket and
    // the hash degenerates to the brute-force loop it is replacing.
    { seed: 'broadphase-c', cellSize: 512, items: 80 },
  ];

  CASES.forEach(({ seed, cellSize, items }) => {
    it(`agrees with brute force over randomised positions (seed "${seed}")`, () => {
      const rng = Rng.fromSeed(seed, 'dungeon');
      const width = 640;
      const height = 480;
      const hash = new SpatialHash(width, height, items, cellSize);
      const out = new Int32Array(items);

      const placed: { id: number; x: number; y: number; radius: number }[] = [];

      for (let i = 0; i < items; i += 1) {
        const item = {
          id: i + 1,
          // Beyond the room on both sides, so the clamped edge cells are
          // exercised by the comparison and not just by their own test.
          x: rng.nextFloatBetween(-20, width + 20),
          y: rng.nextFloatBetween(-20, height + 20),
          radius: rng.nextFloatBetween(1, 12),
        };
        placed.push(item);
        expect(hash.insert(item.id, item.x, item.y, item.radius)).toBe(true);
      }

      for (let probe = 0; probe < 500; probe += 1) {
        const x = rng.nextFloatBetween(-20, width + 20);
        const y = rng.nextFloatBetween(-20, height + 20);
        const radius = rng.nextFloatBetween(0.5, 10);

        const expected = sorted(bruteForce(placed, x, y, radius));
        const count = hash.query(x, y, radius, out);

        expect(idsFrom(out, count)).toEqual(expected);
      }
    });
  });

  it('agrees with brute force at the GDD 9.4 budget, rebuilt every tick', () => {
    // 200 projectiles querying against 40 entities, for 60 ticks: the shape of
    // the real workload, including the clear-and-reinsert that a moving world
    // does. Checks that nothing leaks across a rebuild.
    const rng = Rng.fromSeed('budget', 'dungeon');
    const hash = new SpatialHash(640, 480, 40, 32);
    const out = new Int32Array(40);

    for (let tick = 0; tick < 60; tick += 1) {
      hash.clear();

      const placed: { id: number; x: number; y: number; radius: number }[] = [];
      for (let i = 0; i < 40; i += 1) {
        const item = {
          id: i + 1,
          x: rng.nextFloatBetween(0, 640),
          y: rng.nextFloatBetween(0, 480),
          radius: 6,
        };
        placed.push(item);
        hash.insert(item.id, item.x, item.y, item.radius);
      }

      for (let shot = 0; shot < 200; shot += 1) {
        const x = rng.nextFloatBetween(0, 640);
        const y = rng.nextFloatBetween(0, 480);
        const count = hash.query(x, y, 3, out);

        expect(idsFrom(out, count)).toEqual(sorted(bruteForce(placed, x, y, 3)));
      }
    }
  });
});
