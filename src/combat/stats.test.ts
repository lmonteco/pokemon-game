import { describe, expect, it } from 'vitest';
import { TILE_PX } from '@/core/constants';
import { MAX_BASE_STAT, MIN_BASE_STAT } from '@/content/schema/limits.ts';
import {
  MAX_COOLDOWN_RATE,
  MAX_MOVE_SPEED_TILES_PER_SECOND,
  MIN_COOLDOWN_RATE,
  MIN_MOVE_SPEED_TILES_PER_SECOND,
  cooldownRate,
  moveSpeedPixelsPerSecond,
  moveSpeedTilesPerSecond,
} from './stats';

/**
 * GDD 4.4 states movement speed as a formula, and M1-1's acceptance criteria
 * say movement speed must change when the Speed stat in `data/` changes with no
 * code edit. Both of those are claims about this function, so they are pinned
 * here rather than looked at on screen.
 *
 * The formula is transcribed from the GDD independently below rather than
 * imported from the implementation. A test that reuses the implementation's own
 * arithmetic would pass just as happily if someone changed the pivot from 100
 * to 120, which is exactly the regression worth catching.
 */

/** GDD 4.4, typed out from the document: `3.2 * (1 + (Spe - 100) / 400)`. */
const gddFormula = (speedStat: number): number => 3.2 * (1 + (speedStat - 100) / 400);

/** GDD 4.4's other half, typed out the same way: `1 + (Spe - 100) / 500`. */
const gddCooldownFormula = (speedStat: number): number => 1 + (speedStat - 100) / 500;

/** Every base stat a species may legally carry. */
const LEGAL_STATS = Array.from(
  { length: MAX_BASE_STAT - MIN_BASE_STAT + 1 },
  (_, i) => MIN_BASE_STAT + i,
);

