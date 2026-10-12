/**
 * How many screen pixels one game pixel is allowed to take.
 *
 * Kept in its own module, free of Phaser, so the one piece of maths that
 * decides whether pixels come out square can be tested without a browser.
 *
 * The answer is always a whole number. A fractional zoom is what makes a
 * handheld-resolution game look wrong: at 3.4x the browser draws some game
 * pixels 3 screen pixels wide and some 4, so a 1px outline thickens and thins
 * along its own length and a 1px checkerboard turns to mush. Whole numbers
 * only, and the remainder of the window becomes letterboxing.
 */

import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';

/** The smallest zoom. Below 1x there are no whole numbers left to pick. */
export const MIN_ZOOM = 1;

/**
 * The largest whole-number zoom at which 240x160 still fits in the given
 * space, or `MIN_ZOOM` if it does not fit at all.
 *
 * A window smaller than 240x160 is clamped rather than scaled down: the game
 * overflows and is clipped, which keeps the pixels square. Scaling down would
 * drop whole rows of pixels, which is worse than not seeing all of them.
 */
export function integerZoom(parentWidth: number, parentHeight: number): number {
  const horizontal = parentWidth / GAME_WIDTH;
  const vertical = parentHeight / GAME_HEIGHT;
  const fitting = Math.floor(Math.min(horizontal, vertical));

  if (!Number.isFinite(fitting)) {
    // A parent that has not been measured yet reports 0, and NaN can only
    // come from a non-finite bound. Either way 1x is the safe answer.
    return MIN_ZOOM;
  }

  return Math.max(MIN_ZOOM, fitting);
}

/** The drawn size of the canvas at a zoom, in screen pixels. */
export function zoomedSize(zoom: number): { width: number; height: number } {
  return { width: GAME_WIDTH * zoom, height: GAME_HEIGHT * zoom };
}
