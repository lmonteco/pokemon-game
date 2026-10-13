import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TILE_PX } from '@/core/constants';
import { validateContentOnDisk } from '@/content/node-loader.ts';
import { PLAYER_START_GLYPH, playerStartPixel, tileGridFromRoom, tileOfPixel } from './tileGrid';
import { OPEN_BOX, PILLAR, roomFromRows } from './testRooms';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('tileOfPixel', () => {
  it('maps a world coordinate onto the tile containing it', () => {
    expect(tileOfPixel(0)).toBe(0);
    expect(tileOfPixel(TILE_PX - 1)).toBe(0);
    expect(tileOfPixel(TILE_PX)).toBe(1);
  });

  it('floors toward negative infinity outside the room', () => {
    // Truncation instead of flooring would make -0.5 and 0.5 the same tile, so
    // the column of wall just left of the origin would be the wrong one. The
    // player cannot normally get there, but the sweep in `tileCollision.ts`
    // asks about tiles it has not reached yet, and those can be negative.
    expect(tileOfPixel(-1)).toBe(-1);
    expect(tileOfPixel(-TILE_PX)).toBe(-1);
    expect(tileOfPixel(-TILE_PX - 1)).toBe(-2);
  });
});

describe('tileGridFromRoom', () => {
  it('reads its size from the template', () => {
    const grid = tileGridFromRoom(roomFromRows(OPEN_BOX));

    expect(grid.width).toBe(8);
    expect(grid.height).toBe(6);
    expect(grid.widthPx).toBe(8 * TILE_PX);
    expect(grid.heightPx).toBe(6 * TILE_PX);
  });

  it('makes walls solid and floor walkable', () => {
    const grid = tileGridFromRoom(roomFromRows(PILLAR));

    expect(grid.isSolid(0, 0)).toBe(true);
    expect(grid.isSolid(1, 1)).toBe(false);
    expect(grid.isSolid(3, 2)).toBe(true);
    expect(grid.isSolid(3, 1)).toBe(false);
  });

  it('treats everything outside the grid as solid', () => {
    // This is what makes a room a closed box even if a template is authored
    // without a wall on an edge: there is nowhere outside to be pushed to. A
    // grid that answered "walkable" out of bounds would let one bug elsewhere
    // put the player in an empty void with no way back.
    const grid = tileGridFromRoom(roomFromRows(OPEN_BOX));

    expect(grid.isSolid(-1, 1)).toBe(true);
    expect(grid.isSolid(1, -1)).toBe(true);
    expect(grid.isSolid(8, 1)).toBe(true);
    expect(grid.isSolid(1, 6)).toBe(true);
    expect(grid.isSolid(-9999, -9999)).toBe(true);
    expect(grid.isSolid(9999, 9999)).toBe(true);
  });

  it('answers the same question in world units', () => {
    const grid = tileGridFromRoom(roomFromRows(PILLAR));

    // The pillar is tiles (3..4, 2..3), so it spans x 48..79 and y 32..63.
    // The far edges are the interesting ones: a conversion that rounded rather
    // than floored would put x 79 in the walkable tile 5.
    expect(grid.isSolidAtPixel(48, 32)).toBe(true);
    expect(grid.isSolidAtPixel(79, 63)).toBe(true);
    expect(grid.isSolidAtPixel(47, 32)).toBe(false);
    expect(grid.isSolidAtPixel(80, 32)).toBe(false);
    expect(grid.isSolidAtPixel(48, 64)).toBe(false);
  });

  it('reports glyphs, and undefined outside', () => {
    const grid = tileGridFromRoom(roomFromRows(OPEN_BOX));

    expect(grid.glyphAt(0, 0)).toBe('#');
    expect(grid.glyphAt(1, 1)).toBe('.');
    expect(grid.glyphAt(-1, 0)).toBeUndefined();
    expect(grid.glyphAt(0, 6)).toBeUndefined();
  });

  it('fills a short row with wall rather than with holes', () => {
    // The validator rejects a ragged template before a build, so this only
    // happens to a hand-built one mid-edit. Filling with wall fails closed: a
    // missing glyph cannot become a hole the player falls out of the room
    // through, which is the failure that would be hard to trace back here.
    const grid = tileGridFromRoom(roomFromRows(['####', '#.', '####']));

    expect(grid.isSolid(2, 1)).toBe(true);
    expect(grid.isSolid(3, 1)).toBe(true);
    expect(grid.isSolid(1, 1)).toBe(false);
  });
});

