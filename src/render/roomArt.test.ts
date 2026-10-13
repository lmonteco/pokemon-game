import { describe, expect, it } from 'vitest';
import { SOLID_GLYPHS } from '@/dungeon/tileGrid';
import { ROOM_GLYPHS } from '@/content/schema/rooms.ts';
import { roomFromRows, PILLAR } from '@/dungeon/testRooms';
import { SHADES } from './palette';
import { PLAYER_BODY_SHADE, PLAYER_OUTLINE_SHADE } from './playerArt';
import {
  HAZARD_GLYPHS,
  ROOM_SHADES,
  ROOM_TILE_FLOOR,
  ROOM_TILE_FLOOR_SPECK,
  ROOM_TILE_HAZARD,
  ROOM_TILE_WALL,
  hasSpeck,
  roomTileForGlyph,
  roomTilemapData,
} from './roomArt';

/**
 * The room tiles, checked as data. The suite runs in Node with no canvas, so
 * the painting cannot be exercised here -- but the two things that can
 * actually be wrong are both testable: which tile a glyph maps to, and whether
 * the shades leave the player visible.
 */

describe('ROOM_SHADES', () => {
  it('does not paint the floor in the player’s own body shade', () => {
    // The bug this test exists for: with the floor and the creature's body in
    // the same shade, the player renders as a hollow outline sliding over the
    // ground. On a four-shade screen there is no third tone to separate them,
    // so it has to be prevented rather than compensated for. Caught by looking
    // at the running game, pinned here so it cannot come back.
    expect(ROOM_SHADES.floor).not.toBe(PLAYER_BODY_SHADE);
  });

  it('keeps the floor clear of the outline shade too', () => {
    // The outline is the one thing GDD 8.2 calls non-negotiable. A floor in
    // the outline's shade would erase the silhouette entirely.
    expect(ROOM_SHADES.floor).not.toBe(PLAYER_OUTLINE_SHADE);
    expect(ROOM_SHADES.wall).not.toBe(PLAYER_OUTLINE_SHADE);
  });

  it('keeps the floor darker than the walls', () => {
    // Walls have to read as the thing you cannot walk through at a glance,
    // and brighter-than-the-floor is how that reads without a lighting model.
    expect(ROOM_SHADES.floor).toBeLessThan(ROOM_SHADES.wall);
  });

  it('uses only real palette shades', () => {
    // Anything else would be a colour that does not follow a palette swap.
    const valid = new Set<number>(SHADES);
    const wrong = Object.entries(ROOM_SHADES).filter(([, shade]) => !valid.has(shade));

    expect(wrong).toEqual([]);
  });
});

describe('roomTileForGlyph', () => {
  it('draws every solid glyph as a wall', () => {
    // The tile that *looks* solid and the tile that *is* solid come from the
    // same list, so they cannot disagree. A wall you can walk through is the
    // worst class of bug in a game about moving.
    const wrong = SOLID_GLYPHS.filter((glyph) => roomTileForGlyph(glyph, false) !== ROOM_TILE_WALL);

    expect(wrong).toEqual([]);
  });

  it('draws no walkable glyph as a wall', () => {
    // The other direction, over every glyph the schema allows: a floor tile
    // that looked like a wall would send the player round it for no reason.
    const walkable = ROOM_GLYPHS.filter((glyph) => !SOLID_GLYPHS.includes(glyph));
    const wrong = walkable.filter((glyph) => roomTileForGlyph(glyph, false) === ROOM_TILE_WALL);

    expect(wrong).toEqual([]);
  });

  it('draws hazards as hazards', () => {
    const wrong = HAZARD_GLYPHS.filter(
      (glyph) => roomTileForGlyph(glyph, false) !== ROOM_TILE_HAZARD,
    );

    expect(wrong).toEqual([]);
  });

  it('treats a missing glyph as a wall', () => {
    // Fails closed, matching `tileGrid.ts`: a hole in a half-edited template
    // must not become a hole the player falls out of the room through.
    expect(roomTileForGlyph(undefined, false)).toBe(ROOM_TILE_WALL);
  });

  it('applies the speck only to plain floor', () => {
    expect(roomTileForGlyph('.', true)).toBe(ROOM_TILE_FLOOR_SPECK);
    expect(roomTileForGlyph('.', false)).toBe(ROOM_TILE_FLOOR);
    expect(roomTileForGlyph('#', true)).toBe(ROOM_TILE_WALL);
  });

  it('covers every glyph the schema allows', () => {
    // A new glyph added to the schema without a tile here would silently
    // become a wall. This makes that a decision rather than an accident.
    const uncovered = ROOM_GLYPHS.filter((glyph) => {
      const tile = roomTileForGlyph(glyph, false);

      return tile !== ROOM_TILE_WALL && tile !== ROOM_TILE_FLOOR && tile !== ROOM_TILE_HAZARD;
    });

    expect(uncovered).toEqual([]);
  });
});

describe('hasSpeck', () => {
  it('gives the same answer for a tile every time it is asked', () => {
    // The floor must not crawl. A speck pattern that changed between frames
    // would be the exact shimmer the whole-pixel camera exists to remove.
    const first = Array.from({ length: 64 }, (_, i) => hasSpeck(i % 8, Math.floor(i / 8)));
    const second = Array.from({ length: 64 }, (_, i) => hasSpeck(i % 8, Math.floor(i / 8)));

    expect(second).toEqual(first);
  });

  it('scatters specks thinly rather than in stripes', () => {
    // Sparse enough not to read as a texture, present enough to give the eye
    // something to track so the player can judge their own speed.
    let specks = 0;

    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        if (hasSpeck(x, y)) {
          specks += 1;
        }
      }
    }

    const density = specks / (64 * 64);

    expect(density).toBeGreaterThan(0.02);
    expect(density).toBeLessThan(0.3);
  });

  it('does not line the specks up into diagonals', () => {
    // What `(x + y) % n` would do, and it would read as a corduroy pattern
    // scrolling past rather than as scattered detail.
    let onDiagonal = 0;

    for (let i = 0; i < 64; i += 1) {
      if (hasSpeck(i, i)) {
        onDiagonal += 1;
      }
    }

    expect(onDiagonal).toBeLessThan(64);
  });
});

describe('roomTilemapData', () => {
  it('produces a grid of the template’s declared size', () => {
    const data = roomTilemapData(roomFromRows(PILLAR));

    expect(data.length).toBe(PILLAR.length);
    data.forEach((row) => {
      expect(row.length).toBe(PILLAR[0]?.length);
    });
  });

  it('puts walls where the template puts walls', () => {
    const data = roomTilemapData(roomFromRows(PILLAR));

    expect(data[0]?.[0]).toBe(ROOM_TILE_WALL);
    expect(data[2]?.[3]).toBe(ROOM_TILE_WALL);
    expect(data[1]?.[1]).not.toBe(ROOM_TILE_WALL);
  });

  it('fills a short row with wall, like the collision grid does', () => {
    // The drawn room and the collision grid have to agree about a ragged
    // template, or there would be a wall you can see and not touch.
    const data = roomTilemapData(roomFromRows(['####', '#.', '####']));

    expect(data[1]?.[2]).toBe(ROOM_TILE_WALL);
    expect(data[1]?.[3]).toBe(ROOM_TILE_WALL);
  });
});
