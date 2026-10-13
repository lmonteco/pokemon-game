/**
 * The camera: follows the player, stays inside the room, lands on whole pixels
 * (GDD 8.1).
 *
 * Pure arithmetic, no Phaser. The scene asks for `left` and `top` and hands
 * them to `camera.setScroll`. Keeping it out of Phaser is what lets the
 * properties that matter -- never showing outside the room, never shimmering --
 * be swept over thousands of positions in a test instead of looked at.
 *
 * Three decisions, in the order they matter on a 240x160 screen:
 *
 * 1. **The scroll is a whole number, always.** This is the big one. At six
 *    times upscale, a camera at x = 10.5 draws the whole world shifted by three
 *    screen pixels relative to a camera at x = 10 -- and a camera that slides
 *    through 10.0, 10.17, 10.33 makes every vertical edge in the room crawl.
 *    The game looks like it is made of static. One `Math.round` removes it.
 * 2. **No smoothing.** A lerped camera is the standard advice and it is wrong
 *    here, because a lerp spends most of its time moving at a fraction of a
 *    pixel per frame, and rounding that gives a camera that holds still for
 *    three frames and then jumps two. The visible result is the shimmer that
 *    (1) exists to remove. A hard deadzone instead moves the camera at exactly
 *    the player's speed or not at all.
 * 3. **The deadzone does the smoothing instead.** Small movements -- a
 *    sidestep, a dodge, the recoil of a hit -- happen with the world held
 *    still, which is what makes them read as the player moving rather than as
 *    the camera lurching.
 */

/** A rectangle of the world, in whole world units. */
export interface CameraViewOptions {
  /** The screen, in world units. 240x160 for the handheld (GDD 8.1). */
  readonly viewWidth: number;
  readonly viewHeight: number;
  /** The room, in world units. */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** How far the target may stray from the centre before the camera moves. */
  readonly deadzoneHalfWidth: number;
  readonly deadzoneHalfHeight: number;
}

export class FollowCamera {
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly deadzoneHalfWidth: number;
  readonly deadzoneHalfHeight: number;

  /**
   * The centre the camera is aiming at, unrounded.
   *
   * The float is the state and the rounding happens on the way out, on
   * purpose. Rounding the state instead would feed the error back in every
   * frame: the camera would quantise its own target, and following a player
   * moving at 0.8 units a tick would stutter in a pattern that repeats every
   * five ticks.
   */
  private centreX = 0;
  private centreY = 0;

  constructor(options: CameraViewOptions) {
    this.viewWidth = options.viewWidth;
    this.viewHeight = options.viewHeight;
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;
    this.deadzoneHalfWidth = options.deadzoneHalfWidth;
    this.deadzoneHalfHeight = options.deadzoneHalfHeight;
  }

  /** Puts the target dead centre. For a spawn or a room change. */
  centreOn(targetX: number, targetY: number): void {
    this.centreX = targetX;
    this.centreY = targetY;
  }

  /**
   * Moves the camera the minimum needed to keep the target inside the
   * deadzone. Call once per rendered frame.
   */
  follow(targetX: number, targetY: number): void {
    const offsetX = targetX - this.centreX;
    if (offsetX > this.deadzoneHalfWidth) {
      this.centreX = targetX - this.deadzoneHalfWidth;
    } else if (offsetX < -this.deadzoneHalfWidth) {
      this.centreX = targetX + this.deadzoneHalfWidth;
    }

    const offsetY = targetY - this.centreY;
    if (offsetY > this.deadzoneHalfHeight) {
      this.centreY = targetY - this.deadzoneHalfHeight;
    } else if (offsetY < -this.deadzoneHalfHeight) {
      this.centreY = targetY + this.deadzoneHalfHeight;
    }
  }

  /**
   * The left edge of the view: a whole number, clamped so the view stays
   * inside the room.
   *
   * Rounding happens before the clamp, not after. The room's bounds are whole
   * numbers, so clamping a rounded value cannot land outside them, whereas
   * rounding a clamped value could push it half a unit past the edge -- a
   * single column of whatever is outside the room, on one frame, which is
   * exactly the kind of flicker nobody can reproduce on demand.
   *
   * When the room is narrower than the screen there is no position that shows
   * only the room, and this returns 0: the room sits against the left edge and
   * the slack shows on the right. The dungeon generator does not make rooms
   * that small, but a hand-authored test template can, and a camera that
   * silently went negative would be worse than one that does the obvious thing.
   */
  get left(): number {
    return clamp(
      Math.round(this.centreX - this.viewWidth / 2),
      0,
      Math.max(0, this.worldWidth - this.viewWidth),
    );
  }

  /** The top edge of the view. The vertical twin of `left`. */
  get top(): number {
    return clamp(
      Math.round(this.centreY - this.viewHeight / 2),
      0,
      Math.max(0, this.worldHeight - this.viewHeight),
    );
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
