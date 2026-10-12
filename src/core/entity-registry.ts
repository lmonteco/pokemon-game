/**
 * Entity registry: identity, lifecycle and the transform block (GDD 9.4).
 *
 * This is deliberately not an ECS framework. The performance budget is 40
 * entities and 200 projectiles, which a flat preallocated pool handles without
 * a single allocation per frame, and a generic component framework would cost
 * more to read than it would ever save.
 *
 * Shape:
 *   - every slot exists from construction; nothing grows at runtime
 *   - fields live in parallel typed arrays, one array per field
 *   - a handle carries a generation, so a stale handle to a recycled slot is
 *     detectable rather than silently pointing at somebody else
 *   - iteration walks a dense index list, so cost is proportional to live
 *     entities, not to capacity
 *
 * Systems that need their own fields (hit points, cooldowns, aim) allocate
 * their own `new Float64Array(registry.capacity)` and index it with
 * `registry.slotOf(id)`. That keeps combat data in `src/combat` where it
 * belongs while staying allocation-free.
 */

import { hashFloat64Array, hashInt32Array, hashUint32 } from './hash';

/**
 * An entity handle. Packed as `generation << 16 | slot`, branded so a raw
 * number cannot be passed where a handle is expected.
 */
export type EntityId = number & { readonly __brand: 'EntityId' };

/** The handle that is never alive. Returned when a pool is exhausted. */
export const NO_ENTITY = 0 as EntityId;

const SLOT_BITS = 16;
const SLOT_MASK = 0xffff;
const MAX_CAPACITY = SLOT_MASK + 1;
const MAX_GENERATION = 0x7fff;

/** Default pool size: the 40 entities and 200 projectiles of GDD 9.4, rounded up. */
export const DEFAULT_CAPACITY = 512;

export function slotFromId(id: EntityId): number {
  return id & SLOT_MASK;
}

export function generationFromId(id: EntityId): number {
  return id >>> SLOT_BITS;
}

export class EntityRegistry {
  readonly capacity: number;

  /** Monotonic per-slot generation. Starts at 1 so no live handle is ever 0. */
  private readonly generations: Int32Array;

  /** Dense list of live slots. Valid for indices [0, liveCount). */
  private readonly dense: Int32Array;

  /** Reverse index: slot -> position in `dense`, or -1 when the slot is free. */
  private readonly denseOf: Int32Array;

  /** Free slots, used as a stack. Valid for indices [0, freeCount). */
  private readonly free: Int32Array;

  private liveCount = 0;
  private freeCount: number;
  private overflows = 0;

