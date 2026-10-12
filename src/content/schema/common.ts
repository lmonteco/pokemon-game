import { z } from 'zod';
import { TYPE_CHART_CELL_VALUES } from './limits.ts';

/**
 * Shared primitives and the engine's own vocabularies.
 *
 * Nothing here names a species, a move or a type. The words below are engine
 * concepts that code implements (a shape is a collision volume, an archetype is
 * a behaviour tree); the content that *uses* them lives in `data/` (GDD 11.3).
 */

/** Stable, machine-readable identifier: lower-case kebab-case. */
export const contentIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lower-case kebab-case, e.g. "my-id"');

/** Human-facing label. The only place a content name is allowed to exist. */
export const displayNameSchema = z.string().min(1).max(32);

/** Key into the sprite atlas; must resolve to a real file under `assets/`. */
export const spriteKeySchema = contentIdSchema;

/** A single type-chart cell. */
export const typeMultiplierSchema = z
  .number()
  .refine((value) => (TYPE_CHART_CELL_VALUES as readonly number[]).includes(value), {
    message: `must be one of ${TYPE_CHART_CELL_VALUES.join(', ')}`,
  });

/** Physical uses Atk/Def, special uses SpA/SpD, status deals no damage (GDD 4.2). */
export const moveCategorySchema = z.enum(['physical', 'special', 'status']);

/** How a move exists in space (GDD 4.2). Ten shapes cover the series. */
export const moveShapeSchema = z.enum([
  'projectile',
  'beam',
  'melee-arc',
  'dash-attack',
  'nova',
  'zone',
  'lob',
  'spawn',
  'self',
  'hitscan-cone',
]);

/** Real-time status conditions (GDD 4.5). */
export const statusConditionSchema = z.enum([
  'burn',
  'poison',
  'toxic',
  'paralysis',
  'sleep',
  'freeze',
  'confusion',
  'flinch',
]);

/** Enemy behaviour archetypes (GDD 4.7). */
export const aiArchetypeSchema = z.enum(['chaser', 'ranged', 'charger', 'swarm', 'caster']);

/** Equipment slots (GDD 6.4). */
export const equipmentSlotSchema = z.enum(['held-item', 'scarf', 'band', 'trinket']);

/** Rarity ladder; rarity controls affix count (GDD 6.4). */
export const raritySchema = z.enum(['common', 'great', 'ultra', 'master', 'shiny']);

/** The six series stats (GDD 4.4). */
export const statKeySchema = z.enum(['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed']);

/** One weather per biome in v1.0 (GDD 5.3, 10). */
export const weatherSchema = z.enum(['none', 'rain', 'sun', 'sandstorm', 'hail', 'fog']);

/** Floor hazards (GDD 5.3). */
export const hazardSchema = z.enum([
  'lava',
  'water',
  'spike-trap',
  'summon-trap',
  'warp-trap',
  'type-field-trap',
  'destructible-rock',
]);

export type MoveCategory = z.infer<typeof moveCategorySchema>;
export type MoveShape = z.infer<typeof moveShapeSchema>;
export type StatusCondition = z.infer<typeof statusConditionSchema>;
export type AiArchetype = z.infer<typeof aiArchetypeSchema>;
export type EquipmentSlot = z.infer<typeof equipmentSlotSchema>;
export type Rarity = z.infer<typeof raritySchema>;
export type StatKey = z.infer<typeof statKeySchema>;
export type Weather = z.infer<typeof weatherSchema>;
export type Hazard = z.infer<typeof hazardSchema>;
