/**
 * Moving an axis-aligned box through a tile grid, with sliding.
 *
 * The whole of the game's wall collision is this file. Three properties it has
 * to hold, in the order they matter:
 *
 * 1. **It cannot tunnel.** Each axis is *swept*: every tile column the box
 *    crosses is tested, not just the one it would land in. A box moving a
 *    thousand units in one step stops at the first wall in its path, which
 *    makes the guarantee independent of speed and of the tick rate. A
 *    substepping scheme would instead be correct only below some speed, and
 *    the speed where it broke would be a tuning value in another file.
 * 2. **It slides.** The axes resolve one after the other, X then Y, each with
 *    the other axis held still. Pushing diagonally into a wall therefore keeps
 *    the component that is still free, which is what makes running along a
 *    wall feel like running along a wall rather than like stopping.
 * 3. **It does not drift.** A blocked move resolves to an *absolute* position
 *    derived from the tile edge, never to the old position plus a push-out.
 *    Hold a direction into a wall for a minute and the box sits at exactly the
 *    same coordinate as after the first tick.
 *
 * The box is assumed not to be overlapping a solid tile when it arrives. Every
 * exit from here keeps that true, so the only way to break it is to teleport
 * something into a wall; `isBoxBlocked` is here to check that at a spawn.
 */

import { TILE_PX } from '@/core/constants';
import { tileOfPixel, type TileGrid } from './tileGrid';

/**
 * The gap left between a stopped box and the wall it stopped against.
 *
 * A power of two, so it is exact in binary floating point: the resolved
 * coordinate is then a number that can be reproduced bit for bit, which the
 * determinism contract in `core/world.ts` needs. A plain epsilon such as 0.001
 * would not be.
 *
 * It has to be non-zero. Resting with the edge exactly on the tile boundary
 * leaves the box ambiguously in both tiles, and the next tick's sweep would
 * have to decide which -- the classic way a character ends up stuck in a wall.
 */
export const COLLISION_SKIN = 1 / 1024;

/** Where a box ended up, and which axes were stopped on the way. */
export interface BoxMoveResult {
  x: number;
  y: number;
  /** True when a wall, not the requested distance, decided the axis. */
  hitX: boolean;
  hitY: boolean;
}

/** Whether a box at this position overlaps any solid tile. */
export function isBoxBlocked(
  grid: TileGrid,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const fromX = tileOfPixel(x - halfWidth);
  const toX = tileOfPixel(x + halfWidth - COLLISION_SKIN);
  const fromY = tileOfPixel(y - halfHeight);
  const toY = tileOfPixel(y + halfHeight - COLLISION_SKIN);

  for (let tileY = fromY; tileY <= toY; tileY += 1) {
    for (let tileX = fromX; tileX <= toX; tileX += 1) {
      if (grid.isSolid(tileX, tileY)) {
        return true;
      }
    }
  }
  return false;
}

/** Whether any tile in a column, over the box's row span, is solid. */
function columnBlocked(grid: TileGrid, tileX: number, fromY: number, toY: number): boolean {
  for (let tileY = fromY; tileY <= toY; tileY += 1) {
    if (grid.isSolid(tileX, tileY)) {
      return true;
    }
  }
  return false;
}

/** Whether any tile in a row, over the box's column span, is solid. */
function rowBlocked(grid: TileGrid, tileY: number, fromX: number, toX: number): boolean {
  for (let tileX = fromX; tileX <= toX; tileX += 1) {
    if (grid.isSolid(tileX, tileY)) {
      return true;
    }
  }
  return false;
}

/**
 * Sweeps the box horizontally. Returns the resolved centre x, negated and
 * flagged by `hitX` through the caller.
 *
 * The scan is bounded even for an absurd `dx`, because everything outside the
 * grid is solid (`tileGrid.ts`): the furthest the loop can run is the width of
 * the room plus one.
 */
function sweepX(
  grid: TileGrid,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  dx: number,
  out: BoxMoveResult,
): void {
  out.x = x + dx;
  out.hitX = false;

  if (dx === 0) {
    return;
  }

  // The rows the box spans. `- COLLISION_SKIN` on the far edge so that a box
  // whose bottom lands exactly on a tile boundary spans the row above it only,
  // rather than claiming a row it merely touches.
  const fromRow = tileOfPixel(y - halfHeight);
  const toRow = tileOfPixel(y + halfHeight - COLLISION_SKIN);

  if (dx > 0) {
    const fromColumn = tileOfPixel(x + halfWidth - COLLISION_SKIN);
    const toColumn = tileOfPixel(out.x + halfWidth - COLLISION_SKIN);

    for (let column = fromColumn + 1; column <= toColumn; column += 1) {
      if (columnBlocked(grid, column, fromRow, toRow)) {
        out.x = column * TILE_PX - halfWidth - COLLISION_SKIN;
        out.hitX = true;
        return;
      }
    }
    return;
  }

  const fromColumn = tileOfPixel(x - halfWidth);
  const toColumn = tileOfPixel(out.x - halfWidth);

  for (let column = fromColumn - 1; column >= toColumn; column -= 1) {
    if (columnBlocked(grid, column, fromRow, toRow)) {
      out.x = (column + 1) * TILE_PX + halfWidth + COLLISION_SKIN;
      out.hitX = true;
      return;
    }
  }
}

/** Sweeps the box vertically. The mirror of `sweepX`. */
function sweepY(
  grid: TileGrid,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  dy: number,
  out: BoxMoveResult,
): void {
  out.y = y + dy;
  out.hitY = false;

  if (dy === 0) {
    return;
  }

  const fromColumn = tileOfPixel(x - halfWidth);
  const toColumn = tileOfPixel(x + halfWidth - COLLISION_SKIN);

  if (dy > 0) {
    const fromRow = tileOfPixel(y + halfHeight - COLLISION_SKIN);
    const toRow = tileOfPixel(out.y + halfHeight - COLLISION_SKIN);

    for (let row = fromRow + 1; row <= toRow; row += 1) {
      if (rowBlocked(grid, row, fromColumn, toColumn)) {
        out.y = row * TILE_PX - halfHeight - COLLISION_SKIN;
        out.hitY = true;
        return;
      }
    }
    return;
  }

  const fromRow = tileOfPixel(y - halfHeight);
  const toRow = tileOfPixel(out.y - halfHeight);

  for (let row = fromRow - 1; row >= toRow; row -= 1) {
    if (rowBlocked(grid, row, fromColumn, toColumn)) {
      out.y = (row + 1) * TILE_PX + halfHeight + COLLISION_SKIN;
      out.hitY = true;
      return;
    }
  }
}

/**
 * Moves a box by `(dx, dy)` as far as the walls allow, and writes the result
 * into `out`.
 *
 * Writes into a caller-owned struct rather than returning a new object: this
 * runs once per moving entity per tick, and the 10,000-step headless runs in
 * GDD 9.3 should allocate nothing.
 *
 * X resolves before Y. The order only shows in one case -- squeezing into a
 * corner where both axes are blocked -- and there both orders give the same
 * answer, so the bias is invisible and, more importantly, fixed.
 */
export function moveBox(
  grid: TileGrid,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  dx: number,
  dy: number,
  out: BoxMoveResult,
): BoxMoveResult {
  sweepX(grid, x, y, halfWidth, halfHeight, dx, out);
  // The vertical sweep uses the *resolved* x, so a box that has just stopped
  // against a wall slides along it instead of testing the column it never
  // reached. It writes only `y` and `hitY`, so the horizontal answer stands.
  sweepY(grid, out.x, y, halfWidth, halfHeight, dy, out);
  return out;
}
