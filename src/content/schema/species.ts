import { z } from 'zod';
import {
  aiArchetypeSchema,
  contentIdSchema,
  displayNameSchema,
  spriteKeySchema,
} from './common.ts';
import { MAX_BASE_STAT, MAX_LEVEL, MAX_TYPES_PER_SPECIES, MIN_BASE_STAT } from './limits.ts';

/** Fields are exactly those listed in GDD 9.2. */

export const baseStatsSchema = z.strictObject({
  hp: z.int().min(MIN_BASE_STAT).max(MAX_BASE_STAT),
  attack: z.int().min(MIN_BASE_STAT).max(MAX_BASE_STAT),
  defense: z.int().min(MIN_BASE_STAT).max(MAX_BASE_STAT),
  spAttack: z.int().min(MIN_BASE_STAT).max(MAX_BASE_STAT),
  spDefense: z.int().min(MIN_BASE_STAT).max(MAX_BASE_STAT),
  speed: z.int().min(MIN_BASE_STAT).max(MAX_BASE_STAT),
});

export const learnsetEntrySchema = z.strictObject({
  /** A move id from `moves.json`. */
  moveId: contentIdSchema,
  level: z.int().min(1).max(MAX_LEVEL),
});

/**
 * Evolution is player-confirmed at the hub shrine (GDD 6.2); the data only says
 * what the trigger is. `into` must name another species in the same file.
 */
export const evolutionSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('level'),
    into: contentIdSchema,
    level: z.int().min(2).max(MAX_LEVEL),
  }),
  z.strictObject({
    method: z.literal('item'),
    into: contentIdSchema,
    /** An item id from `items.json` (a stone found as deep loot, GDD 6.2). */
    itemId: contentIdSchema,
  }),
]);

export const speciesSchema = z.strictObject({
  id: contentIdSchema,
  displayName: displayNameSchema,
  /** One or two type ids from `typechart.json`. */
  types: z.array(contentIdSchema).min(1).max(MAX_TYPES_PER_SPECIES),
  baseStats: baseStatsSchema,
  learnset: z.array(learnsetEntrySchema).min(1),
  evolution: evolutionSchema.optional(),
  spriteKey: spriteKeySchema,
  aiArchetype: aiArchetypeSchema,
});

export const speciesFileSchema = z.array(speciesSchema);

export type BaseStats = z.infer<typeof baseStatsSchema>;
export type LearnsetEntry = z.infer<typeof learnsetEntrySchema>;
export type Evolution = z.infer<typeof evolutionSchema>;
export type Species = z.infer<typeof speciesSchema>;
