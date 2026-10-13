import { z } from 'zod';
import {
  contentIdSchema,
  displayNameSchema,
  moveCategorySchema,
  moveShapeSchema,
  statusConditionSchema,
  type MoveShape,
} from './common.ts';
import {
  MAX_CAST_FRAMES,
  MAX_COOLDOWN_SECONDS,
  MAX_MOVE_POWER,
  MAX_PROJECTILE_PIERCE,
  MAX_PROJECTILE_RADIUS,
  MAX_PROJECTILE_RANGE,
  MAX_PROJECTILE_SPEED,
} from './limits.ts';

/** A move is a row in a JSON file (GDD 4.2). */

export const moveEffectSchema = z.strictObject({
  status: statusConditionSchema,
  /** Probability per hit, 0..1. */
  chance: z.number().min(0).max(1),
});

/**
 * The parameters a `projectile` move needs to exist in space (GDD 4.2).
 *
 * `range` rather than a lifetime in seconds, because range is what a designer
 * actually reasons about -- "this reaches about four tiles" -- and it stays
 * true when the speed is retuned. The lifetime is the quotient and the engine
 * derives it.
 */
export const projectileShapeSchema = z.strictObject({
  /** Travel speed in world units per second. */
  speed: z.number().positive().max(MAX_PROJECTILE_SPEED),
  /** Collision radius in world units. Also decides how big it looks. */
  radius: z.number().positive().max(MAX_PROJECTILE_RADIUS),
  /** World units travelled before it expires. */
  range: z.number().positive().max(MAX_PROJECTILE_RANGE),
  /** Extra targets it passes through. 0 stops it at the first one. */
  pierce: z.int().min(0).max(MAX_PROJECTILE_PIERCE),
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

  // --- shape parameters: exactly one of these, matching `shape` -------------
  // Each shape carries its own block, because a cone's angle and a projectile's
  // range have nothing to say to each other. The cross-reference pass in
  // `validate.ts` enforces that the block present is the one `shape` names.
  projectile: projectileShapeSchema.optional(),
});

export const movesFileSchema = z.array(moveSchema);

export type MoveEffect = z.infer<typeof moveEffectSchema>;
export type ProjectileShapeParams = z.infer<typeof projectileShapeSchema>;
export type Move = z.infer<typeof moveSchema>;

/**
 * Which field holds each shape's parameters, for the shapes the engine can
 * actually fire today.
 *
 * This table is the contract between the data and the shape implementations in
 * `src/combat/moveShapes.ts`: a shape listed here has code behind it, and a
 * shape missing from it is rejected by the validator rather than silently
 * doing nothing at runtime. M2 adds the other seven shapes (GDD 4.2) by adding
 * a params schema above, a row here, and a runtime -- and nothing else.
 */
export const SHAPE_PARAM_FIELDS = {
  projectile: 'projectile',
} as const satisfies Partial<Record<MoveShape, keyof Move>>;

/** The shapes that have both a parameter block and a runtime. */
export const IMPLEMENTED_MOVE_SHAPES = Object.keys(SHAPE_PARAM_FIELDS) as readonly MoveShape[];
