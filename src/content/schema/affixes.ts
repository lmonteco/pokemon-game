import { z } from 'zod';
import {
  contentIdSchema,
  displayNameSchema,
  equipmentSlotSchema,
  raritySchema,
  statKeySchema,
  statusConditionSchema,
} from './common.ts';

/**
 * Loot affixes (GDD 6.4, 9.2). Schema is complete; `data/affixes.json` carries
 * stub rows until the loot milestone fills it in.
 */

/** What an affix does. Engine effect kinds, not content. */
export const affixEffectSchema = z.enum([
  'type-damage',
  'type-resistance',
  'flat-stat',
  'crit-chance',
  'crit-damage',
  'status-chance',
  'status-duration-taken',
  'on-hit-status',
  'berry-healing',
  'stamina-pip',
  'status-immunity',
]);

/** Effect kinds that are meaningless without a type to scope them to. */
export const TYPE_SCOPED_AFFIX_EFFECTS: readonly string[] = ['type-damage', 'type-resistance'];

/** Effect kinds that need a status condition. */
export const STATUS_SCOPED_AFFIX_EFFECTS: readonly string[] = ['on-hit-status', 'status-immunity'];

/** Effect kinds that need a stat. */
export const STAT_SCOPED_AFFIX_EFFECTS: readonly string[] = ['flat-stat'];

/** Roll ranges scale with dungeon depth, so each rarity tier has its own band. */
export const affixTierSchema = z
  .strictObject({
    rarity: raritySchema,
    min: z.number(),
    max: z.number(),
  })
  .refine((tier) => tier.min <= tier.max, {
    message: 'min must not exceed max',
    path: ['min'],
  });

export const affixSchema = z.strictObject({
  id: contentIdSchema,
  displayName: displayNameSchema,
  effect: affixEffectSchema,
  /** Required for type-scoped effects; a type id from `typechart.json`. */
  scopeTypeId: contentIdSchema.optional(),
  /** Required for stat-scoped effects. */
  scopeStat: statKeySchema.optional(),
  /** Required for status-scoped effects. */
  scopeStatus: statusConditionSchema.optional(),
  tiers: z.array(affixTierSchema).min(1),
  slotWhitelist: z.array(equipmentSlotSchema).min(1),
});

export const affixesFileSchema = z.array(affixSchema);

export type AffixEffect = z.infer<typeof affixEffectSchema>;
export type AffixTier = z.infer<typeof affixTierSchema>;
export type Affix = z.infer<typeof affixSchema>;
