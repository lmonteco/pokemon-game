/**
 * A room template's tiles, turned into something collision can ask questions of
 * (GDD 5.1, 9.2).
 *
 * The template in `data/rooms/*.json` is authored for a human: one string per
 * row, one glyph per tile. That is the right shape to hand-edit and the wrong
 * shape to query 60 times a second, so this builds a flat byte grid once.
 *
 * Which glyphs are solid is engine vocabulary, not content -- the glyph legend
 * lives in `content/schema/rooms.ts` and the validator already rejects anything
 * not on it, so a grid built here cannot contain a surprise.
 */

import { TILE_PX } from '@/core/constants';
import type { RoomTemplate } from '@/content/schema/rooms.ts';

/**
 * Glyphs that stop movement.
 *
 * Only `#`. Water and lava are hazards rather than walls (GDD 5.3) -- they
 * slow or hurt you and belong to a later task -- and a destructible rock is
 * solid only until it is broken, which needs state this grid does not hold.
 * Both are walkable here, which is the honest placeholder: it is better to run
 * over a hazard that does nothing yet than to find out in M1-5 that the
 * collision layer quietly became the hazard layer.
 */
export const SOLID_GLYPHS: readonly string[] = ['#'];

/** The glyph that marks where the player enters (`content/schema/rooms.ts`). */
export const PLAYER_START_GLYPH = 'p';

export interface TileGrid {
  /** Size in tiles. */
  readonly width: number;
  readonly height: number;
  /** Size in world units. */
  readonly widthPx: number;
  readonly heightPx: number;
  /**
   * Whether the tile at these tile coordinates blocks movement. **Anything
   * outside the grid is solid.** That is what makes the room a closed box even
   * if someone authors a template without a wall on every edge: the player
   * cannot be pushed out of the world by a bug elsewhere, because there is
   * nowhere outside to be.
   */
  isSolid(tileX: number, tileY: number): boolean;
  /** The same question in world units. */
  isSolidAtPixel(x: number, y: number): boolean;
  /** The glyph at these tile coordinates, or `undefined` outside the grid. */
  glyphAt(tileX: number, tileY: number): string | undefined;
}

/** The tile column or row containing a world coordinate. */
export function tileOfPixel(value: number): number {
  return Math.floor(value / TILE_PX);
}

class RoomTileGrid implements TileGrid {
  readonly width: number;
  readonly height: number;
  readonly widthPx: number;
  readonly heightPx: number;

  /** 1 where solid. One byte per tile; a 64x64 room is 4KB. */
  private readonly solid: Uint8Array;
  private readonly glyphs: readonly string[];

  constructor(width: number, height: number, glyphs: readonly string[]) {
    this.width = width;
    this.height = height;
    this.widthPx = width * TILE_PX;
    this.heightPx = height * TILE_PX;
    this.glyphs = glyphs;
    this.solid = new Uint8Array(width * height);

    const solidSet = new Set(SOLID_GLYPHS);
    for (let i = 0; i < glyphs.length; i += 1) {
      this.solid[i] = solidSet.has(glyphs[i] ?? '') ? 1 : 0;
    }
  }

  isSolid(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= this.width || tileY >= this.height) {
      return true;
    }
    return this.solid[tileY * this.width + tileX] === 1;
  }

  isSolidAtPixel(x: number, y: number): boolean {
    return this.isSolid(tileOfPixel(x), tileOfPixel(y));
  }

  glyphAt(tileX: number, tileY: number): string | undefined {
    if (tileX < 0 || tileY < 0 || tileX >= this.width || tileY >= this.height) {
      return undefined;
    }
    return this.glyphs[tileY * this.width + tileX];
  }
}

/**
 * Builds a collision grid from a validated room template.
 *
 * Takes the template's own `width` and `height` as the truth and reads the
 * glyph rows against them, so a row that is the wrong length produces a
 * clearly-wrong grid rather than a differently-shaped one. The validator
 * (GAM-6) already rejects that case before a build, which is why this does not
 * need to report it again.
 */
export function tileGridFromRoom(room: RoomTemplate): TileGrid {
  const glyphs: string[] = [];

  for (let y = 0; y < room.height; y += 1) {
    const row = room.tiles[y] ?? '';
    for (let x = 0; x < room.width; x += 1) {
      glyphs.push(row[x] ?? '#');
    }
  }

  return new RoomTileGrid(room.width, room.height, glyphs);
}

/**
 * The centre of the room's player-start tile, in world units.
 *
 * Falls back to the centre of the first non-solid tile, and then to the middle
 * of the room, so a template with no `p` still spawns somewhere standable
 * rather than inside a wall. Scans in row-major order, so the answer does not
 * depend on anything but the template.
 */
export function playerStartPixel(room: RoomTemplate): { x: number; y: number } {
  const centreOf = (tileX: number, tileY: number): { x: number; y: number } => ({
    x: tileX * TILE_PX + TILE_PX / 2,
    y: tileY * TILE_PX + TILE_PX / 2,
  });

  const solidSet = new Set(SOLID_GLYPHS);
  let firstOpen: { x: number; y: number } | undefined;

  for (let y = 0; y < room.height; y += 1) {
    const row = room.tiles[y] ?? '';
    for (let x = 0; x < room.width; x += 1) {
      const glyph = row[x];
      if (glyph === PLAYER_START_GLYPH) {
        return centreOf(x, y);
      }
      if (firstOpen === undefined && glyph !== undefined && !solidSet.has(glyph)) {
        firstOpen = centreOf(x, y);
      }
    }
  }

  return firstOpen ?? centreOf(Math.floor(room.width / 2), Math.floor(room.height / 2));
}
