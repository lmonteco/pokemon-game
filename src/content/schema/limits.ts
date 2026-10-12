/**
 * Numeric bounds for content values (GDD 4.2, 4.4, 6.1).
 *
 * These are engine limits, not content: they say how big a number may be, never
 * what any particular species or move is called. Validation uses them to reject
 * a stat of 9999 or a level of 0 before such a value can reach a build.
 */

/** Level cap (GDD 6.1: "Level 1 to 50"). */
export const MAX_LEVEL = 50;

/** Series base stats live in 1..255; 0 would make a species unplayable. */
export const MIN_BASE_STAT = 1;
export const MAX_BASE_STAT = 255;

/** Move base power. 0 is reserved for status moves (GDD 4.2). */
export const MAX_MOVE_POWER = 250;

/** Cooldowns replace PP (GDD 4.4). Seconds. */
export const MAX_COOLDOWN_SECONDS = 60;

/** Cast is windup in frames at TICK_HZ (GDD 4.2). 120 frames = 2 seconds. */
export const MAX_CAST_FRAMES = 120;

/** A species has one or two types, as in the series. */
export const MAX_TYPES_PER_SPECIES = 2;

/** Room template bounds, in tiles. Corridors need 4+ tiles (GDD 5.1). */
export const MIN_ROOM_SIZE = 3;
export const MAX_ROOM_SIZE = 64;

/**
 * The only multipliers a single type-chart cell may hold.
 * 0.25x and 4x are products of two cells, computed in the loader (GDD 4.3).
 */
export const TYPE_CHART_CELL_VALUES = [0, 0.5, 1, 2] as const;
