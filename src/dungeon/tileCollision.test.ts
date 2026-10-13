import { describe, expect, it } from 'vitest';
import { TILE_PX } from '@/core/constants';
import { Rng } from '@/core/rng';
import { PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH } from '@/entities/tuning';
import { COLLISION_SKIN, isBoxBlocked, moveBox, type BoxMoveResult } from './tileCollision';
import { tileGridFromRoom, type TileGrid } from './tileGrid';
import { INSIDE_CORNER, ONE_TILE_GAP, OPEN_BOX, PILLAR, roomFromRows } from './testRooms';

/**
 * M1-1's acceptance criterion is "no wall clipping at any speed, including into
 * corners". "At any speed" is the part that cannot be checked by playing: the
 * bug is a tunnel through a wall at a velocity nobody happened to try. So the
 * speeds are swept, up to absurd ones, and the invariant is asserted rather
 * than the position.
 *
 * The invariant, stated once: **after any move, the box does not overlap a
 * solid tile.** Everything else here -- sliding, not drifting, the corner --
 * is about it feeling right. That one is about it being correct.
 */

const HALF_W = PLAYER_HALF_WIDTH;
const HALF_H = PLAYER_HALF_HEIGHT;

const result = (): BoxMoveResult => ({ x: 0, y: 0, hitX: false, hitY: false });

const gridOf = (rows: readonly string[]): TileGrid => tileGridFromRoom(roomFromRows(rows));

/** The centre of a tile, in world units. */
const tileCentre = (tileX: number, tileY: number): { x: number; y: number } => ({
  x: tileX * TILE_PX + TILE_PX / 2,
  y: tileY * TILE_PX + TILE_PX / 2,
});

/** Speeds to sweep, in world units per tick. The last few are nonsense on purpose. */
const SPEEDS = [
  0.01, 0.1, 0.5, 1, 1.5, 2, 3, 4, 7, 8, 11, 15, 16, 17, 23, 32, 48, 64, 100, 257, 1024, 100_000,
];

describe('isBoxBlocked', () => {
  it('is false in open floor and true overlapping a wall', () => {
    const grid = gridOf(OPEN_BOX);
    const open = tileCentre(3, 2);

    expect(isBoxBlocked(grid, open.x, open.y, HALF_W, HALF_H)).toBe(false);
    expect(isBoxBlocked(grid, 0, 0, HALF_W, HALF_H)).toBe(true);
  });

  it('does not count a tile the box only touches the edge of', () => {
    // A box resting exactly on a tile boundary is in the tile it is inside,
    // not also in the one it abuts. Counting both is what makes a character
    // "stuck in a wall" they are merely standing next to.
    const grid = gridOf(OPEN_BOX);

    // Left wall occupies tile 0, so x 0..15. A box whose left edge sits at 16
    // is clear of it.
    expect(isBoxBlocked(grid, TILE_PX + HALF_W, 40, HALF_W, HALF_H)).toBe(false);
    expect(isBoxBlocked(grid, TILE_PX + HALF_W - 1, 40, HALF_W, HALF_H)).toBe(true);
  });
});

