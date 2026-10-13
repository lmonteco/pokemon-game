import { describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_PX } from '@/core/constants';
import { NO_ENTITY, type EntityId } from '@/core/entity-registry';
import { World } from '@/core/world';
import { OPEN_BOX, PILLAR, roomFromRows } from '@/dungeon/testRooms';
import { tileGridFromRoom } from '@/dungeon/tileGrid';
import type { TileGrid } from '@/dungeon/tileGrid';
import { FLAG_HITTABLE } from './flags';
import { ProjectilePool, projectileLifetimeSeconds, type ProjectileSpawn } from './projectiles';
import { MAX_LIVE_PROJECTILES } from './tuning';

/** A room big enough that a 100-unit shot does not reach a wall. */
const BIG_ROOM: readonly string[] = [
  '##############',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '##############',
];

interface Harness {
  readonly world: World;
  readonly grid: TileGrid;
  readonly pool: ProjectilePool;
  /** Entities that are not projectiles, so the leak check has a baseline. */
  readonly baselineEntities: number;
}

function harness(rows: readonly string[] = BIG_ROOM, capacity?: number): Harness {
  const grid = tileGridFromRoom(roomFromRows(rows));
  const world = new World({ seed: 'projectile-test' });
  const pool =
    capacity === undefined
      ? new ProjectilePool(world, grid)
      : new ProjectilePool(world, grid, capacity);

  world.addSystem('projectiles', (w) => pool.step(w));

  return { world, grid, pool, baselineEntities: world.entities.count };
}

/** A hittable entity at a position. Stands in for M1-4's enemies. */
function spawnTarget(world: World, x: number, y: number, radius = 6): EntityId {
  const id = world.entities.spawn();
  const slot = world.entities.slotOf(id);

  world.entities.posX[slot] = x;
  world.entities.posY[slot] = y;
  world.entities.radius[slot] = radius;
  world.entities.flags[slot] = FLAG_HITTABLE;
  return id;
}

function spawn(overrides: Partial<ProjectileSpawn> = {}): ProjectileSpawn {
  return {
    owner: NO_ENTITY,
    x: 100,
    y: 70,
    dirX: 1,
    dirY: 0,
    // 60 units a second is one unit a tick at TICK_HZ, so a distance in units
    // reads as a count of ticks in these tests.
    speed: 60,
    radius: 2,
    range: 100,
    pierce: 0,
    moveIndex: 0,
    ...overrides,
  };
}

function positionOf(world: World, id: EntityId): { x: number; y: number } {
  const slot = world.entities.slotOf(id);

  return { x: world.entities.posX[slot] ?? NaN, y: world.entities.posY[slot] ?? NaN };
}

describe('projectile pool capacity', () => {
  it('never goes above its cap, and says how many shots it refused', () => {
    const { world, pool } = harness(BIG_ROOM, 16);

    for (let i = 0; i < 40; i += 1) {
      pool.fire(world, spawn());
    }

    expect(pool.count).toBe(16);
    expect(pool.overflowCount).toBe(24);
  });

  it('returns NO_ENTITY rather than throwing when it is full', () => {
    const { world, pool } = harness(BIG_ROOM, 1);

    expect(pool.fire(world, spawn())).not.toBe(NO_ENTITY);
    expect(pool.fire(world, spawn())).toBe(NO_ENTITY);
  });

  it('holds the GDD 9.4 budget of 200 by default', () => {
    const { world, pool } = harness();

    for (let i = 0; i < MAX_LIVE_PROJECTILES + 50; i += 1) {
      pool.fire(world, spawn());
    }

    expect(pool.capacity).toBe(MAX_LIVE_PROJECTILES);
    expect(pool.count).toBe(MAX_LIVE_PROJECTILES);
  });

  it('refuses a cap the entity pool could not back', () => {
    const grid = tileGridFromRoom(roomFromRows(BIG_ROOM));
    const world = new World({ seed: 'too-big', capacity: 32 });

    expect(() => new ProjectilePool(world, grid, 64)).toThrow(RangeError);
    expect(() => new ProjectilePool(world, grid, 0)).toThrow(RangeError);
  });

  it('does not spend a registry slot it did not get', () => {
    // A full pool must not have taken an entity slot on the refused shot.
    // Getting this wrong leaks a slot per refused shot, which shows up an hour
    // into a run as enemies failing to spawn.
    const { world, pool, baselineEntities } = harness(BIG_ROOM, 4);

    for (let i = 0; i < 100; i += 1) {
      pool.fire(world, spawn());
    }

    expect(world.entities.count).toBe(baselineEntities + 4);
  });
});

