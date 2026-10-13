/** Native resolution of the virtual handheld (GDD 8.1). */
export const GAME_WIDTH = 240;
export const GAME_HEIGHT = 160;

/** Simulation rate for the fixed-step loop (GDD 9.4). Owned by M0-3. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Tile edge in world units (GDD 8.1: tiles are 16x16).
 *
 * World units are screen pixels at 1x, one for one. That is the choice that
 * makes the rest of the game simple: a position needs no conversion to be
 * drawn, and the only rounding anywhere is the whole-pixel snap at draw time
 * (GDD 8.1). The one place a conversion is unavoidable is GDD 4.4, which
 * states movement speed in tiles per second -- see `combat/stats.ts`.
 */
export const TILE_PX = 16;
