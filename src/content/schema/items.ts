import { z } from 'zod';
import {
  contentIdSchema,
  displayNameSchema,
  equipmentSlotSchema,
  spriteKeySchema,
} from './common.ts';

/**
 * Consumables and gear bases (GDD 6.4, 9.2). Schema is complete; the data file
 * carries stubs until the loot milestone.
 */

/** Engine effect kinds for consumables. */
export const consumableEffectSchema = z.enum([
  'heal',
  'heal-percent',
  'cure-status',
  'revive',
  'cooldown-reset',
  'escape',
  'reveal-map',
  'damage',
]);

export const consumableItemSchema = z.strictObject({
  kind: z.literal('consumable'),
  id: contentIdSchema,
  displayName: displayNameSchema,
  spriteKey: spriteKeySchema,
  effect: consumableEffectSchema,
  /** Effect size: hit points, a fraction, or seconds, depending on `effect`. */
  magnitude: z.number().min(0),
});

export const gearItemSchema = z.strictObject({
  kind: z.literal('gear'),
  id: contentIdSchema,
  displayName: displayNameSchema,
  spriteKey: spriteKeySchema,
  slot: equipmentSlotSchema,
});

export const itemSchema = z.discriminatedUnion('kind', [consumableItemSchema, gearItemSchema]);

export const itemsFileSchema = z.array(itemSchema);

export type ConsumableItem = z.infer<typeof consumableItemSchema>;
export type GearItem = z.infer<typeof gearItemSchema>;
export type Item = z.infer<typeof itemSchema>;
