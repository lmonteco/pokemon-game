/**
 * Placeholder room tiles: floor, wall, hazard. Drawn in code, four shades.
 *
 * Enough to tell where the walls are and to see that you are moving, and no
 * more. GDD 8.1 budgets about 40 tiles per biome and those are a later task
 * (GAM-10); three tiles is what M1-1 needs to answer its own question, which
 * is whether running around a room feels good.
 *
 * Original by construction, like every other asset here (GDD 11.2).
 *
 * The floor carries a speck pattern rather than being flat, and that is not
 * decoration: on a featureless floor there is nothing for the eye to track, so
 * the player cannot tell how fast they are moving and movement feels dead
 * however well it is tuned. The specks are the reference frame.
 */

import type Phaser from 'phaser';
import { TILE_PX } from '@/core/constants';
import {
  SHADE_DARK,
  SHADE_DARKEST,
  SHADE_LIGHT,
  cssColor,
  shadeSource,
  type ShadeIndex,
} from './palette';
import { SOLID_GLYPHS } from '@/dungeon/tileGrid';
import type { RoomTemplate } from '@/content/schema/rooms.ts';

export const ROOM_TILES_KEY = 'room-tiles';

/**
 * The shade each part of the room is drawn in.
 *
 * The floor is the **darkest** shade, and that is the load-bearing choice
 * rather than a taste one. The player's body is `SHADE_DARK`
 * (`playerArt.ts`), so a floor in that same shade leaves the creature looking
 * like a hollow outline sliding over the ground -- there is no third tone on
 * a four-shade screen to separate them. Floor darkest, body one step up,
 * outline lightest: three levels, and the creature reads as solid.
 *
 * The speck is the body's shade, which is fine at one or two pixels: it gives
 * the eye something to track without competing with the silhouette.
 */
export const ROOM_SHADES = {
  floor: SHADE_DARKEST,
  floorSpeck: SHADE_DARK,
  wall: SHADE_LIGHT,
  wallSeam: SHADE_DARKEST,
  hazard: SHADE_DARK,
} as const;

/** Tile indices into the tileset this module builds. */
export const ROOM_TILE_FLOOR = 0;
export const ROOM_TILE_FLOOR_SPECK = 1;
export const ROOM_TILE_WALL = 2;
export const ROOM_TILE_HAZARD = 3;

export const ROOM_TILE_COUNT = 4;

/** Glyphs drawn as a hazard rather than as plain floor (GDD 5.3). */
export const HAZARD_GLYPHS: readonly string[] = ['~', '^'];

/**
 * The tile to draw for a glyph.
 *
 * Walls come from `SOLID_GLYPHS` rather than from a second list here, so the
 * tile that looks solid and the tile that *is* solid cannot disagree -- a
 * wall you can walk through, or a floor you cannot, is the worst class of bug
 * in a game about moving.
 *
 * `speck` is passed in rather than derived from a random stream: the pattern
 * has to be the same every frame or the floor would crawl, and the same on
 * every run or a replay would look different while playing identically.
 */
export function roomTileForGlyph(glyph: string | undefined, speck: boolean): number {
  if (glyph === undefined || SOLID_GLYPHS.includes(glyph)) {
    return ROOM_TILE_WALL;
  }
  if (HAZARD_GLYPHS.includes(glyph)) {
    return ROOM_TILE_HAZARD;
  }
  return speck ? ROOM_TILE_FLOOR_SPECK : ROOM_TILE_FLOOR;
}

/**
 * Whether this tile gets a speck, from its coordinates alone.
 *
 * A hash of the position, not a counter and not a random number: it is stable
 * across frames and across runs, and it does not line the specks up into
 * diagonal stripes the way `(x + y) % n` would.
 */
export function hasSpeck(tileX: number, tileY: number): boolean {
  const mixed = (tileX * 73_856_093) ^ (tileY * 19_349_663);

  return (mixed & 7) === 0;
}

/** The tilemap data for a room template, ready for `make.tilemap`. */
export function roomTilemapData(room: RoomTemplate): number[][] {
  const rows: number[][] = [];

  for (let y = 0; y < room.height; y += 1) {
    const row: number[] = [];
    const glyphs = room.tiles[y] ?? '';

    for (let x = 0; x < room.width; x += 1) {
      row.push(roomTileForGlyph(glyphs[x], hasSpeck(x, y)));
    }

    rows.push(row);
  }

  return rows;
}

function fill(
  context: CanvasRenderingContext2D,
  shade: ShadeIndex,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.fillStyle = cssColor(shadeSource(shade));
  context.fillRect(x, y, width, height);
}

/**
 * Builds the tileset: `ROOM_TILE_COUNT` tiles in a row, each 16x16.
 */
export function createRoomTiles(scene: Phaser.Scene): void {
  if (scene.textures.exists(ROOM_TILES_KEY)) {
    return;
  }

  const texture = scene.textures.createCanvas(ROOM_TILES_KEY, TILE_PX * ROOM_TILE_COUNT, TILE_PX);

  if (!texture) {
    throw new Error(`could not create the '${ROOM_TILES_KEY}' texture`);
  }

  const context = texture.getContext();
  const originOf = (tile: number): number => tile * TILE_PX;

  // Floor: flat, and the darkest thing on screen so the player's light
  // outline reads against it.
  fill(context, ROOM_SHADES.floor, originOf(ROOM_TILE_FLOOR), 0, TILE_PX, TILE_PX);

  // Floor with a speck. Two pixels, off centre, so the pattern does not read
  // as a grid.
  fill(context, ROOM_SHADES.floor, originOf(ROOM_TILE_FLOOR_SPECK), 0, TILE_PX, TILE_PX);
  fill(context, ROOM_SHADES.floorSpeck, originOf(ROOM_TILE_FLOOR_SPECK) + 5, 6, 2, 1);
  fill(context, ROOM_SHADES.floorSpeck, originOf(ROOM_TILE_FLOOR_SPECK) + 11, 12, 1, 1);

  // Wall: a light block with a dark seam along the top and left, which is
  // enough to read as a raised edge without a real lighting model.
  const wallX = originOf(ROOM_TILE_WALL);

  fill(context, ROOM_SHADES.wall, wallX, 0, TILE_PX, TILE_PX);
  fill(context, ROOM_SHADES.wallSeam, wallX, 0, TILE_PX, 1);
  fill(context, ROOM_SHADES.wallSeam, wallX, 0, 1, TILE_PX);
  // A brick seam across the middle, so a long wall is not one flat slab.
  fill(context, ROOM_SHADES.wallSeam, wallX, TILE_PX / 2, TILE_PX, 1);

  // Hazard: walkable for now (GDD 5.3 gives it behaviour in a later task),
  // drawn with a horizontal band so it is obviously not plain floor.
  const hazardX = originOf(ROOM_TILE_HAZARD);

  fill(context, ROOM_SHADES.floor, hazardX, 0, TILE_PX, TILE_PX);
  fill(context, ROOM_SHADES.hazard, hazardX + 2, 4, 12, 1);
  fill(context, ROOM_SHADES.hazard, hazardX + 4, 9, 10, 1);

  texture.refresh();
}
