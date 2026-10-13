/**
 * The projectile pool: the only thing in the game that exists in large numbers
 * (GDD 9.4 budgets 200 of them at 60fps).
 *
 * Four decisions, each with a tempting cheaper alternative:
 *
 * 1. **Pooled through the entity registry, capped separately.** A projectile
 *    is a real entity, so it gets the registry's generational handles, its
 *    allocation-free spawn and -- the reason that matters most -- its place in
 *    `World.hash()`, which is how the determinism contract covers shots at all.
 *    What the pool adds on top is a cap of its own
 *    (`MAX_LIVE_PROJECTILES`): registry slots are shared with creatures, and a
 *    fast-firing move must not be able to spend all of them.
 *
 * 2. **Walls are swept, targets are substepped.** `moveBox` already tests every
 *    tile column and row the shot crosses, so it cannot tunnel through a wall
 *    at any speed or tick rate, and "no projectile escapes the room" follows
 *    from everything outside the grid being solid (`tileGrid.ts`). Targets are
 *    a circle query at a point, so the path is walked in steps no longer than
 *    the shot's own size -- see `MIN_HIT_SUBSTEP`.
 *
 * 3. **Targets come out of a spatial hash, rebuilt once per tick.** Not per
 *    projectile: one rebuild of 40 entities serves all 200 shots. The naive
 *    nested loop is 8,000 distance checks a tick and is the version that does
 *    not hold the budget.
 *
 * 4. **Damage is not here.** The pool reports a hit and gets out of the way
 *    (`onHit`). Resolving it against the type chart is M1-4, and a pool that
 *    knew about the chart would be a pool nobody could test without one.
 *
 * Allocation-free per shot and per tick: every array below is sized at
 * construction, and the spawn and step methods only write into them.
 */

import { TICK_HZ } from '@/core/constants';
import { NO_ENTITY, type EntityId } from '@/core/entity-registry';
import { DEFAULT_CELL_SIZE, SpatialHash } from '@/core/spatialHash';
import type { World } from '@/core/world';
import { moveBox, type BoxMoveResult } from '@/dungeon/tileCollision';
import type { TileGrid } from '@/dungeon/tileGrid';
import { MAX_PROJECTILE_PIERCE } from '@/content/schema/limits.ts';
import { FLAG_HITTABLE, FLAG_PROJECTILE } from './flags';
import { MAX_HIT_SUBSTEPS, MAX_LIVE_PROJECTILES, MIN_HIT_SUBSTEP } from './tuning';

/**
 * Called once for every target a shot strikes. The projectile is still alive
 * at this point, so a listener may read its position.
 *
 * `moveIndex` is an index into the move table the caster was built with -- a
 * number, never a name (GDD 11.3). M1-4's damage system turns it into a row of
 * `data/moves.json` and a `damaged` event.
 */
export type ProjectileHitHandler = (
  world: World,
  projectile: EntityId,
  target: EntityId,
  moveIndex: number,
) => void;

/** Called where a shot struck a wall or a target, for the impact frame. */
export type ProjectileImpactHandler = (x: number, y: number, moveIndex: number) => void;

/** Everything a shot needs at spawn that is not already in the world. */
export interface ProjectileSpawn {
  readonly owner: EntityId;
  readonly x: number;
  readonly y: number;
  /** Unit direction. The pool does not normalise it; the caster has already. */
  readonly dirX: number;
  readonly dirY: number;
  /** World units per second, from `data/moves.json`. */
  readonly speed: number;
  readonly radius: number;
  /** World units of travel before it fizzles, from `data/moves.json`. */
  readonly range: number;
  /** Extra targets it passes through. 0 stops it at the first. */
  readonly pierce: number;
  readonly moveIndex: number;
}

/** How many struck targets one projectile remembers, so it cannot re-hit one. */
const HIT_MEMORY_STRIDE = MAX_PROJECTILE_PIERCE + 1;

export class ProjectilePool {
  readonly capacity: number;
  private readonly grid: TileGrid;

  /** Live projectile handles, dense in [0, liveCount). */
  private readonly live: Int32Array;
  private liveCount = 0;

  /** Shots that found the pool full. A rising number means retune. */
  private overflows = 0;

