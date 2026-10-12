import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPACITY,
  EntityRegistry,
  NO_ENTITY,
  generationFromId,
  slotFromId,
  type EntityId,
} from './entity-registry';

describe('entity registry', () => {
  it('spawns, counts and despawns', () => {
    const registry = new EntityRegistry(8);
    expect(registry.count).toBe(0);

    const a = registry.spawn();
    const b = registry.spawn();
    expect(registry.count).toBe(2);
    expect(registry.isAlive(a)).toBe(true);

    expect(registry.despawn(a)).toBe(true);
    expect(registry.isAlive(a)).toBe(false);
    expect(registry.isAlive(b)).toBe(true);
    expect(registry.count).toBe(1);
  });

  it('never issues the null handle', () => {
    const registry = new EntityRegistry(4);
    for (let i = 0; i < 4; i += 1) {
      expect(registry.spawn()).not.toBe(NO_ENTITY);
    }
    expect(registry.isAlive(NO_ENTITY)).toBe(false);
    expect(registry.slotOf(NO_ENTITY)).toBe(-1);
  });

  // The failure this prevents: a projectile holds a handle to the enemy it was
  // fired at, the enemy faints, a new enemy recycles the slot, and the
  // projectile silently damages the wrong target. The generation bump makes
  // that a dead handle instead of a wrong one.
  it('rejects a stale handle after the slot is recycled', () => {
    const registry = new EntityRegistry(1);
    const first = registry.spawn();
    registry.posX[slotFromId(first)] = 42;
    registry.despawn(first);

    const second = registry.spawn();
    expect(slotFromId(second)).toBe(slotFromId(first));
    expect(generationFromId(second)).toBe(generationFromId(first) + 1);
    expect(registry.isAlive(first)).toBe(false);
    expect(registry.isAlive(second)).toBe(true);
    expect(registry.slotOf(first)).toBe(-1);
  });

  it('zeroes a recycled slot so no state leaks to the next owner', () => {
    const registry = new EntityRegistry(1);
    const first = registry.spawn();
    const slot = slotFromId(first);
    registry.posX[slot] = 10;
    registry.velY[slot] = -3;
    registry.kind[slot] = 7;
    registry.flags[slot] = 0b1011;
    registry.radius[slot] = 2.5;
    registry.despawn(first);

    registry.spawn();
    expect(registry.posX[slot]).toBe(0);
    expect(registry.velY[slot]).toBe(0);
    expect(registry.kind[slot]).toBe(0);
    expect(registry.flags[slot]).toBe(0);
    expect(registry.radius[slot]).toBe(0);
  });

  it('survives a double despawn', () => {
    const registry = new EntityRegistry(4);
    const id = registry.spawn();
    expect(registry.despawn(id)).toBe(true);
    expect(registry.despawn(id)).toBe(false);
    expect(registry.count).toBe(0);
  });

  it('returns the null handle when the pool is full instead of throwing', () => {
    const registry = new EntityRegistry(3);
    registry.spawn();
    registry.spawn();
    registry.spawn();
    expect(registry.spawn()).toBe(NO_ENTITY);
    expect(registry.overflowCount).toBe(1);
    expect(registry.count).toBe(3);
  });

  it('reuses slots, so a long run never exhausts the pool', () => {
    // 200 projectiles a second for ten minutes, through a pool of 64.
    const registry = new EntityRegistry(64);
    const live: EntityId[] = [];
    for (let i = 0; i < 120_000; i += 1) {
      const id = registry.spawn();
      expect(id).not.toBe(NO_ENTITY);
      live.push(id);
      if (live.length > 32) {
        const oldest = live.shift();
        if (oldest !== undefined) {
          registry.despawn(oldest);
        }
      }
    }
    expect(registry.overflowCount).toBe(0);
    expect(registry.count).toBe(32);
  });

  it('iterates exactly the live set, in a dense range', () => {
    const registry = new EntityRegistry(16);
    const ids = [
      registry.spawn(),
      registry.spawn(),
      registry.spawn(),
      registry.spawn(),
      registry.spawn(),
    ];
    const second = ids[1];
    const fourth = ids[3];
    if (second === undefined || fourth === undefined) {
      throw new Error('spawn returned nothing');
    }
    registry.despawn(second);
    registry.despawn(fourth);

    const walked: number[] = [];
    for (let i = 0; i < registry.count; i += 1) {
      walked.push(registry.slotAt(i));
      expect(registry.isAlive(registry.idAt(i))).toBe(true);
    }
    expect(walked.length).toBe(3);
    expect(new Set(walked).size).toBe(3);
    expect(walked).not.toContain(slotFromId(second));
    expect(walked).not.toContain(slotFromId(fourth));
  });

  it('supports despawning during a backward-stepped iteration', () => {
    // The documented pattern: swap-remove moves the last entity into the
    // current dense position, so a system that kills an entity steps i back.
    const registry = new EntityRegistry(32);
    for (let i = 0; i < 20; i += 1) {
      const id = registry.spawn();
      registry.kind[slotFromId(id)] = i % 2;
    }
    for (let i = 0; i < registry.count; i += 1) {
      const slot = registry.slotAt(i);
      if (registry.kind[slot] === 1) {
        registry.despawn(registry.idAt(i));
        i -= 1;
      }
    }
    expect(registry.count).toBe(10);
    for (let i = 0; i < registry.count; i += 1) {
      expect(registry.kind[registry.slotAt(i)]).toBe(0);
    }
  });

  it('maps a storage slot back to its current handle', () => {
    const registry = new EntityRegistry(4);
    const id = registry.spawn();
    expect(registry.idOfSlot(slotFromId(id))).toBe(id);
    registry.despawn(id);
    expect(registry.idOfSlot(slotFromId(id))).toBe(NO_ENTITY);
    expect(registry.idOfSlot(-1)).toBe(NO_ENTITY);
    expect(registry.idOfSlot(99)).toBe(NO_ENTITY);
  });

  it('clears back to an empty world', () => {
    const registry = new EntityRegistry(8);
    const fresh = new EntityRegistry(8).hash(0);
    for (let i = 0; i < 8; i += 1) {
      registry.posX[slotFromId(registry.spawn())] = i;
    }
    registry.spawn();
    registry.clear();
    expect(registry.count).toBe(0);
    expect(registry.overflowCount).toBe(0);
    expect(registry.hash(0)).toBe(fresh);
  });

  it('hashes by slot contents, not by despawn history', () => {
    // Two registries reach the same contents by different routes. They must
    // agree, or every state hash becomes a history hash and the determinism
    // test starts reporting false differences.
    const a = new EntityRegistry(8);
    const b = new EntityRegistry(8);

    const a1 = a.spawn();
    const a2 = a.spawn();
    a.posX[slotFromId(a2)] = 5;
    a.despawn(a1);

    const b1 = b.spawn();
    const b2 = b.spawn();
    b.posX[slotFromId(b2)] = 5;
    b.despawn(b1);

    expect(b.hash(0)).toBe(a.hash(0));

    a.posY[slotFromId(a2)] = 0.0001;
    expect(a.hash(0)).not.toBe(b.hash(0));
  });

  it('treats negative zero as zero in the hash', () => {
    const a = new EntityRegistry(4);
    const b = new EntityRegistry(4);
    a.velX[slotFromId(a.spawn())] = -0;
    b.velX[slotFromId(b.spawn())] = 0;
    expect(a.hash(0)).toBe(b.hash(0));
  });

  it('rejects an impossible capacity', () => {
    expect(() => new EntityRegistry(0)).toThrow(RangeError);
    expect(() => new EntityRegistry(-4)).toThrow(RangeError);
    expect(() => new EntityRegistry(1.5)).toThrow(RangeError);
    expect(() => new EntityRegistry(70_000)).toThrow(RangeError);
  });

  it('defaults to a pool that covers the performance budget', () => {
    // GDD 9.4: 40 entities plus 200 projectiles.
    expect(DEFAULT_CAPACITY).toBeGreaterThanOrEqual(240);
  });
});
