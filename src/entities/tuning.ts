/**
 * Every number that decides how movement *feels* (GDD 4.1).
 *
 * This file exists so that the feel pass in M1-5 is a handful of edits in one
 * place rather than a hunt through the systems. If you are tuning the game,
 * tune here.
 *
 * The rule for what belongs in this file: a number belongs here when changing
 * it changes how the game feels and nothing else. Numbers that come from the
 * GDD's formulas (movement speed from the Speed stat) do not belong here --
 * they live in `combat/stats.ts` next to the formula -- and numbers that come
 * from content do not belong in `src/` at all (GDD 11.3).
 *
 * Why accelerations are expressed in *ticks* rather than in units per second
 * squared: the target in the M1-1 plan is "full speed within ~4 frames of
 * press, full stop within ~4 frames of release", and that target is the same
 * for a slow species and a fast one. A raw acceleration would make the fast
 * species take longer to reach its higher top speed, which is backwards -- a
 * fast Pokemon should feel *more* responsive, not less. Stating the ramp as a
 * number of ticks makes the acceleration scale with the top speed for free.
 */

/**
 * Ticks from a standing start to full speed. At 60Hz, 4 ticks is 67ms: fast
 * enough to read as instant, slow enough that the first step is not a teleport.
 */
export const TICKS_TO_FULL_SPEED = 4;

/**
 * Ticks from full speed to a dead stop on key release. Shorter than the ramp
 * up on purpose: a character that keeps sliding after you let go is the single
 * most common reason action movement feels floaty.
 */
export const TICKS_TO_STOP = 3;

/**
 * Ticks to swap to the opposite direction. Applies when the new direction
 * opposes the current velocity by more than 90 degrees, which is the case that
 * would otherwise cost `TICKS_TO_STOP + TICKS_TO_FULL_SPEED` and feel like
 * wading. Panic reversals are the thing a player does when they are about to
 * be hit, so this is the one that has to be snappy.
 */
export const TICKS_TO_REVERSE = 2;

/**
 * The player's collision box, as half-extents in world units.
 *
 * Narrower than the 16x16 sprite, and shorter than it is wide. Both are
 * deliberate:
 *
 * - 10 units wide against a 16-unit tile means a one-tile gap is comfortably
 *   passable instead of being a pixel-perfect challenge the player will read
 *   as the game being broken.
 * - 8 units tall and anchored low means the box is the creature's feet. The
 *   head overlapping a wall above looks like depth; the feet overlapping it
 *   looks like a bug.
 */
export const PLAYER_HALF_WIDTH = 5;
export const PLAYER_HALF_HEIGHT = 4;

/**
 * Where the collision box sits relative to the drawn sprite's centre. Positive
 * is down, so the box is below the middle of the sprite -- at the feet.
 */
export const PLAYER_BOX_OFFSET_Y = 4;

/**
 * Half-extents of the camera deadzone, in world units (GDD 8.1's 240x160
 * screen). The player may move this far from the centre of the screen before
 * the camera moves at all.
 *
 * 32x20 out of 240x160 is a small deadzone: about a quarter of the screen. Big
 * enough that a sidestep or a dodge does not drag the whole world with it,
 * small enough that the player never approaches the screen edge and loses
 * sight of what is coming.
 */
export const CAMERA_DEADZONE_HALF_WIDTH = 32;
export const CAMERA_DEADZONE_HALF_HEIGHT = 20;

/**
 * World units of travel per walk-animation frame.
 *
 * The walk cycle is driven by distance travelled, not by elapsed time. That
 * makes the legs move in step with the feet for free at any Speed stat, which
 * is what stops a fast species from looking like it is ice-skating, and it
 * cannot drift out of sync with the simulation because it is not a clock.
 */
export const WALK_FRAME_DISTANCE = 5;

/**
 * How close the mouse may get to the player before aim is ignored, in world
 * units. Inside this radius the tiny vector from the player to the cursor
 * swings wildly for a one-pixel mouse move, which would make the facing
 * direction flicker. Within the deadzone the last good aim is held.
 */
export const AIM_DEADZONE = 3;
