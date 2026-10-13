/**
 * Base stats turned into action-game verbs (GDD 4.4).
 *
 * This file is the whole of that translation, and it is deliberately tiny: the
 * numbers live in the GDD, the species' stat lives in `data/species.json`, and
 * nothing in `src/` decides how fast any particular creature is. Change the
 * `speed` field in the data and the game moves differently with no code edit.
 *
 * Speed is the interesting one, because GDD 4.4 makes it count twice: movement
 * speed and cooldown rate. Both halves are here now -- the cooldown half
 * arrived with the move system (GAM-9 / M1-3), which is its first caller.
 */

import { TILE_PX } from '@/core/constants';

/**
 * The GDD 4.4 movement formula, as four named numbers:
 *
 *   moveSpeed = 3.2 * (1 + (Spe - 100) / 400) tiles/sec, clamped 1.8-6.0
 *
 * The pivot is 100 because that is roughly a mid-tier base Speed in the series,
 * so a 100-Speed species moves at the design-target 3.2 tiles/sec and the stat
 * reads as "faster or slower than normal" rather than as an absolute.
 */
export const BASE_MOVE_SPEED_TILES_PER_SECOND = 3.2;
export const MOVE_SPEED_PIVOT_STAT = 100;
export const MOVE_SPEED_STAT_DIVISOR = 400;
export const MIN_MOVE_SPEED_TILES_PER_SECOND = 1.8;
export const MAX_MOVE_SPEED_TILES_PER_SECOND = 6.0;

/**
 * Movement speed in tiles per second for a base Speed stat (GDD 4.4).
 *
 * The clamp is a guard rail, and it is worth being plain about the fact that it
 * is currently inert: over the series' legal base-stat range of 1..255 the
 * formula returns 2.41..4.44 tiles/sec, which is wholly inside the 1.8..6.0
 * bounds. Even paralysis (GDD 4.5, Speed cut 50%) does not reach them. So the
 * clamp is shaping nothing today, and nobody should tune a species believing
 * the floor is holding it up.
 *
 * It stays because the thing passed in here is an *effective* Speed, and later
 * milestones multiply it -- affixes (GDD 6.4), buffs, stacked status. Those
 * compose, and the clamp is what stops a stack from producing a creature that
 * cannot cross a room before the floor timer or one that leaves the screen.
 * `stats.test.ts` pins both the real range and the point where the clamp
 * starts to bite, so this comment cannot quietly stop being true.
 */
export function moveSpeedTilesPerSecond(speedStat: number): number {
  if (!Number.isFinite(speedStat)) {
    throw new RangeError(`speed stat must be a finite number, got ${speedStat}`);
  }

  const raw =
    BASE_MOVE_SPEED_TILES_PER_SECOND *
    (1 + (speedStat - MOVE_SPEED_PIVOT_STAT) / MOVE_SPEED_STAT_DIVISOR);

  return Math.min(MAX_MOVE_SPEED_TILES_PER_SECOND, Math.max(MIN_MOVE_SPEED_TILES_PER_SECOND, raw));
}

/**
 * The same number in world units per second, which is what the simulation
 * integrates. Kept as a separate function so that the GDD formula above stays
 * readable next to the document it came from.
 */
export function moveSpeedPixelsPerSecond(speedStat: number): number {
  return moveSpeedTilesPerSecond(speedStat) * TILE_PX;
}

/**
 * The GDD 4.4 cooldown formula:
 *
 *   cooldownRate = 1 + (Spe - 100) / 500
 *
 * A multiplier on how fast a cooldown drains, not on its length: a rate of 1.2
 * empties a 1-second cooldown in 5/6 of a second. Expressed that way so that a
 * Speed change mid-cooldown -- paralysis landing on you (GDD 4.5), a scarf
 * coming off -- takes effect immediately on the cooldown already running,
 * rather than only on the next one.
 *
 * Note the divisor is 500 against movement's 400, so Speed moves cooldowns
 * less than it moves the legs. That is the right way round: a fast creature
 * that both outran you and out-shot you by the same factor would compound into
 * a single dominant stat.
 */
export const COOLDOWN_RATE_PIVOT_STAT = 100;
export const COOLDOWN_RATE_STAT_DIVISOR = 500;

/**
 * Bounds on the rate. Inert over the series' legal 1..255 base Speed, which
 * yields 0.80..1.31, for the same reason as the movement clamp above: what is
 * passed in is an *effective* Speed that later milestones multiply, and a
 * stacked debuff must not be able to reach a rate of zero. A rate of zero is a
 * cooldown that never ends, which reads to the player as the game having
 * broken rather than as a very strong debuff.
 */
export const MIN_COOLDOWN_RATE = 0.25;
export const MAX_COOLDOWN_RATE = 4;

export function cooldownRate(speedStat: number): number {
  if (!Number.isFinite(speedStat)) {
    throw new RangeError(`speed stat must be a finite number, got ${speedStat}`);
  }

  const raw = 1 + (speedStat - COOLDOWN_RATE_PIVOT_STAT) / COOLDOWN_RATE_STAT_DIVISOR;

  return Math.min(MAX_COOLDOWN_RATE, Math.max(MIN_COOLDOWN_RATE, raw));
}
