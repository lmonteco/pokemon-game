import { z } from 'zod';
import { contentIdSchema, displayNameSchema, typeMultiplierSchema } from './common.ts';

/**
 * The type chart (GDD 4.3). This file defines the universe of type ids: every
 * other content file is cross-referenced against it, which is why no type name
 * is ever written in `src/`.
 *
 * `multipliers[attacker][defender]`. Squareness and completeness are checked in
 * the cross-reference pass, where the error can name the missing row or column.
 */

export const typeDefinitionSchema = z.strictObject({
  id: contentIdSchema,
  displayName: displayNameSchema,
});

export const typeChartSchema = z.strictObject({
  $comment: z.string().optional(),
  types: z.array(typeDefinitionSchema).min(2),
  multipliers: z.record(contentIdSchema, z.record(contentIdSchema, typeMultiplierSchema)),
});

export type TypeDefinition = z.infer<typeof typeDefinitionSchema>;
export type TypeChart = z.infer<typeof typeChartSchema>;
