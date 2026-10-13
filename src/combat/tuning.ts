/**
 * Every number that decides how *firing* feels, and nothing that comes from
 * content (GDD 11.3).
 *
 * The split to keep in mind while tuning: a move's speed, range, radius,
 * cooldown and cast time are content and live in `data/moves.json`. What is
 * here is the engine's own presentation of a shot -- where it leaves the body,
 * how long the impact is on screen -- which is the same for every move and so
 * is not content at all.
 *
 * Companion to `entities/tuning.ts`, which owns the same role for movement.
 */

/**
 * How far along the aim the shot appears, in world units.
 *
 * Zero would spawn it inside the chest, which reads as the shot materialising
 * on top of the character rather than leaving it. Much more than this and the
 * shot appears detached, floating a visible gap away. Five units out of a
 * 16-unit sprite puts it at the edge of the body.
 *
 * It does not need to be inside a wall-free space: `moveBox` tolerates a start
 * that overlaps a wall by letting the shot leave the tile it began in and stop
 * at the next one, so a player hugging a wall loses the shot immediately
 * rather than firing through the level. See `projectiles.ts`.
 */
export const MUZZLE_OFFSET = 5;

/**
 * Frames the impact mark stays on screen after a shot dies.
 *
 * Four frames at 60Hz is 67ms: long enough to register as a hit rather than as
 * the shot blinking out, short enough that a stream of shots into a wall does
 * not build into a solid smear.
 */
export const IMPACT_FRAMES = 4;

/**
 * Live projectile budget (GDD 9.4).
 *
 * Enforced by the pool rather than by the entity registry, and that is the
 * point: the registry's slots are shared with creatures, and a stray
 * fast-firing move must not be able to spend all of them and leave no room to
 * spawn the thing being shot at.
 */
export const MAX_LIVE_PROJECTILES = 200;

/**
 * Longest distance a projectile may advance between two target checks, in
 * world units.
 *
 * Walls do not need this -- `moveBox` sweeps, so it cannot tunnel at any speed
 * -- but the target broadphase is a circle query at a point, and a shot that
 * moves further than its own diameter in one tick would step straight over a
 * target standing in its path. The move shipped today travels under three
 * units a tick and so takes exactly one check; the substep only ever costs
 * anything for a move authored near `MAX_PROJECTILE_SPEED`.
 *
 * Expressed as a floor, not a fixed count: the real bound scales with the
 * projectile's radius, and this is the smallest step worth taking for a shot
 * authored with a sub-pixel radius.
 */
export const MIN_HIT_SUBSTEP = 2;

/**
 * Hard cap on those substeps, so one absurd data value cannot make a single
 * tick unbounded. At the top of `MAX_PROJECTILE_SPEED` a shot moves 33 units a
 * tick, which 16 steps covers with room to spare.
 */
export const MAX_HIT_SUBSTEPS = 16;