  // The transform block. Position and velocity are doubles because the
  // simulation integrates them 60 times a second and 32-bit error accumulates
  // visibly over a 10-minute run.
  readonly posX: Float64Array;
  readonly posY: Float64Array;
  readonly velX: Float64Array;
  readonly velY: Float64Array;
  /** Collision radius in world units. Collision itself is M1 (GAM-9). */
  readonly radius: Float64Array;
  /**
   * Opaque numeric kind, assigned by the data layer (GAM-6). The engine never
   * interprets it and never maps it to a name: content lives in `data/`
   * (GDD 11.3).
   */
  readonly kind: Int32Array;
  /** Generic bit field for systems to claim bits in. */
  readonly flags: Int32Array;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > MAX_CAPACITY) {
      throw new RangeError(`capacity must be an integer in 1..${MAX_CAPACITY}, got ${capacity}`);
    }
    this.capacity = capacity;
    this.generations = new Int32Array(capacity);
    this.dense = new Int32Array(capacity);
    this.denseOf = new Int32Array(capacity);
    this.free = new Int32Array(capacity);
    this.posX = new Float64Array(capacity);
    this.posY = new Float64Array(capacity);
    this.velX = new Float64Array(capacity);
    this.velY = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.kind = new Int32Array(capacity);
    this.flags = new Int32Array(capacity);
    this.freeCount = capacity;
    this.resetPools();
  }

  private resetPools(): void {
    this.liveCount = 0;
    this.freeCount = this.capacity;
    for (let i = 0; i < this.capacity; i += 1) {
      this.generations[i] = 1;
      this.denseOf[i] = -1;
      // Hand slots out in ascending order: pop from the top of the stack.
      this.free[i] = this.capacity - 1 - i;
    }
  }

  /** Live entity count. */
  get count(): number {
    return this.liveCount;
  }

  /** Spawn attempts that found the pool full. A rising number means retune. */
  get overflowCount(): number {
    return this.overflows;
  }

  /**
   * Takes a slot from the pool. Returns `NO_ENTITY` when full rather than
   * throwing: a projectile that cannot spawn is a tuning problem, not a crash.
   * All fields are zeroed, so a recycled slot never leaks the previous owner.
   */
  spawn(): EntityId {
    if (this.freeCount === 0) {
      this.overflows += 1;
      return NO_ENTITY;
    }
    this.freeCount -= 1;
    const slot = this.free[this.freeCount] ?? 0;

    this.posX[slot] = 0;
    this.posY[slot] = 0;
    this.velX[slot] = 0;
    this.velY[slot] = 0;
    this.radius[slot] = 0;
    this.kind[slot] = 0;
    this.flags[slot] = 0;

    this.dense[this.liveCount] = slot;
    this.denseOf[slot] = this.liveCount;
    this.liveCount += 1;

    return (((this.generations[slot] ?? 1) << SLOT_BITS) | slot) as EntityId;
  }

  /** True when the handle still refers to the entity it was issued for. */
  isAlive(id: EntityId): boolean {
    const slot = id & SLOT_MASK;
    if (slot >= this.capacity) {
      return false;
    }
    return this.denseOf[slot] !== -1 && this.generations[slot] === id >>> SLOT_BITS;
  }

  /**
   * The storage index for a live handle, or -1 if the handle is stale. Use it
   * to index the field arrays, and to index parallel arrays owned elsewhere.
   */
  slotOf(id: EntityId): number {
    return this.isAlive(id) ? id & SLOT_MASK : -1;
  }

  /**
   * Returns the slot to the pool and bumps its generation, which invalidates
   * every outstanding handle to it. Returns false for a stale handle, so a
   * double despawn is harmless.
   */
  despawn(id: EntityId): boolean {
    if (!this.isAlive(id)) {
      return false;
    }
    const slot = id & SLOT_MASK;
    const position = this.denseOf[slot] ?? -1;
    const last = this.liveCount - 1;

    // Swap-remove from the dense list. Iteration order changes, which is fine:
    // it changes identically in every run from the same seed.
    const moved = this.dense[last] ?? 0;
    this.dense[position] = moved;
    this.denseOf[moved] = position;
    this.dense[last] = slot;
    this.denseOf[slot] = -1;
    this.liveCount = last;

    const nextGeneration = (this.generations[slot] ?? 1) + 1;
    this.generations[slot] = nextGeneration > MAX_GENERATION ? 1 : nextGeneration;

    this.free[this.freeCount] = slot;
    this.freeCount += 1;
    return true;
  }

  /**
   * The live slot at dense position `i`, for `i` in [0, count). Iterate with a
   * plain for loop over indices - no iterator, no closure, no allocation:
   *
   *   for (let i = 0; i < registry.count; i += 1) {
   *     const slot = registry.slotAt(i);
   *   }
   *
   * Despawning during iteration moves the last entity into the current slot,
   * so step `i` back by one when you despawn.
   */
  slotAt(i: number): number {
    return this.dense[i] ?? -1;
  }

  /** The handle for the live slot at dense position `i`. */
  idAt(i: number): EntityId {
    const slot = this.dense[i] ?? 0;
    return (((this.generations[slot] ?? 1) << SLOT_BITS) | slot) as EntityId;
  }

  /** The handle currently occupying a storage slot, or `NO_ENTITY` if free. */
  idOfSlot(slot: number): EntityId {
    if (slot < 0 || slot >= this.capacity || this.denseOf[slot] === -1) {
      return NO_ENTITY;
    }
    return (((this.generations[slot] ?? 1) << SLOT_BITS) | slot) as EntityId;
  }

  /** Despawns everything and rewinds generations. For restarting a run. */
  clear(): void {
    this.posX.fill(0);
    this.posY.fill(0);
    this.velX.fill(0);
    this.velY.fill(0);
    this.radius.fill(0);
    this.kind.fill(0);
    this.flags.fill(0);
    this.overflows = 0;
    this.resetPools();
  }

  /**
   * Folds the live entity state into a running hash.
   *
   * It hashes by storage slot, not by dense position, on purpose. Dense order
   * depends on despawn history; slot contents do not. Two runs that reach the
   * same state by the same sequence of operations agree either way, but
   * hashing by slot makes the hash mean "the world looks like this" rather
   * than "the world looks like this and got here in this order".
   */
  hash(h: number): number {
    let out = hashUint32(h, this.liveCount);
    out = hashInt32Array(out, this.generations, this.capacity);
    out = hashInt32Array(out, this.denseOf, this.capacity);
    out = hashFloat64Array(out, this.posX, this.capacity);
    out = hashFloat64Array(out, this.posY, this.capacity);
    out = hashFloat64Array(out, this.velX, this.capacity);
    out = hashFloat64Array(out, this.velY, this.capacity);
    out = hashFloat64Array(out, this.radius, this.capacity);
    out = hashInt32Array(out, this.kind, this.capacity);
    out = hashInt32Array(out, this.flags, this.capacity);
    return out;
  }
}
