/**
 * The input vocabulary of the simulation (GDD 7).
 *
 * `core/world.ts` carries one frame of player intent as a `buttons` bit field
 * and an aim vector, and leaves the meaning of the bits to M1. This file is
 * that meaning, and it is pure: no Phaser, no DOM, no device. The device half
 * lives in `render/deviceInput.ts`, and the seam between them is what lets a
 * recorded run be replayed and the balance harness in GDD 9.3 drive the player
 * with no browser at all.
 *
 * The bit numbers are a wire format. A recorded input log is a list of these
 * integers, so renumbering a bit silently invalidates every recording -- add
 * new ones at the top end, never reuse a retired one.
 */

export const BUTTON_MOVE_UP = 1 << 0;
export const BUTTON_MOVE_DOWN = 1 << 1;
export const BUTTON_MOVE_LEFT = 1 << 2;
export const BUTTON_MOVE_RIGHT = 1 << 3;

/**
 * Space, the dodge (GDD 7). Claimed here rather than in M1-2 so that the four
 * movement bits and the dodge bit have a stable layout from the first recorded
 * run. Nothing in M1-1 reads it.
 */
export const BUTTON_DODGE = 1 << 4;

/**
 * Fire the selected move (GDD 4.1: mouse to aim, and the mouse fires it).
 *
 * A button bit rather than a pointer event read straight from the browser,
 * because the simulation must not know what a mouse is: the balance harness in
 * GDD 9.3 sets this bit with no device attached, and a recorded run replays it
 * like any other button. Which physical button sets it is
 * `render/deviceInput.ts`.
 */
export const BUTTON_FIRE = 1 << 5;

/** A direction or a position. Mutated in place; never allocated per tick. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The four facing directions a sprite is drawn in (GDD 8.1: "four directions").
 *
 * Ordered to match the sprite sheet's rows, so the facing *is* the row index
 * and no lookup table is needed.
 */
export const FACING_DOWN = 0;
export const FACING_UP = 1;
export const FACING_LEFT = 2;
export const FACING_RIGHT = 3;

export type Facing =
  typeof FACING_DOWN | typeof FACING_UP | typeof FACING_LEFT | typeof FACING_RIGHT;

export const FACINGS: readonly Facing[] = [FACING_DOWN, FACING_UP, FACING_LEFT, FACING_RIGHT];

/**
 * Writes the player's intended direction of travel into `out`, as a unit
 * vector, or zero when they are not asking to move.
 *
 * Two decisions here, both of which the acceptance criteria name:
 *
 * - **Opposite keys cancel.** Holding left and right is zero on that axis, not
 *   last-key-wins. It is what the player's hands expect, and it means a stuck
 *   key cannot leave the character drifting.
 * - **The vector is normalised, so a diagonal is exactly as fast as a
 *   cardinal.** Summing the axes without normalising is the single most common
 *   bug in top-down movement: the character moves 1.41x faster diagonally, and
 *   every player who notices runs everywhere diagonally forever.
 */
export function moveDirection(buttons: number, out: Vec2): Vec2 {
  const x =
    ((buttons & BUTTON_MOVE_RIGHT) === 0 ? 0 : 1) - ((buttons & BUTTON_MOVE_LEFT) === 0 ? 0 : 1);
  const y =
    ((buttons & BUTTON_MOVE_DOWN) === 0 ? 0 : 1) - ((buttons & BUTTON_MOVE_UP) === 0 ? 0 : 1);

  if (x === 0 && y === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }

  // Only three magnitudes are reachable from four keys: 0, 1 and sqrt(2). The
  // division is written out rather than special-cased because the explicit
  // form is the one that is obviously correct.
  const length = Math.sqrt(x * x + y * y);

  out.x = x / length;
  out.y = y / length;
  return out;
}

/**
 * Normalises a raw aim vector -- the offset from the player to the cursor --
 * into `out`, and reports whether it was usable.
 *
 * Returns false and leaves `out` untouched when the cursor is within
 * `deadzone` of the player. Inside that radius the direction is noise: a
 * one-pixel mouse move can swing it 90 degrees, and the character would spin.
 * Holding the last good aim is what the player means by leaving the mouse
 * where it is.
 */
export function aimDirection(aimX: number, aimY: number, deadzone: number, out: Vec2): boolean {
  const length = Math.sqrt(aimX * aimX + aimY * aimY);

  if (!(length > deadzone)) {
    return false;
  }

  out.x = aimX / length;
  out.y = aimY / length;
  return true;
}

/**
 * The facing to draw for a direction vector, keeping `fallback` when the
 * vector is zero.
 *
 * The dominant axis wins, with a tie going to the vertical. Four directions
 * out of 360 degrees means every choice of boundary is arbitrary; what matters
 * is that it is stable, because a rule that flickers between two facings at
 * the boundary is the one the player sees.
 */
export function facingFromVector(x: number, y: number, fallback: Facing): Facing {
  if (x === 0 && y === 0) {
    return fallback;
  }
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? FACING_RIGHT : FACING_LEFT;
  }
  return y > 0 ? FACING_DOWN : FACING_UP;
}
