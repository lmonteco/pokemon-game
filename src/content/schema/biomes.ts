import { z } from 'zod';
import { contentIdSchema, displayNameSchema, hazardSchema, weatherSchema } from './common.ts';

/** Biomes: floor ranges, spawn tables, boss, weather, hazards (GDD 5.4, 9.2). */

export const spawnTableEntrySchema = z.strictObject({
  /** A species id from `species.json`. */
  speciesId: contentIdSchema,
  /** Relative spawn weight. */
  weight: z.number().positive(),
});

export const biomeSchema = z.strictObject({
  id: contentIdSchema,
  displayName: displayNameSchema,
  /** Inclusive floor range. `from` must not exceed `to`. */
  floors: z.strictObject({
    from: z.int().min(1),
    to: z.int().min(1),
  }),
  /** Type ids this biome favours, for spawn flavour (GDD 5.4). */
  favouredTypes: z.array(contentIdSchema),
  spawnTable: z.array(spawnTableEntrySchema).min(1),
  /**
   * A species id from `species.json`. Optional because the endless biome has
   * depth records instead of a boss (GDD 5.4).
   */
  bossSpeciesId: contentIdSchema.optional(),
  weather: weatherSchema,
  hazards: z.array(hazardSchema),
});

export const biomesFileSchema = z.array(biomeSchema);

export type SpawnTableEntry = z.infer<typeof spawnTableEntrySchema>;
export type Biome = z.infer<typeof biomeSchema>;
