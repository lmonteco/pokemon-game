import { describe, expect, it } from 'vitest';
import { FACINGS, FACING_DOWN, FACING_LEFT, FACING_RIGHT, FACING_UP } from '@/entities/playerInput';
import { PLAYER_FRAME_COUNT } from '@/entities/player';
import {
  BODY_DOWN,
  BODY_RIGHT,
  BODY_ROWS,
  BODY_UP,
  FEET_POSES,
  PLAYER_ART_MAPS,
  PLAYER_FACING_COUNT,
  PLAYER_POSE_COUNT,
  PLAYER_OUTLINE_SHADE,
  PLAYER_SPRITE_SIZE,
  TRANSPARENT_GLYPH,
  playerFrame,
} from './playerArt';
import { SHADES, SHADE_LIGHTEST } from './palette';

/**
 * The placeholder sprite, checked as data.
 *
 * The scene cannot be tested here -- the suite runs in Node with no canvas --
 * but the glyph maps are the part that can be wrong in a way nobody notices:
 * a row one character short shifts every pixel after it, and a silhouette with
 * a gap in its outline only looks wrong against one particular background.
 *
 * The outline rule is GDD 8.2, the one art rule the document calls
 * non-negotiable: a 1px outline in the lightest shade, all the way round, so
 * the sprite reads against a wall, against a floor and against a projectile.
 * On a four-shade screen it is the only thing keeping the creature from
 * dissolving into the tiles behind it.
 */

/** The composite 16x16 glyph grid for a facing and pose, as drawn. */
function composite(body: readonly string[], feet: readonly string[], mirror: boolean): string[] {
  const rows: string[] = [];

  for (let y = 0; y < PLAYER_SPRITE_SIZE; y += 1) {
    const source = y < BODY_ROWS ? body[y] : feet[y - BODY_ROWS];
    const row = source ?? '';
    const padded = row.padEnd(PLAYER_SPRITE_SIZE, TRANSPARENT_GLYPH);

    rows.push(mirror ? [...padded].reverse().join('') : padded);
  }

  return rows;
}

/** Every drawn cell of the sheet, the way `createPlayerArt` assembles them. */
const CELLS = [
  { facing: FACING_DOWN, body: BODY_DOWN, mirror: false },
  { facing: FACING_UP, body: BODY_UP, mirror: false },
  { facing: FACING_LEFT, body: BODY_RIGHT, mirror: true },
  { facing: FACING_RIGHT, body: BODY_RIGHT, mirror: false },
].flatMap(({ facing, body, mirror }) =>
  FEET_POSES.map((feet, pose) => ({
    facing,
    pose,
    rows: composite(body, feet, mirror),
  })),
);