describe('projectile pool lifecycle', () => {
  it('releases every slot when a shot expires, over many cycles', () => {
    // The leak test, and it has to be a loop: a pool that leaked one slot per
    // shot still looks fine after a single volley. Fifty volleys of forty is
    // 2,000 shots through a 512-slot registry, so one leak anywhere exhausts
    // it and `count` never comes back to the baseline.
    const { world, pool, baselineEntities } = harness();
    const lifetimeTicks = Math.ceil(projectileLifetimeSeconds(100, 60) * TICK_HZ);

    for (let volley = 0; volley < 50; volley += 1) {
      for (let i = 0; i < 40; i += 1) {
        pool.fire(world, spawn({ dirX: 0, dirY: 1 }));
      }

      expect(pool.count).toBe(40);

      world.run(lifetimeTicks + 2);

      expect(pool.count).toBe(0);
      expect(world.entities.count).toBe(baselineEntities);
      expect(world.entities.overflowCount).toBe(0);
    }
  });

  it('dies when it has travelled its range, not before', () => {
    const { world, pool } = harness();

    // 100 units of range at one unit a tick. The shot is charged for the
    // distance it covered, so it survives tick 100 and is gone by 101.
    pool.fire(world, spawn({ range: 100 }));

    world.run(99);
    expect(pool.count).toBe(1);

    world.run(2);
    expect(pool.count).toBe(0);
  });

  it('clear despawns everything and leaves the registry clean', () => {
    const { world, pool, baselineEntities } = harness();

    for (let i = 0; i < 30; i += 1) {
      pool.fire(world, spawn());
    }

    pool.clear(world);

    expect(pool.count).toBe(0);
    expect(pool.overflowCount).toBe(0);
    expect(world.entities.count).toBe(baselineEntities);
  });

  it('drops a shot that something else despawned behind its back', () => {
    const { world, pool, baselineEntities } = harness();
    const id = pool.fire(world, spawn());

    world.entities.despawn(id);
    world.run(1);

    expect(pool.count).toBe(0);
    expect(world.entities.count).toBe(baselineEntities);
  });
});

describe('projectiles against walls', () => {
  it('stops at a wall and reports the impact there', () => {
    const { world, pool } = harness(OPEN_BOX);
    const impacts: { x: number; y: number }[] = [];

    pool.onImpact = (x, y) => {
      impacts.push({ x, y });
    };

    // Fired right, from the middle of the 8x6 box. The inner face of the right
    // wall is at x = 7 tiles; a radius-2 shot stops two units short of it.
    pool.fire(world, spawn({ x: 2 * TILE_PX, y: 2.5 * TILE_PX, dirX: 1, dirY: 0, range: 1000 }));

    world.run(200);

    expect(pool.count).toBe(0);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.x).toBeGreaterThan(6 * TILE_PX);
    expect(impacts[0]?.x).toBeLessThanOrEqual(7 * TILE_PX - 2);
  });

  it('cannot tunnel through a wall, at any speed the data allows', () => {
    // The guarantee comes from `moveBox` sweeping rather than from the speed
    // being low. At the top of MAX_PROJECTILE_SPEED a shot covers two tiles a
    // tick, so a scheme that only tested the tile it landed in would put it
    // on the far side of the stone.
    const { world, pool } = harness(OPEN_BOX);

    pool.fire(
      world,
      spawn({ x: 2 * TILE_PX, y: 2.5 * TILE_PX, dirX: 1, speed: 2000, range: 2048 }),
    );

    for (let tick = 0; tick < 10; tick += 1) {
      world.run(1);

      for (let i = 0; i < pool.count; i += 1) {
        expect(positionOf(world, pool.idAt(i)).x).toBeLessThan(7 * TILE_PX);
      }
    }

    expect(pool.count).toBe(0);
  });

  it('lets no shot out of the room, fired in every direction', () => {
    const { world, grid, pool } = harness(PILLAR);
    const directions = 64;

    for (let i = 0; i < directions; i += 1) {
      const angle = (i / directions) * Math.PI * 2;

      pool.fire(
        world,
        spawn({
          // Hard against the inside of the top-left corner, with a pillar in
          // the middle of the room to bounce the fan off.
          x: 1.5 * TILE_PX,
          y: 1.5 * TILE_PX,
          dirX: Math.cos(angle),
          dirY: Math.sin(angle),
          speed: 600,
          range: 2048,
        }),
      );
    }

    for (let tick = 0; tick < 300; tick += 1) {
      world.run(1);

      for (let i = 0; i < pool.count; i += 1) {
        const { x, y } = positionOf(world, pool.idAt(i));

        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x).toBeLessThan(grid.widthPx);
        expect(y).toBeLessThan(grid.heightPx);
      }
    }

    // And they all stopped: a shot still alive after 300 ticks in an 8x6 room
    // is one that found a way outside and is flying off into nothing.
    expect(pool.count).toBe(0);
  });

  it('a shot started inside a wall leaves it and stops at the next one', () => {
    // Can happen when a big-radius move is fired by a player hugging a wall:
    // the muzzle offset lands the shot overlapping the stone. It must not
    // travel along the inside of the wall and it must not escape the room.
    const { world, grid, pool } = harness(OPEN_BOX);

    pool.fire(
      world,
      spawn({ x: 1 * TILE_PX, y: 2.5 * TILE_PX, radius: 10, dirX: -1, speed: 300, range: 2048 }),
    );

    for (let tick = 0; tick < 60; tick += 1) {
      world.run(1);

      for (let i = 0; i < pool.count; i += 1) {
        const { x } = positionOf(world, pool.idAt(i));

        expect(x).toBeGreaterThan(-grid.widthPx);
        expect(x).toBeLessThan(grid.widthPx);
      }
    }

    expect(pool.count).toBe(0);
  });
});

