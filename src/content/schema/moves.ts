import { z } from 'zod';
import {
  contentIdSchema,
  displayNameSchema,
  moveCategorySchema,
  moveShapeSchema,
  statusConditionSchema,
} from './common.ts';
import { MAX_CAST_FRAMES, MAX_COOLDOWN_SECONDS, MAX_MOVE_POWER } from './limits.ts';

/** A move is a row in a JSON file (GDD 4.2). */

export const moveEffectSchema = z.strictObject({
  status: statusConditionSchema,
  /** Probability per hit, 0..1. */
  chance: z.number().min(0).max(1),
});

export const moveSchema = z.strictObject({
  id: contentIdSchema,
  displayName: displayNameSchema,
  /** A type id from `typechart.json`. */
  type: contentIdSchema,
  category: moveCategorySchema,
  /** Base power. Must be 0 for status moves (checked in cross-reference). */
  power: z.int().min(0).max(MAX_MOVE_POWER),
  shape: moveShapeSchema,
  /** Seconds before reuse. Replaces PP (GDD 4.4). */
  cooldown: z.number().positive().max(MAX_COOLDOWN_SECONDS),
  /** Windup, in simulation frames. */
  cast: z.int().min(0).max(MAX_CAST_FRAMES),
  effect: moveEffectSchema.optional(),
});

export const movesFileSchema = z.array(moveSchema);

export type MoveEffect = z.infer<typeof moveEffectSchema>;
export type Move = z.infer<typeof moveSchema>;
