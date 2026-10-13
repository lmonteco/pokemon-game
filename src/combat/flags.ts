/**
 * The bits of `EntityRegistry.flags`, claimed in one place.
 *
 * The registry deliberately keeps no opinion about what a flag means -- core
 * holds no gameplay (`core/world.ts`) -- so the bit allocation lives here, in
 * the layer that has the opinions. It is a wire format in the same way the
 * button bits in `entities/playerInput.ts` are: a recorded run and a saved
 * state both carry these numbers, so add new bits at the top end and never
 * reuse a retired one.
 */

/**
 * The entity is a live projectile owned by the projectile pool. Set so that a
 * sweep over the registry can tell a shot from a creature without asking the
 * pool, which is what lets the pool index of hittable targets skip them.
 */
export const FLAG_PROJECTILE = 1 << 0;

/**
 * The entity can be hit by a move. Not every entity is: a dropped item, a
 * spawn marker and a projectile all exist in the registry and none of them is
 * a target.
 *
 * A flag rather than "everything that is not a projectile", because the
 * difference has to be stated by whoever spawns the thing. A default of
 * hittable means the first non-combat entity anybody adds silently starts
 * eating shots.
 */
export const FLAG_HITTABLE = 1 << 1;