  // Per-projectile fields, indexed by registry slot. Position, velocity and
  // radius are the registry's; what is here is what only a shot has.
  private readonly moveIndex: Int32Array;
  private readonly owner: Int32Array;
  private readonly rangeLeft: Float64Array;
  private readonly pierceLeft: Int32Array;

  /** Targets already struck, `HIT_MEMORY_STRIDE` slots per projectile. */
  private readonly hitMemory: Int32Array;
  private readonly hitCount: Int32Array;

  /** Hittable entities, rebuilt every tick. Slots in, slots out. */
  private readonly targets: SpatialHash;
  private readonly queryOut: Int32Array;

  /** Scratch for `moveBox`, reused so a tick allocates nothing. */
  private readonly swept: BoxMoveResult = { x: 0, y: 0, hitX: false, hitY: false };

  /** Installed by whoever cares. The pool itself does no damage and no art. */
  onHit: ProjectileHitHandler | undefined;
  onImpact: ProjectileImpactHandler | undefined;

  constructor(world: World, grid: TileGrid, capacity: number = MAX_LIVE_PROJECTILES) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    if (capacity > world.entities.capacity) {
      throw new RangeError(
        `projectile cap ${capacity} exceeds the entity pool's ${world.entities.capacity}`,
      );
    }

    this.capacity = capacity;
    this.grid = grid;

    const slots = world.entities.capacity;

    this.live = new Int32Array(capacity);
    this.moveIndex = new Int32Array(slots);
    this.owner = new Int32Array(slots);
    this.rangeLeft = new Float64Array(slots);
    this.pierceLeft = new Int32Array(slots);
    this.hitMemory = new Int32Array(slots * HIT_MEMORY_STRIDE);
    this.hitCount = new Int32Array(slots);

