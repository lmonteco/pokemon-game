/**
 * Move shapes: the seam between "a move came off cooldown" and "something
 * exists in the world" (GDD 4.2).
 *
 * GDD 4.2 lists ten shapes and says plainly that the shape field is what makes
 * the game an action game. One of them is implemented -- the projectile -- and
 * the interface below is sized for the other nine, because the point of M1-3
 * is the system, not the one move.
 *
 * What a shape runtime is handed, and why that list and not a longer one:
 *
 *   - the world, for the registry and the random streams
 *   - who cast it, where from, and the unit direction they were aiming
 *   - the move row out of `data/moves.json`, so every number the shape needs
 *     is content
 *   - the index of that row, which is the only form a move takes once it is
 *     inside the simulation (GDD 11.3: no names in `src/`)
 *
 * It is handed no tile grid and no HUD. A shape that needed the walls takes
 * them in its own constructor, as the projectile shape takes the pool.
 *
 * Adding a shape in M2 is: a params block in `content/schema/moves.ts`, a row
 * in `SHAPE_PARAM_FIELDS` so the validator knows it has a runtime, a class
 * here, and a line in the table passed to `MoveCaster`. Nothing in the caster,
 * the cooldown, the HUD or the input map changes.
 */

import { NO_ENTITY, type EntityId } from '@/core/entity-registry';
import type { World } from '@/core/world';
import type { Move, MoveShape } from '@/content/schema/index.ts';
import type { ProjectilePool } from './projectiles';
import { MUZZLE_OFFSET } from './tuning';

/** Everything a shape needs to know about the cast that released it. */
export interface MoveRelease {
  readonly caster: EntityId;
  /** The caster's centre, in world units. */
  readonly originX: number;
  readonly originY: number;
  /** Unit aim direction. Normalised by the caster, never here. */
  readonly aimX: number;
  readonly aimY: number;
  /** The move's index in the caster's table. The move's identity in `src/`. */
  readonly moveIndex: number;
}

/**
 * One shape's runtime. Stateless with respect to the cast: whatever the shape
 * creates, it creates in a pool it was constructed with.
 */
export interface MoveShapeRuntime {
  readonly shape: MoveShape;
  /**
   * Called on the tick a cast completes. Returning false means nothing came
   * out -- a full projectile pool -- which the caster uses to decide whether
   * the move should go on cooldown at all.
   */
  release(world: World, move: Move, release: MoveRelease): boolean;
}

/** The shapes a caster can fire. Keyed by the shape name in the data. */
export type MoveShapeTable = Partial<Record<MoveShape, MoveShapeRuntime>>;

/**
 * The straight projectile: travels along the aim, pierces or stops, dies on a
 * wall (GDD 4.2).
 *
 * Every number it uses comes off the move row. There is no default speed and
 * no default range in this file on purpose: a default is content hiding in
 * code, and `content/validate.ts` already refuses a projectile move with no
 * `projectile` block so the case cannot arise.
 */
export class ProjectileShapeRuntime implements MoveShapeRuntime {
  readonly shape: MoveShape = 'projectile';

  constructor(private readonly pool: ProjectilePool) {}

  release(world: World, move: Move, release: MoveRelease): boolean {
    const params = move.projectile;

    if (params === undefined) {
      // Unreachable through the validated content path; a direct caller with a
      // hand-built move row gets told rather than getting a silent no-op.
      throw new Error(`move "${move.id}" has shape "projectile" but no projectile block`);
    }

    const fired = this.pool.fire(world, {
      owner: release.caster,
      // Offset along the aim so the shot leaves the body instead of appearing
      // on top of it. See `MUZZLE_OFFSET` for why this is safe next to a wall.
      x: release.originX + release.aimX * MUZZLE_OFFSET,
      y: release.originY + release.aimY * MUZZLE_OFFSET,
      dirX: release.aimX,
      dirY: release.aimY,
      speed: params.speed,
      radius: params.radius,
      range: params.range,
      pierce: params.pierce,
      moveIndex: release.moveIndex,
    });

    return fired !== NO_ENTITY;
  }
}

/** The table for a caster that can only fire projectiles. */
export function projectileOnlyShapes(pool: ProjectilePool): MoveShapeTable {
  return { projectile: new ProjectileShapeRuntime(pool) };
}