describe('moveBox', () => {
  it('moves freely when nothing is in the way', () => {
    const grid = gridOf(OPEN_BOX);
    const from = tileCentre(3, 2);
    const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 2, -1, result());

    expect(out).toEqual({ x: from.x + 2, y: from.y - 1, hitX: false, hitY: false });
  });

  it('never ends up inside a wall, at any speed, in any direction', () => {
    // The criterion, swept. Eight directions x 22 speeds x every open tile of
    // four room shapes: a few thousand moves, none of which may land the box
    // in a solid tile.
    const offenders: string[] = [];

    [OPEN_BOX, INSIDE_CORNER, PILLAR, ONE_TILE_GAP].forEach((rows, roomIndex) => {
      const grid = gridOf(rows);

      for (let tileY = 0; tileY < grid.height; tileY += 1) {
        for (let tileX = 0; tileX < grid.width; tileX += 1) {
          const start = tileCentre(tileX, tileY);

          if (isBoxBlocked(grid, start.x, start.y, HALF_W, HALF_H)) {
            continue;
          }

          SPEEDS.forEach((speed) => {
            [-1, 0, 1].forEach((signX) => {
              [-1, 0, 1].forEach((signY) => {
                if (signX === 0 && signY === 0) {
                  return;
                }

                const out = moveBox(
                  grid,
                  start.x,
                  start.y,
                  HALF_W,
                  HALF_H,
                  signX * speed,
                  signY * speed,
                  result(),
                );

                if (isBoxBlocked(grid, out.x, out.y, HALF_W, HALF_H)) {
                  offenders.push(
                    `room ${roomIndex} tile (${tileX},${tileY}) ` +
                      `d(${signX * speed},${signY * speed}) -> (${out.x},${out.y})`,
                  );
                }
              });
            });
          });
        }
      }
    });

    expect(offenders).toEqual([]);
  });

  it('cannot tunnel through a wall however fast the box is going', () => {
    // The specific failure a non-swept collision has: at 100,000 units a tick
    // the box's start and end are both in open floor on opposite sides of the
    // wall, so a test that only checked the landing tile would pass.
    const grid = gridOf(OPEN_BOX);
    const from = tileCentre(1, 2);
    const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 100_000, 0, result());

    expect(out.hitX).toBe(true);
    // Stopped against the right wall, which starts at tile 7.
    expect(out.x).toBeCloseTo(7 * TILE_PX - HALF_W - COLLISION_SKIN, 10);
  });

  it('slides along a wall instead of stopping dead on it', () => {
    // Pushing diagonally into a wall keeps the component that is still free.
    // Without this, running along a wall stops the player completely and the
    // room feels like it is made of glue.
    const grid = gridOf(OPEN_BOX);
    // Against the left wall, pushing down-left.
    const from = { x: TILE_PX + HALF_W + COLLISION_SKIN, y: tileCentre(1, 2).y };
    const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, -4, 4, result());

    expect(out.hitX).toBe(true);
    expect(out.hitY).toBe(false);
    // The blocked axis holds, the free one moves the full distance.
    expect(out.x).toBeCloseTo(from.x, 10);
    expect(out.y).toBe(from.y + 4);
  });

  it('slides along each face of a pillar', () => {
    const grid = gridOf(PILLAR);
    const notSliding: string[] = [];

    // Approach each face head-on with a diagonal, and the tangential component
    // must survive. This is the test that would catch an axis-resolution order
    // bug that only showed on one side.
    //
    // 8 units into the face and 3 along it: the gap from a tile centre to the
    // pillar is 3 or 4 units depending on the face, so 8 certainly reaches it
    // while 3 certainly does not. A delta that merely landed on the tile
    // boundary would rest against the wall without being blocked by it, and
    // the test would be asserting the wrong thing for the right reason.
    const cases = [
      { from: tileCentre(2, 2), dx: 8, dy: 3, axis: 'x' },
      { from: tileCentre(5, 2), dx: -8, dy: 3, axis: 'x' },
      { from: tileCentre(3, 1), dx: 3, dy: 8, axis: 'y' },
      { from: tileCentre(3, 4), dx: 3, dy: -8, axis: 'y' },
    ];

    cases.forEach(({ from, dx, dy, axis }, i) => {
      const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, dx, dy, result());

      if (axis === 'x') {
        if (!out.hitX) notSliding.push(`case ${i}: expected to be blocked on x`);
        if (out.y !== from.y + dy) notSliding.push(`case ${i}: y did not slide`);
      } else {
        if (!out.hitY) notSliding.push(`case ${i}: expected to be blocked on y`);
        if (out.x !== from.x + dx) notSliding.push(`case ${i}: x did not slide`);
      }
    });

    expect(notSliding).toEqual([]);
  });

  it('wedges into a corner on both axes and rests clear of both', () => {
    // The corner case the acceptance criteria name. Driven hard into the
    // bottom-right corner of the room, where the box's own span already
    // touches both the wall to its right and the wall below it, so neither
    // axis can be saved by sliding.
    const grid = gridOf(OPEN_BOX);
    const from = tileCentre(6, 4);
    const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 32, 32, result());

    expect(out.hitX).toBe(true);
    expect(out.hitY).toBe(true);
    expect(isBoxBlocked(grid, out.x, out.y, HALF_W, HALF_H)).toBe(false);
  });

  it('rounds an inside corner instead of catching on it', () => {
    // An inside corner is the shape that *should* slide, and it is worth
    // pinning the difference. Approaching the corner of the block diagonally,
    // only the axis actually obstructed is stopped -- so a player running into
    // a corner keeps moving along it rather than sticking to the one pixel
    // where two walls meet.
    const grid = gridOf(INSIDE_CORNER);
    const from = tileCentre(3, 2);
    const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 32, 32, result());

    // The horizontal run is clear at this height; only the drop is blocked.
    expect(out.hitX).toBe(false);
    expect(out.hitY).toBe(true);
    expect(out.x).toBe(from.x + 32);
    expect(isBoxBlocked(grid, out.x, out.y, HALF_W, HALF_H)).toBe(false);
  });

  it('does not drift while held against a wall', () => {
    // Held into a wall for a thousand ticks, the box must sit at exactly the
    // same coordinate as after the first one. A collision that resolved to
    // "old position plus a push-out" would creep, and after a minute of
    // leaning on a wall the player would be inside it.
    const grid = gridOf(OPEN_BOX);
    const start = tileCentre(3, 2);
    const out = result();

    let x = start.x;
    let y = start.y;
    let settled = Number.NaN;

    for (let tick = 0; tick < 1000; tick += 1) {
      moveBox(grid, x, y, HALF_W, HALF_H, -6, 0, out);
      x = out.x;
      y = out.y;

      // Sampled once the box has certainly reached the wall -- the run starts
      // mid-room, so the first few ticks are still travel. Everything after
      // this point must be the identical coordinate, not merely a near one.
      if (tick === 100) {
        settled = x;
      }
    }

    expect(Number.isNaN(settled)).toBe(false);
    expect(x).toBe(settled);
    // And it is resting against the left wall, which ends at x = 16.
    expect(x).toBeCloseTo(TILE_PX + HALF_W + COLLISION_SKIN, 10);
  });

  it('fits through a one-tile gap', () => {
    // The player's box is deliberately narrower than a tile so a visible gap
    // is a passable gap. If this fails the room reads as broken rather than
    // as hard.
    const grid = gridOf(ONE_TILE_GAP);
    const gap = tileCentre(3, 2);
    const out = result();

    let x = gap.x;
    let y = tileCentre(3, 1).y;

    // Walk down through the gap, a couple of units a tick.
    for (let tick = 0; tick < 40; tick += 1) {
      moveBox(grid, x, y, HALF_W, HALF_H, 0, 2, out);
      x = out.x;
      y = out.y;
    }

    expect(y).toBeGreaterThan(tileCentre(3, 3).y);
    expect(isBoxBlocked(grid, x, y, HALF_W, HALF_H)).toBe(false);
  });

  it('survives a long random walk without ever entering a wall', () => {
    // A seeded stress run: the shapes above are the cases someone thought of,
    // and this is the one for the cases nobody did. Seeded, so a failure is
    // reproducible rather than a flake.
    const grid = gridOf(PILLAR);
    const rng = Rng.fromSeed('m1-1-collision-stress', 'dungeon');
    const out = result();
    const offenders: string[] = [];

    let position = tileCentre(1, 1);
    let x = position.x;
    let y = position.y;

    for (let step = 0; step < 20_000; step += 1) {
      // Occasionally absurd, so tunnelling gets its chance.
      const speed = rng.chance(0.05) ? rng.nextFloatBetween(50, 5000) : rng.nextFloatBetween(0, 8);
      const angle = rng.nextFloatBetween(0, Math.PI * 2);

      moveBox(grid, x, y, HALF_W, HALF_H, Math.cos(angle) * speed, Math.sin(angle) * speed, out);
      x = out.x;
      y = out.y;

      if (isBoxBlocked(grid, x, y, HALF_W, HALF_H)) {
        offenders.push(`step ${step} at (${x}, ${y})`);
        break;
      }
    }

    expect(offenders).toEqual([]);
    // And it actually went somewhere, rather than being stuck at the spawn
    // and passing trivially.
    position = tileCentre(1, 1);
    expect(Math.abs(x - position.x) + Math.abs(y - position.y)).toBeGreaterThan(0);
  });

  it('gives the same answer every time for the same move', () => {
    // Collision feeds the position, the position feeds the world hash, and
    // GDD 9.3's replays depend on it being bit-identical rather than close.
    const grid = gridOf(INSIDE_CORNER);
    const from = tileCentre(3, 2);
    const first = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 13.7, 9.3, result());
    const second = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 13.7, 9.3, result());

    expect(second).toEqual(first);
  });

  it('writes into the callerâ€™s struct and returns it', () => {
    const grid = gridOf(OPEN_BOX);
    const from = tileCentre(3, 2);
    const out = result();

    expect(moveBox(grid, from.x, from.y, HALF_W, HALF_H, 1, 1, out)).toBe(out);
  });

  it('reports no hit when the move was not blocked', () => {
    // `hitX`/`hitY` drive zeroing the velocity in `entities/player.ts`, so a
    // false positive would stop the player for no visible reason.
    const grid = gridOf(OPEN_BOX);
    const from = tileCentre(3, 2);
    const out = moveBox(grid, from.x, from.y, HALF_W, HALF_H, 0, 0, result());

    expect(out.hitX).toBe(false);
    expect(out.hitY).toBe(false);
    expect(out.x).toBe(from.x);
    expect(out.y).toBe(from.y);
  });
});