    this.targets = new SpatialHash(grid.widthPx, grid.heightPx, slots, DEFAULT_CELL_SIZE);
    this.queryOut = new Int32Array(slots);
  }

  /** Live shots. Never above `capacity`. */
  get count(): number {
    return this.liveCount;
  }

  /** Shots refused because the pool was full. */
  get overflowCount(): number {
    return this.overflows;
  }

  /** The live handle at dense position `i`, for `i` in [0, count). */
  idAt(i: number): EntityId {
    return (this.live[i] ?? NO_ENTITY) as EntityId;
  }

  /** Which move fired the shot in registry slot `slot`. */
  moveIndexOfSlot(slot: number): number {
    return this.moveIndex[slot] ?? -1;
  }

  /**
   * Spawns one shot, or returns `NO_ENTITY` when the pool is full.
   *
   * Full is not an error. The alternative -- throwing, or quietly growing the
   * pool -- turns a tuning problem into either a crash or a frame-rate cliff
   * halfway through a run. `overflowCount` is how it gets noticed instead.
   */
  fire(world: World, spawn: ProjectileSpawn): EntityId {
    if (this.liveCount >= this.capacity) {
      this.overflows += 1;
      return NO_ENTITY;
    }

    const entities = world.entities;
    const id = entities.spawn();

    if (id === NO_ENTITY) {
      this.overflows += 1;
      return NO_ENTITY;
    }

    const slot = entities.slotOf(id);

    entities.posX[slot] = spawn.x;
    entities.posY[slot] = spawn.y;
    entities.velX[slot] = spawn.dirX * spawn.speed;
    entities.velY[slot] = spawn.dirY * spawn.speed;
    entities.radius[slot] = spawn.radius;
    entities.flags[slot] = FLAG_PROJECTILE;

    this.moveIndex[slot] = spawn.moveIndex;
    this.owner[slot] = spawn.owner;
    this.rangeLeft[slot] = spawn.range;
    this.pierceLeft[slot] = spawn.pierce;
    this.hitCount[slot] = 0;

    this.live[this.liveCount] = id;
    this.liveCount += 1;

    world.events.emit('spawned', { entity: id });
    return id;
  }

  /**
   * One simulation step for every live shot. Register it after the caster, so
   * a shot fired this tick travels this tick:
   *
   *   world.addSystem('projectiles', (w) => pool.step(w));
   */
  step(world: World): void {
    if (this.liveCount === 0) {
      // Still cheap to skip: with no shots in the air the target index is not
      // worth building, and an empty room is the common case out of combat.
      return;
    }

    this.indexTargets(world);

    // Backwards, so that retiring the current shot -- which moves the last
    // live one into this slot -- cannot skip an entry.
    for (let i = this.liveCount - 1; i >= 0; i -= 1) {
      const id = (this.live[i] ?? NO_ENTITY) as EntityId;
      const slot = world.entities.slotOf(id);

      if (slot === -1) {
        // Despawned by something else. Drop it rather than trusting the
        // handle: a stale slot index would read another entity's fields.
        this.retire(world, i, NO_ENTITY);
        continue;
      }

      if (!this.advance(world, slot, id)) {
        this.retire(world, i, id);
      }
    }
  }

  /** Despawns every live shot. For restarting a run. */
  clear(world: World): void {
    for (let i = this.liveCount - 1; i >= 0; i -= 1) {
      this.retire(world, i, (this.live[i] ?? NO_ENTITY) as EntityId);
    }
    this.overflows = 0;
  }

  /**
   * Rebuilds the hittable index. Projectiles are excluded by their own flag,
   * so shots do not collide with each other -- which would make a stream of
   * fire destroy itself.
   */
  private indexTargets(world: World): void {
    const entities = world.entities;

    this.targets.clear();

    for (let i = 0; i < entities.count; i += 1) {
      const slot = entities.slotAt(i);

      if (slot === -1) {
        continue;
      }

      const flags = entities.flags[slot] ?? 0;

      if ((flags & FLAG_HITTABLE) === 0 || (flags & FLAG_PROJECTILE) !== 0) {
        continue;
      }

      this.targets.insert(
        slot,
        entities.posX[slot] ?? 0,
        entities.posY[slot] ?? 0,
        entities.radius[slot] ?? 0,
      );
    }
  }

  /**
   * Moves one shot and resolves what it ran into. Returns false when the shot
   * is finished and should be retired.
   */
  private advance(world: World, slot: number, id: EntityId): boolean {
    const entities = world.entities;

    const fromX = entities.posX[slot] ?? 0;
    const fromY = entities.posY[slot] ?? 0;
    const radius = entities.radius[slot] ?? 0;
    const stepX = (entities.velX[slot] ?? 0) / TICK_HZ;
    const stepY = (entities.velY[slot] ?? 0) / TICK_HZ;

    // The wall sweep decides the furthest the shot could possibly get. A
    // square of half-extent `radius` stands in for the circle: at the sizes a
    // projectile is drawn the corners are sub-pixel, and reusing the swept box
    // means the no-tunnelling guarantee is the one already tested in
    // `dungeon/tileCollision.test.ts` rather than a second one written here.
    const swept = moveBox(this.grid, fromX, fromY, radius, radius, stepX, stepY, this.swept);
    const hitWall = swept.hitX || swept.hitY;

    const travelX = swept.x - fromX;
    const travelY = swept.y - fromY;
    const travelled = Math.sqrt(travelX * travelX + travelY * travelY);

    // Walk the path looking for targets, stopping where one is struck. Done
    // before the wall is honoured, because a target standing in front of the
    // wall is hit first.
    const substeps = this.substepCount(travelled, radius);

    for (let s = 1; s <= substeps; s += 1) {
      const t = s / substeps;
      const x = fromX + travelX * t;
      const y = fromY + travelY * t;

      entities.posX[slot] = x;
      entities.posY[slot] = y;

      if (!this.resolveHits(world, slot, id, x, y, radius)) {
        // Stopped on a target part-way along. Its position is already the
        // substep point, which is where the impact mark belongs.
        return false;
      }
    }

    entities.posX[slot] = swept.x;
    entities.posY[slot] = swept.y;

    const rangeLeft = (this.rangeLeft[slot] ?? 0) - travelled;
    this.rangeLeft[slot] = rangeLeft;

    if (hitWall) {
      this.onImpact?.(swept.x, swept.y, this.moveIndex[slot] ?? 0);
      return false;
    }

    // Out of range fizzles with no impact mark: it happens at the far end of a
    // long shot, where there is nothing for the mark to land on.
    return rangeLeft > 0;
  }

  /**
   * How many target checks to spread over a step of `travelled` units.
   *
   * One check is right for every move the game will realistically carry; the
   * loop exists so that a move authored near `MAX_PROJECTILE_SPEED` does not
   * silently step over whatever it was aimed at.
   */
  private substepCount(travelled: number, radius: number): number {
    const reach = Math.max(radius, MIN_HIT_SUBSTEP);

    if (travelled <= reach) {
      return 1;
    }

    return Math.min(MAX_HIT_SUBSTEPS, Math.ceil(travelled / reach));
  }

  /**
   * Strikes every new target overlapping the shot at `(x, y)`. Returns true if
   * the shot survives -- which it does only while it has pierce left.
   */
  private resolveHits(
    world: World,
    slot: number,
    id: EntityId,
    x: number,
    y: number,
    radius: number,
  ): boolean {
    const found = this.targets.query(x, y, radius, this.queryOut);

    if (found === 0) {
      return true;
    }

    const entities = world.entities;
    const ownerId = (this.owner[slot] ?? NO_ENTITY) as EntityId;
    const move = this.moveIndex[slot] ?? 0;

    for (let i = 0; i < found; i += 1) {
      const targetSlot = this.queryOut[i] ?? -1;

      if (targetSlot === -1) {
        continue;
      }

      const targetId = entities.idOfSlot(targetSlot);

      // Never the shooter. Without this every shot dies at the muzzle, since
      // it is spawned inside its owner's own collision circle.
      if (targetId === NO_ENTITY || targetId === ownerId || this.alreadyHit(slot, targetId)) {
        continue;
      }

      this.remember(slot, targetId);
      this.onHit?.(world, id, targetId, move);
      this.onImpact?.(x, y, move);

      const pierceLeft = this.pierceLeft[slot] ?? 0;

      if (pierceLeft <= 0) {
        return false;
      }

      this.pierceLeft[slot] = pierceLeft - 1;
    }

    return true;
  }

  private alreadyHit(slot: number, targetId: EntityId): boolean {
    const base = this.memoryBase(slot);
    const count = this.hitCount[slot] ?? 0;

    for (let i = 0; i < count; i += 1) {
      if (this.hitMemory[base + i] === targetId) {
        return true;
      }
    }

    return false;
  }

  private remember(slot: number, targetId: EntityId): void {
    const count = this.hitCount[slot] ?? 0;

    if (count >= HIT_MEMORY_STRIDE) {
      // Unreachable while `pierce` is capped at `MAX_PROJECTILE_PIERCE`: the
      // shot dies on the hit after its last pierce, so it can strike at most
      // `pierce + 1` targets. Guarded anyway, because the alternative is a
      // write past the end of one projectile's memory into the next one's.
      return;
    }

    this.hitMemory[this.memoryBase(slot) + count] = targetId;
    this.hitCount[slot] = count + 1;
  }

  /**
   * Hit memory is indexed by registry slot, like every other field here.
   *
   * Indexing it by the pool's own dense position would halve the array, and
   * would be wrong: the dense position of a live shot changes whenever an
   * earlier one retires, so a shot's memory would move out from under it
   * mid-flight and it would start re-hitting what it had already struck.
   */
  private memoryBase(slot: number): number {
    return slot * HIT_MEMORY_STRIDE;
  }

  /** Returns the slot to the registry and swap-removes it from the live list. */
  private retire(world: World, index: number, id: EntityId): void {
    const last = this.liveCount - 1;

    this.live[index] = this.live[last] ?? 0;
    this.liveCount = last;

    if (id !== NO_ENTITY) {
      world.events.emit('despawned', { entity: id });
      world.entities.despawn(id);
    }
  }
}

/**
 * How long a shot stays alive, in seconds, for a move's range and speed.
 *
 * Exported for the tests and the HUD rather than used by the pool, which
 * charges distance directly. Range is what a designer reasons about -- "this
 * reaches four tiles" -- and the lifetime is the quotient.
 */
export function projectileLifetimeSeconds(range: number, speed: number): number {
  return range / speed;
}