describe('projectiles against targets', () => {
  it('strikes a target in its path, once, and stops there', () => {
    const { world, pool } = harness();
    const hits: { target: EntityId; moveIndex: number }[] = [];

    pool.onHit = (_w, _projectile, target, moveIndex) => {
      hits.push({ target, moveIndex });
    };

    const target = spawnTarget(world, 140, 70);

    pool.fire(world, spawn({ x: 100, y: 70, dirX: 1, moveIndex: 3 }));
    world.run(60);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.target).toBe(target);
    expect(hits[0]?.moveIndex).toBe(3);
    expect(pool.count).toBe(0);
  });

  it('never strikes its own owner, which is where it was spawned', () => {
    const { world, pool } = harness();
    const owner = spawnTarget(world, 100, 70);
    let hits = 0;

    pool.onHit = () => {
      hits += 1;
    };

    pool.fire(world, spawn({ owner, x: 100, y: 70, dirX: 1 }));
    world.run(5);

    expect(hits).toBe(0);
    expect(pool.count).toBe(1);
  });

  it('does not strike other projectiles, so a stream does not eat itself', () => {
    const { world, pool } = harness();
    let hits = 0;

    pool.onHit = () => {
      hits += 1;
    };

    // Two shots crossing through the same point at the same tick.
    pool.fire(world, spawn({ x: 100, y: 70, dirX: 1 }));
    pool.fire(world, spawn({ x: 130, y: 70, dirX: -1 }));
    world.run(40);

    expect(hits).toBe(0);
  });

  it('passes through exactly as many extra targets as pierce allows', () => {
    const { world, pool } = harness();
    const hits: EntityId[] = [];

    pool.onHit = (_w, _projectile, target) => {
      hits.push(target);
    };

    const a = spawnTarget(world, 120, 70, 4);
    const b = spawnTarget(world, 150, 70, 4);
    const c = spawnTarget(world, 180, 70, 4);
    spawnTarget(world, 210, 70, 4);

    pool.fire(world, spawn({ x: 100, y: 70, dirX: 1, pierce: 2, range: 300 }));
    world.run(200);

    expect(hits).toEqual([a, b, c]);
    expect(pool.count).toBe(0);
  });

  it('cannot strike the same target twice while piercing past it', () => {
    // A shot overlapping a target for several ticks, which is what happens
    // with a big target and a slow shot. Without the hit memory this reports a
    // hit every tick and a pierce-2 shot deals six hits to one enemy.
    const { world, pool } = harness();
    const hits: EntityId[] = [];

    pool.onHit = (_w, _projectile, target) => {
      hits.push(target);
    };

    const target = spawnTarget(world, 120, 70, 20);

    pool.fire(world, spawn({ x: 100, y: 70, dirX: 1, pierce: 8, speed: 60, range: 300 }));
    world.run(200);

    expect(hits).toEqual([target]);
  });

  it('does not step over a target when the shot is faster than its own size', () => {
    // The substep loop. At 1200 units a second a shot covers 20 units a tick,
    // and a target three units wide standing in the path would be missed by a
    // single endpoint check.
    const { world, pool } = harness();
    let hits = 0;

    pool.onHit = () => {
      hits += 1;
    };

    spawnTarget(world, 150, 70, 1.5);
    pool.fire(world, spawn({ x: 20, y: 70, dirX: 1, radius: 1, speed: 1200, range: 400 }));
    world.run(40);

    expect(hits).toBe(1);
  });
});

describe('projectile determinism', () => {
  it('two runs from the same seed agree on the world hash', () => {
    // The contract in `core/world.ts`. Projectiles are registry entities, so a
    // shot's position is inside `World.hash()`; a pool that iterated a Map or
    // read a clock would diverge here.
    function run(): number {
      const grid = tileGridFromRoom(roomFromRows(PILLAR));
      const world = new World({ seed: 'same-seed' });
      const pool = new ProjectilePool(world, grid, 64);

      spawnTarget(world, 3 * TILE_PX, 2 * TILE_PX, 5);
      world.addSystem('projectiles', (w) => pool.step(w));

      for (let tick = 0; tick < 240; tick += 1) {
        if (tick % 7 === 0) {
          const angle = (tick / 240) * Math.PI * 2;

          pool.fire(
            world,
            spawn({
              x: 1.5 * TILE_PX,
              y: 1.5 * TILE_PX,
              dirX: Math.cos(angle),
              dirY: Math.sin(angle),
              speed: 240,
              range: 400,
            }),
          );
        }
        world.run(1);
      }

      return world.hash();
    }

    expect(run()).toBe(run());
  });
});
