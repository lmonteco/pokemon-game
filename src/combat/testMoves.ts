/**
 * Move rows built in code, for tests.
 *
 * Not content and not shipped: nothing in the game imports this. It exists so
 * that a cooldown test can state the exact numbers it is about next to the
 * assertion, rather than depending on `data/moves.json`, which the designer is
 * free to retune at any moment -- and would then break tests that were never
 * about the tuning.
 *
 * The ids and type names here are deliberately nonsense. A fixture that named
 * one of the eighteen real types would be the first step towards a type name
 * living in `src/`, which GDD 11.3 does not allow -- and the guard in
 * `content/content.test.ts` would catch it. `data/moves.json` is exercised too,
 * in `content/content.test.ts` and in `moves.test.ts`, so both paths are
 * covered.
 */

import type { Move, ProjectileShapeParams } from '@/content/schema/index.ts';

/**
 * A straight projectile with every number stated.
 *
 * The defaults are chosen to make arithmetic in a test obvious rather than to
 * play well: 60 units a second is exactly one unit a tick at `TICK_HZ`, so a
 * distance in units is also a count of ticks.
 */
export function projectileMove(overrides: {
  readonly id?: string;
  readonly cooldown?: number;
  readonly cast?: number;
  readonly power?: number;
  readonly projectile?: Partial<ProjectileShapeParams>;
}): Move {
  return {
    id: overrides.id ?? 'test-projectile',
    displayName: 'Test Projectile',
    type: 'test-type',
    category: 'special',
    power: overrides.power ?? 40,
    shape: 'projectile',
    cooldown: overrides.cooldown ?? 1,
    cast: overrides.cast ?? 0,
    projectile: {
      speed: 60,
      radius: 2,
      range: 100,
      pierce: 0,
      ...overrides.projectile,
    },
  };
}

/** A move whose shape no runtime implements, for the refusal paths. */
export function unimplementedShapeMove(): Move {
  return {
    id: 'test-nova',
    displayName: 'Test Nova',
    type: 'test-type',
    category: 'special',
    power: 40,
    shape: 'nova',
    cooldown: 1,
    cast: 0,
  };
}