describe('playerStartPixel', () => {
  it('centres the player on the start glyph', () => {
    const room = roomFromRows(['#####', '#...#', '#.p.#', '#####']);

    // Tile (2,2), so the middle of it.
    expect(playerStartPixel(room)).toEqual({ x: 2 * TILE_PX + 8, y: 2 * TILE_PX + 8 });
  });

  it('falls back to the first walkable tile when a template has no start', () => {
    // Spawning somewhere standable beats refusing to load: a template without
    // a `p` is a half-finished edit, and the useful response is to let the
    // author run it and see.
    const room = roomFromRows(OPEN_BOX);

    expect(playerStartPixel(room)).toEqual({ x: TILE_PX + 8, y: TILE_PX + 8 });
  });

  it('falls back to the middle of a room with nowhere to stand', () => {
    const room = roomFromRows(['###', '###', '###']);

    expect(playerStartPixel(room)).toEqual({ x: TILE_PX + 8, y: TILE_PX + 8 });
  });

  it('picks the first start glyph in row-major order', () => {
    // Two `p` glyphs is an authoring mistake, but the answer still has to be
    // the same on every run or a replay would desync at the spawn.
    const room = roomFromRows(['#####', '#p.p#', '#####']);

    expect(playerStartPixel(room)).toEqual({ x: TILE_PX + 8, y: TILE_PX + 8 });
  });
});

describe('the room templates in data/', () => {
  const result = validateContentOnDisk(REPO_ROOT);

  if (!result.ok) {
    throw new Error('data/ did not validate; fix that before reading this test');
  }

  const rooms = result.content.rooms;

  it('found templates to check', () => {
    expect(rooms.length).toBeGreaterThan(0);
  });

  it('builds a grid of the declared size for every template', () => {
    const wrong: string[] = [];

    rooms.forEach((room) => {
      const grid = tileGridFromRoom(room);

      if (grid.width !== room.width || grid.height !== room.height) {
        wrong.push(`${room.id}: ${grid.width}x${grid.height} != ${room.width}x${room.height}`);
      }
    });

    expect(wrong).toEqual([]);
  });

  it('spawns the player somewhere standable in every template', () => {
    // The player constructor throws on a spawn inside a wall, so a template
    // whose `p` is misplaced would crash the game on load. Caught here instead.
    const inWalls: string[] = [];

    rooms.forEach((room) => {
      const grid = tileGridFromRoom(room);
      const start = playerStartPixel(room);

      if (grid.isSolidAtPixel(start.x, start.y)) {
        inWalls.push(`${room.id} at (${start.x}, ${start.y})`);
      }
    });

    expect(inWalls).toEqual([]);
  });

  it('gives the movement test chamber a start glyph and room to run in', () => {
    // M1-1's test room specifically: it has to be larger than the 240x160
    // screen on both axes or the camera clamp in `followCamera.ts` is never
    // exercised by playing it.
    const room = rooms.find((candidate) => candidate.id === 'movement-test-chamber');

    expect(room).toBeDefined();
    expect(room?.tiles.join('')).toContain(PLAYER_START_GLYPH);

    const grid = tileGridFromRoom(room ?? roomFromRows(OPEN_BOX));

    expect(grid.widthPx).toBeGreaterThan(240);
    expect(grid.heightPx).toBeGreaterThan(160);
  });
});
