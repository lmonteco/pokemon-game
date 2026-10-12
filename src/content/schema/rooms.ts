import { z } from 'zod';
import { contentIdSchema, displayNameSchema } from './common.ts';
import { MAX_ROOM_SIZE, MIN_ROOM_SIZE } from './limits.ts';

/**
 * Hand-authored room templates (GDD 5.1, 5.2, 9.2). Schema is complete; the
 * data folder carries one stub until the dungeon milestone.
 *
 * Tile glyphs are engine vocabulary. `tiles` is one string per row; the
 * cross-reference pass checks the rectangle and every glyph.
 */

/** Legend for the `tiles` grid. */
export const TILE_GLYPHS = {
  '.': 'floor',
  '#': 'wall',
  '~': 'water',
  '^': 'lava',
  o: 'destructible-rock',
  '+': 'door',
  '>': 'stairway',
  p: 'player-start',
  e: 'enemy-spawn',
  i: 'item-spawn',
} as const;

export const ROOM_GLYPHS: readonly string[] = Object.keys(TILE_GLYPHS);

/** Special room kinds (GDD 5.2). */
export const roomKindSchema = z.enum([
  'standard',
  'entrance',
  'stairway',
  'monster-house',
  'kecleon-shop',
  'kangaskhan-stash',
  'treasure-vault',
  'mystery-room',
]);

export const roomTemplateSchema = z.strictObject({
  id: contentIdSchema,
  displayName: displayNameSchema,
  /** A biome id from `biomes.json`. */
  biomeId: contentIdSchema,
  kind: roomKindSchema,
  width: z.int().min(MIN_ROOM_SIZE).max(MAX_ROOM_SIZE),
  height: z.int().min(MIN_ROOM_SIZE).max(MAX_ROOM_SIZE),
  /** One string per row, each `width` glyphs long. */
  tiles: z.array(z.string()).min(MIN_ROOM_SIZE),
});

export type RoomKind = z.infer<typeof roomKindSchema>;
export type RoomTemplate = z.infer<typeof roomTemplateSchema>;