describe('the player art maps', () => {
  it('are all exactly as wide as the sprite', () => {
    // A short row would silently shift every pixel after it in that row, and
    // the sprite would look subtly lopsided with no obvious cause.
    const wrong: string[] = [];

    PLAYER_ART_MAPS.forEach((map, mapIndex) => {
      map.forEach((row, y) => {
        if (row.length !== PLAYER_SPRITE_SIZE) {
          wrong.push(`map ${mapIndex} row ${y}: ${row.length} chars`);
        }
      });
    });

    expect(wrong).toEqual([]);
  });

  it('add up to the sprite height', () => {
    // Body rows plus feet rows must be exactly 16, or the feet are drawn
    // overlapping the body or hanging off the bottom of the cell.
    const feetRows = FEET_POSES[0]?.length ?? 0;

    expect(BODY_ROWS + feetRows).toBe(PLAYER_SPRITE_SIZE);
  });

  it('give every pose the same number of feet rows', () => {
    const heights = new Set(FEET_POSES.map((pose) => pose.length));

    expect(heights.size).toBe(1);
  });

  it('use only glyphs the painter knows', () => {
    // An unknown glyph throws at texture-creation time, which is during boot.
    // Catching it here means a typo in the art is a failing test rather than
    // a blank screen.
    const known = new Set(['O', 'L', 'M', 'D', TRANSPARENT_GLYPH]);
    const unknown = new Set<string>();

    PLAYER_ART_MAPS.forEach((map) => {
      map.forEach((row) => {
        [...row].forEach((glyph) => {
          if (!known.has(glyph)) {
            unknown.add(glyph);
          }
        });
      });
    });

    expect([...unknown]).toEqual([]);
  });

  it('draw something in every pose of every facing', () => {
    // A cell that came out empty would be an invisible player on one facing.
    const empty: string[] = [];

    CELLS.forEach(({ facing, pose, rows }) => {
      const painted = rows
        .join('')
        .split('')
        .filter((glyph) => glyph !== TRANSPARENT_GLYPH);

      if (painted.length === 0) {
        empty.push(`facing ${facing} pose ${pose}`);
      }
    });

    expect(empty).toEqual([]);
  });

  it('wraps every silhouette in a 1px outline (GDD 8.2)', () => {
    // The rule, enforced. Any painted pixel touching transparency -- or the
    // edge of the cell -- has to be the outline glyph. A single gap is a place
    // the creature bleeds into the background on some palette.
    const breaks: string[] = [];

    CELLS.forEach(({ facing, pose, rows }) => {
      for (let y = 0; y < rows.length; y += 1) {
        const row = rows[y] ?? '';

        for (let x = 0; x < row.length; x += 1) {
          const glyph = row[x];

          if (glyph === undefined || glyph === TRANSPARENT_GLYPH) {
            continue;
          }

          // Four-neighbour: a diagonal touch is not a hole a background shows
          // through, and demanding it would make a 16x16 sprite undrawable.
          const neighbours = [rows[y - 1]?.[x], rows[y + 1]?.[x], row[x - 1], row[x + 1]];
          const onSilhouette = neighbours.some(
            (neighbour) => neighbour === undefined || neighbour === TRANSPARENT_GLYPH,
          );

          if (onSilhouette && glyph !== 'O') {
            breaks.push(`facing ${facing} pose ${pose} at (${x},${y}): '${glyph}'`);
          }
        }
      }
    });

    expect(breaks).toEqual([]);
  });

  it('outlines in the lightest shade', () => {
    // GDD 8.2 names the shade, not just the existence of an outline. The
    // lightest is the one that reads against both the dark floor and the
    // mid-tone walls.
    expect(PLAYER_OUTLINE_SHADE).toBe(SHADE_LIGHTEST);
    expect(SHADE_LIGHTEST).toBe(Math.max(...SHADES));
  });
});

describe('playerFrame', () => {
  it('gives every facing and pose a distinct frame', () => {
    // The frame index is how the scene addresses a cell. A collision here
    // would draw the wrong pose and look like an animation bug.
    const frames = new Set<number>();

    FACINGS.forEach((facing) => {
      for (let pose = 0; pose < PLAYER_POSE_COUNT; pose += 1) {
        frames.add(playerFrame(facing, pose));
      }
    });

    expect(frames.size).toBe(PLAYER_FACING_COUNT * PLAYER_POSE_COUNT);
  });

  it('stays inside the sheet', () => {
    const cells = PLAYER_FACING_COUNT * PLAYER_POSE_COUNT;
    const outOfRange: string[] = [];

    FACINGS.forEach((facing) => {
      for (let pose = 0; pose < PLAYER_POSE_COUNT; pose += 1) {
        const frame = playerFrame(facing, pose);

        if (frame < 0 || frame >= cells) {
          outOfRange.push(`${facing}/${pose} -> ${frame}`);
        }
      }
    });

    expect(outOfRange).toEqual([]);
  });

  it('agrees with the controller about how many poses there are', () => {
    // `player.ts` picks a pose and `playerArt.ts` draws it. If these two
    // numbers drift apart the controller asks for a frame that is not there.
    expect(PLAYER_FRAME_COUNT).toBe(PLAYER_POSE_COUNT);
  });

  it('has a row for each of the four facings', () => {
    expect(PLAYER_FACING_COUNT).toBe(FACINGS.length);
    expect([FACING_DOWN, FACING_UP, FACING_LEFT, FACING_RIGHT]).toEqual([0, 1, 2, 3]);
  });
});
