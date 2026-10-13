/**
 * Room templates built in code, for tests.
 *
 * Not content and not shipped: nothing in the game imports this. It exists so a
 * collision test can state the exact shape it is about -- a corner, a one-tile
 * gap, a pillar -- next to the assertion, instead of referring to a glyph grid
 * in a data file that someone will later re-tune for the way it plays.
 *
 * The real templates in `data/rooms/*.json` are exercised too, in
 * `tileGrid.test.ts`, so both paths are covered.
 */

import type { RoomTemplate } from '@/content/schema/rooms.ts';

/**
 * Wraps rows of glyphs in the fields a `RoomTemplate` carries, taking the
 * width from the first row so a test only has to write the shape.
 */
export function roomFromRows(rows: readonly string[]): RoomTemplate {
  return {
    id: 'test-room',
    displayName: 'Test Room',
    biomeId: 'test-biome',
    kind: 'standard',
    width: rows[0]?.length ?? 0,
    height: rows.length,
    tiles: [...rows],
  };
}

/** An empty box: solid border, open inside. 8x6 tiles. */
export const OPEN_BOX: readonly string[] = [
  '########',
  '#......#',
  '#......#',
  '#......#',
  '#......#',
  '########',
];

/**
 * An inside corner at tile (4,3), reachable from above and from the left. The
 * shape that catches a collision routine which resolves only one axis.
 */
export const INSIDE_CORNER: readonly string[] = [
  '########',
  '#......#',
  '#......#',
  '#...####',
  '#...####',
  '########',
];

/** A free-standing pillar, so a box can be pushed at it from any side. */
export const PILLAR: readonly string[] = [
  '########',
  '#......#',
  '#..##..#',
  '#..##..#',
  '#......#',
  '########',
];

/**
 * A large open box, 24x16 tiles -- 384x256 world units.
 *
 * For tests about something other than walls. Big enough that a shot with a
 * few hundred units of range never reaches the edge, so a projectile test can
 * be about range or cooldowns without the room quietly ending it.
 */
export const BIG_EMPTY_ROOM: RoomTemplate = roomFromRows([
  '########################',
  ...Array.from({ length: 14 }, () => '#......................#'),
  '########################',
]);

/**
 * A one-tile-wide gap in a wall. The player's box is 10 units wide against a
 * 16-unit tile (`entities/tuning.ts`), so this has to be passable -- a gap the
 * player can see through but not walk through reads as the game being broken.
 */
export const ONE_TILE_GAP: readonly string[] = [
  '########',
  '#......#',
  '###.####',
  '#......#',
  '#......#',
  '########',
];