describe('moveSpeedTilesPerSecond', () => {
  it('matches the GDD 4.4 formula across the legal stat range', () => {
    const mismatches: string[] = [];

    LEGAL_STATS.forEach((stat) => {
      const expected = gddFormula(stat);

      if (moveSpeedTilesPerSecond(stat) !== expected) {
        mismatches.push(`${stat}: ${moveSpeedTilesPerSecond(stat)} != ${expected}`);
      }
    });

    expect(mismatches).toEqual([]);
  });

  it('puts a 100-Speed species at the design target of 3.2 tiles/sec', () => {
    // The pivot. If this moves, every species in the game changes speed at
    // once and no single data file will look wrong.
    expect(moveSpeedTilesPerSecond(100)).toBe(3.2);
  });

  it('is strictly faster for a faster species', () => {
    // The whole point of GDD 4.4: "a fast Pokemon actually feels fast". A
    // non-monotonic formula would be a design bug, not a rounding detail.
    const notRising: string[] = [];

    for (let i = 1; i < LEGAL_STATS.length; i += 1) {
      const lower = LEGAL_STATS[i - 1] ?? 0;
      const higher = LEGAL_STATS[i] ?? 0;

      if (moveSpeedTilesPerSecond(higher) <= moveSpeedTilesPerSecond(lower)) {
        notRising.push(`${lower} -> ${higher}`);
      }
    }

    expect(notRising).toEqual([]);
  });

  it('spans 2.408 to 4.44 tiles/sec over the legal stat range', () => {
    // Pinned because it is the band the game is actually tuned in. Room sizes,
    // enemy telegraph windows (GDD 4.1) and the floor timer are all judged
    // against these two numbers.
    expect(moveSpeedTilesPerSecond(MIN_BASE_STAT)).toBeCloseTo(2.408, 10);
    expect(moveSpeedTilesPerSecond(MAX_BASE_STAT)).toBeCloseTo(4.44, 10);
  });

  it('never reaches its own clamp for a legal base stat', () => {
    // The clamp is a guard rail for stacked modifiers, not part of the tuning.
    // This test is what keeps that statement in `stats.ts` honest: if someone
    // widens the stat range or moves the pivot far enough that the clamp starts
    // silently flattening real species, this fails and they have to say so.
    const clamped = LEGAL_STATS.filter(
      (stat) => moveSpeedTilesPerSecond(stat) !== gddFormula(stat),
    );

    expect(clamped).toEqual([]);
  });

  it('clamps an effective Speed pushed outside the range by modifiers', () => {
    // Where the guard rail does bite. Reachable only once affixes and buffs
    // compose (GDD 6.4), which is why the bound is tested rather than assumed.
    expect(moveSpeedTilesPerSecond(-1000)).toBe(MIN_MOVE_SPEED_TILES_PER_SECOND);
    expect(moveSpeedTilesPerSecond(10_000)).toBe(MAX_MOVE_SPEED_TILES_PER_SECOND);

    // A paralysed top-Speed creature (GDD 4.5: Speed cut 50%) is still inside
    // the band, so paralysis slows you without hitting a floor that would make
    // the status feel weaker than it reads.
    expect(moveSpeedTilesPerSecond(MAX_BASE_STAT / 2)).toBeGreaterThan(
      MIN_MOVE_SPEED_TILES_PER_SECOND,
    );
  });

  it('rejects a stat that is not a finite number', () => {
    // NaN would propagate into the position and silently delete the player:
    // every later comparison against a NaN coordinate is false, so collision
    // would stop stopping them. Better to fail where the bad value entered.
    expect(() => moveSpeedTilesPerSecond(Number.NaN)).toThrow(RangeError);
    expect(() => moveSpeedTilesPerSecond(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

/**
 * The second job GDD 4.4 gives Speed, and the one that replaced PP. It is the
 * rate every cooldown in the game drains at, so an error here is invisible in
 * any one move and wrong in all of them at once.
 */
describe('cooldownRate', () => {
  it('matches the GDD 4.4 formula across the legal stat range', () => {
    const mismatches: string[] = [];

    LEGAL_STATS.forEach((stat) => {
      const expected = gddCooldownFormula(stat);

      if (cooldownRate(stat) !== expected) {
        mismatches.push(`${stat}: ${cooldownRate(stat)} != ${expected}`);
      }
    });

    expect(mismatches).toEqual([]);
  });

  it('leaves a 100-Speed species on its move’s authored cooldown', () => {
    // The pivot has to be exactly 1, or every cooldown in `data/moves.json`
    // means something other than the seconds it says.
    expect(cooldownRate(100)).toBe(1);
  });

  it('moves cooldowns less than it moves the legs', () => {
    // The divisors differ on purpose (500 against 400). If they were equal,
    // Speed would compound into a single dominant stat -- see `stats.ts`.
    const speedGain = moveSpeedTilesPerSecond(200) / moveSpeedTilesPerSecond(100);
    const cooldownGain = cooldownRate(200) / cooldownRate(100);

    expect(cooldownGain).toBeLessThan(speedGain);
  });

  it('spans 0.80 to 1.31 over the legal stat range', () => {
    // The band the move numbers are tuned against: the slowest species pays
    // about a quarter more than the authored cooldown, the fastest saves a
    // quarter. Wide enough to feel, narrow enough that Speed is not the move.
    expect(cooldownRate(MIN_BASE_STAT)).toBeCloseTo(0.802, 10);
    expect(cooldownRate(MAX_BASE_STAT)).toBeCloseTo(1.31, 10);
  });

  it('never reaches its own clamp for a legal base stat', () => {
    const clamped = LEGAL_STATS.filter((stat) => cooldownRate(stat) !== gddCooldownFormula(stat));

    expect(clamped).toEqual([]);
  });

  it('clamps away from zero, which would be a cooldown that never ends', () => {
    // A rate of zero reads to the player as the game having broken rather than
    // as a very strong debuff, so the floor is a guard rail on stacked
    // modifiers (GDD 6.4), not tuning.
    expect(cooldownRate(-100_000)).toBe(MIN_COOLDOWN_RATE);
    expect(cooldownRate(100_000)).toBe(MAX_COOLDOWN_RATE);
    expect(MIN_COOLDOWN_RATE).toBeGreaterThan(0);
  });

  it('rejects a stat that is not a finite number', () => {
    // NaN here would make the drain NaN, so the cooldown would never compare
    // as elapsed and the move would be dead for the rest of the run.
    expect(() => cooldownRate(Number.NaN)).toThrow(RangeError);
    expect(() => cooldownRate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('moveSpeedPixelsPerSecond', () => {
  it('is the tiles/sec figure in world units', () => {
    expect(moveSpeedPixelsPerSecond(100)).toBe(3.2 * TILE_PX);
  });

  it('keeps the two units in step across the legal range', () => {
    const mismatches: string[] = [];

    LEGAL_STATS.forEach((stat) => {
      const expected = moveSpeedTilesPerSecond(stat) * TILE_PX;

      if (moveSpeedPixelsPerSecond(stat) !== expected) {
        mismatches.push(`${stat}`);
      }
    });

    expect(mismatches).toEqual([]);
  });
});
