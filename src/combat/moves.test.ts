import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@/core/constants';
import { World } from '@/core/world';
import { BIG_EMPTY_ROOM } from '@/dungeon/testRooms';
import { tileGridFromRoom } from '@/dungeon/tileGrid';
import type { Move } from '@/content/schema/index.ts';
import { validateContentOnDisk } from '@/content/node-loader.ts';
import { formatIssues } from '@/content/validate.ts';
import type { Vec2 } from '@/entities/playerInput';
import { FLAG_HITTABLE } from './flags';
import { MoveCaster } from './moves';
import { projectileOnlyShapes } from './moveShapes';
import { ProjectilePool } from './projectiles';
import { cooldownRate } from './stats';
import { projectileMove, unimplementedShapeMove } from './testMoves';
import { MUZZLE_OFFSET } from './tuning';

/** Base Speed of 100 is the pivot of GDD 4.4: a cooldown rate of exactly 1. */
const PIVOT_SPEED = 100;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Harness {
  readonly world: World;
  readonly pool: ProjectilePool;
  readonly caster: MoveCaster;
  readonly aim: Vec2;
  /** Drive `ticks` simulation steps with the fire button in this state. */
  run(ticks: number, firing: boolean): void;
}

function harness(moves: readonly Move[], speedStat = PIVOT_SPEED): Harness {
  const grid = tileGridFromRoom(BIG_EMPTY_ROOM);
  const world = new World({ seed: 'caster-test' });
  const pool = new ProjectilePool(world, grid, 64);
  const aim: Vec2 = { x: 1, y: 0 };

  const shooter = world.entities.spawn();
  const slot = world.entities.slotOf(shooter);

  world.entities.posX[slot] = 100;
  world.entities.posY[slot] = 100;

  const caster = new MoveCaster({
    caster: shooter,
    moves,
    shapes: projectileOnlyShapes(pool),
    speedStat,
    aim,
  });

  let firing = false;

  world.addSystem('moves', (w) => caster.step(w, firing));
  world.addSystem('projectiles', (w) => pool.step(w));

  return {
    world,
    pool,
    caster,
    aim,
    run: (ticks, wantsFire) => {
      firing = wantsFire;
      world.run(ticks);
    },
  };
}

describe('caster construction', () => {
  it('refuses a move whose shape has no runtime, at construction', () => {
    // The alternative is a move that silently does nothing when fired, which
    // the player reads as the game being broken and the author reads as their
    // data being wrong. `content/validate.ts` catches this at build time; this
    // is the same refusal for a caster assembled in code.
    const grid = tileGridFromRoom(BIG_EMPTY_ROOM);
    const world = new World({ seed: 'no-runtime' });
    const pool = new ProjectilePool(world, grid, 8);
    const shooter = world.entities.spawn();

    expect(
      () =>
        new MoveCaster({
          caster: shooter,
          moves: [unimplementedShapeMove()],
          shapes: projectileOnlyShapes(pool),
          speedStat: PIVOT_SPEED,
          aim: { x: 1, y: 0 },
        }),
    ).toThrow(/nova/);
  });

  it('refuses more moves than there are slots', () => {
    const grid = tileGridFromRoom(BIG_EMPTY_ROOM);
    const world = new World({ seed: 'too-many' });
    const pool = new ProjectilePool(world, grid, 8);
    const shooter = world.entities.spawn();
    const moves = [0, 1, 2, 3, 4].map((i) => projectileMove({ id: `move-${i}` }));

    expect(
      () =>
        new MoveCaster({
          caster: shooter,
          moves,
          shapes: projectileOnlyShapes(pool),
          speedStat: PIVOT_SPEED,
          aim: { x: 1, y: 0 },
        }),
    ).toThrow(/slots/);
  });
});

describe('cooldowns replace PP (GDD 4.4)', () => {
  it('fires once, then refuses until the cooldown has run', () => {
    const { caster, run } = harness([projectileMove({ cooldown: 1, cast: 0 })]);

    run(1, true);
    expect(caster.shotCount).toBe(1);

    // Held down for most of a second at a cooldown rate of exactly 1.
    run(TICK_HZ - 2, true);
    expect(caster.shotCount).toBe(1);

    run(2, true);
    expect(caster.shotCount).toBe(2);
  });

  it('spam-clicking gets nothing a held button would not', () => {
    // The acceptance criterion, and the reason the caster acts on the button
    // being down rather than on its edge: there is nothing extra to get.
    const held = harness([projectileMove({ cooldown: 0.5, cast: 3 })]);
    const spammed = harness([projectileMove({ cooldown: 0.5, cast: 3 })]);

    held.run(300, true);

    for (let tick = 0; tick < 300; tick += 1) {
      // Every other tick, which is faster than any hand can click.
      spammed.run(1, tick % 2 === 0);
    }

    expect(spammed.caster.shotCount).toBe(held.caster.shotCount);
    expect(held.caster.shotCount).toBeGreaterThan(1);
  });

  it('has no use counter anywhere: it fires forever', () => {
    // PP is gone (GDD 4.4). Ten thousand ticks is about three minutes of
    // sustained fire; a move with a hidden budget would stop somewhere in it.
    const { caster, run } = harness([projectileMove({ cooldown: 0.1, cast: 0 })]);

    run(10_000, true);

    expect(caster.shotCount).toBeGreaterThan(150);
    expect(caster.readiness(0)).toBeLessThanOrEqual(1);
  });

  it('drains the cooldown faster for a faster species (GDD 4.4)', () => {
    // Speed's second job. 255 base Speed gives a rate of 1.31, so the same
    // move comes back about a third sooner -- and the formula lives in
    // `stats.ts`, not here.
    const slow = harness([projectileMove({ cooldown: 1, cast: 0 })], 1);
    const fast = harness([projectileMove({ cooldown: 1, cast: 0 })], 255);

    slow.run(TICK_HZ * 10, true);
    fast.run(TICK_HZ * 10, true);

    expect(fast.caster.shotCount).toBeGreaterThan(slow.caster.shotCount);
    expect(cooldownRate(255)).toBeGreaterThan(cooldownRate(1));
  });

  it('reports readiness as a fraction, so the HUD reads the same for any move', () => {
    const { caster, run } = harness([projectileMove({ cooldown: 2, cast: 0 })]);

    run(1, true);
    expect(caster.readiness(0)).toBeCloseTo(0, 2);

    run(TICK_HZ, false);
    expect(caster.readiness(0)).toBeCloseTo(0.5, 2);

    run(TICK_HZ, false);
    expect(caster.readiness(0)).toBe(1);
  });

  it('never reports more than ready, however long it idles', () => {
    const { caster, run } = harness([projectileMove({ cooldown: 0.25, cast: 0 })]);

    run(1, true);
    run(600, false);

    expect(caster.readiness(0)).toBe(1);
    expect(caster.cooldownRemaining(0)).toBe(0);
  });

  it('an Elixir clears the cooldown mid-flight (GDD 4.4)', () => {
    const { caster, run } = harness([projectileMove({ cooldown: 5, cast: 0 })]);

    run(1, true);
    expect(caster.shotCount).toBe(1);

    caster.resetCooldowns();
    run(1, true);

    expect(caster.shotCount).toBe(2);
  });

  it('keeps a cooldown per slot, so one move does not lock the others', () => {
    const { caster, run } = harness([
      projectileMove({ id: 'slot-0', cooldown: 5 }),
      projectileMove({ id: 'slot-1', cooldown: 5 }),
    ]);

    run(1, true);
    expect(caster.shotCount).toBe(1);

    caster.select(1);
    run(1, true);

    expect(caster.shotCount).toBe(2);
    expect(caster.cooldownRemaining(0)).toBeGreaterThan(0);
    expect(caster.cooldownRemaining(1)).toBeGreaterThan(0);
  });
});

describe('cast windup', () => {
  it('holds the shot for the move’s cast frames, then releases', () => {
    const { caster, pool, run } = harness([projectileMove({ cast: 10, cooldown: 5 })]);

    run(1, true);
    expect(caster.isCasting).toBe(true);
    expect(pool.count).toBe(0);

    run(8, true);
    expect(caster.isCasting).toBe(true);
    expect(pool.count).toBe(0);

    run(1, true);
    expect(caster.isCasting).toBe(false);
    expect(pool.count).toBe(1);
  });

  it('fires on the press for a move with no windup', () => {
    const { caster, pool, run } = harness([projectileMove({ cast: 0, cooldown: 5 })]);

    run(1, true);

    expect(caster.isCasting).toBe(false);
    expect(caster.shotCount).toBe(1);
    expect(pool.count).toBe(1);
  });

  it('starts the cooldown at the release, not at the press', () => {
    // Otherwise a long cast would partly pay for its own cooldown, and `cast`
    // would quietly be a discount rather than a cost.
    const { caster, run } = harness([projectileMove({ cast: 30, cooldown: 1 })]);

    run(31, true);
    expect(caster.shotCount).toBe(1);
    expect(caster.cooldownRemaining(0)).toBeCloseTo(1 - 1 / TICK_HZ, 3);
  });

  it('reads the aim at the release, so the player can steer through a windup', () => {
    const { caster, pool, aim, world, run } = harness([projectileMove({ cast: 20, cooldown: 5 })]);

    aim.x = 1;
    aim.y = 0;
    run(1, true);
    expect(caster.isCasting).toBe(true);

    // Turned around mid-windup. The shot must leave the way the mouse is
    // pointing when it leaves, not the way it pointed when the click landed.
    aim.x = 0;
    aim.y = -1;
    run(19, true);

    expect(pool.count).toBe(1);
    const slot = world.entities.slotOf(pool.idAt(0));
    expect(world.entities.velX[slot]).toBeCloseTo(0, 6);
    expect(world.entities.velY[slot]).toBeLessThan(0);
  });

  it('reports the windup progress for the telegraph', () => {
    const { caster, run } = harness([projectileMove({ cast: 20, cooldown: 5 })]);

    expect(caster.castProgress()).toBe(0);

    run(1, true);
    run(9, true);

    expect(caster.castProgress()).toBeCloseTo(0.5, 2);
  });

  it('does not start a second cast while one is running', () => {
    const { caster, run } = harness([
      projectileMove({ id: 'slot-0', cast: 30, cooldown: 5 }),
      projectileMove({ id: 'slot-1', cast: 0, cooldown: 5 }),
    ]);

    run(1, true);
    caster.select(1);
    run(5, true);

    // The slot-1 move has no windup and no cooldown yet, so a caster that
    // allowed a second cast would have fired it five times by now.
    expect(caster.shotCount).toBe(0);
    expect(caster.isCasting).toBe(true);
  });

  it('does not go on cooldown for a shot the pool had no room for', () => {
    const grid = tileGridFromRoom(BIG_EMPTY_ROOM);
    const world = new World({ seed: 'full-pool' });
    const pool = new ProjectilePool(world, grid, 1);
    const shooter = world.entities.spawn();
    const caster = new MoveCaster({
      caster: shooter,
      moves: [projectileMove({ cooldown: 5, cast: 0, projectile: { range: 1_000 } })],
      shapes: projectileOnlyShapes(pool),
      speedStat: PIVOT_SPEED,
      aim: { x: 1, y: 0 },
    });

    world.addSystem('moves', (w) => caster.step(w, true));
    world.run(1);
    expect(caster.shotCount).toBe(1);

    caster.resetCooldowns();
    world.run(1);

    // The pool is full, so nothing came out -- and charging the player a
    // five-second cooldown for a shot the engine dropped would read as the
    // game eating an input.
    expect(caster.shotCount).toBe(1);
    expect(caster.cooldownRemaining(0)).toBe(0);
    expect(pool.overflowCount).toBe(1);
  });

  it('stops firing when its caster is gone', () => {
    const { caster, world, run } = harness([projectileMove({ cast: 0, cooldown: 0 })]);

    run(1, true);
    expect(caster.shotCount).toBe(1);

    world.entities.despawn(caster.caster);
    run(10, true);

    expect(caster.shotCount).toBe(1);
  });
});

describe('the move is data, not code', () => {
  /**
   * The acceptance criterion in its strongest form: the only difference
   * between these runs is a number in a move row, and the behaviour has to
   * follow. If any of these assertions could be made to pass by editing
   * `src/`, something in `src/` is holding content it should not.
   */
  it('changing the cooldown changes the rate of fire', () => {
    const slow = harness([projectileMove({ cooldown: 1 })]);
    const fast = harness([projectileMove({ cooldown: 0.25 })]);

    slow.run(TICK_HZ * 4, true);
    fast.run(TICK_HZ * 4, true);

    expect(slow.caster.shotCount).toBe(4);
    expect(fast.caster.shotCount).toBe(16);
  });

  it('changing the cast time changes how long the windup lasts', () => {
    const quick = harness([projectileMove({ cast: 2, cooldown: 10 })]);
    const slow = harness([projectileMove({ cast: 40, cooldown: 10 })]);

    quick.run(3, true);
    slow.run(3, true);

    expect(quick.caster.shotCount).toBe(1);
    expect(slow.caster.shotCount).toBe(0);
  });

  it('changing the speed changes how far the shot has gone', () => {
    // Range is pushed out of the way in both, so that the thing being measured
    // is the speed and not which of the two expired first.
    const slow = harness([
      projectileMove({ cooldown: 10, projectile: { speed: 60, range: 1000 } }),
    ]);
    const fast = harness([
      projectileMove({ cooldown: 10, projectile: { speed: 240, range: 1000 } }),
    ]);

    slow.run(30, true);
    fast.run(30, true);

    const muzzle = 100 + MUZZLE_OFFSET;
    const slowX = slow.world.entities.posX[slow.world.entities.slotOf(slow.pool.idAt(0))] ?? 0;
    const fastX = fast.world.entities.posX[fast.world.entities.slotOf(fast.pool.idAt(0))] ?? 0;

    expect(slowX - muzzle).toBeCloseTo(30, 6);
    expect(fastX - muzzle).toBeCloseTo((slowX - muzzle) * 4, 6);
  });

  it('changing the range changes how long the shot lives', () => {
    const short = harness([projectileMove({ cooldown: 10, projectile: { range: 30 } })]);
    const long = harness([projectileMove({ cooldown: 10, projectile: { range: 300 } })]);

    short.run(40, true);
    long.run(40, true);

    expect(short.pool.count).toBe(0);
    expect(long.pool.count).toBe(1);
  });

  it('changing the radius changes what the shot can hit', () => {
    const thin = harness([projectileMove({ cooldown: 10, projectile: { radius: 1 } })]);
    const fat = harness([projectileMove({ cooldown: 10, projectile: { radius: 12 } })]);
    const hits = { thin: 0, fat: 0 };

    thin.pool.onHit = () => {
      hits.thin += 1;
    };
    fat.pool.onHit = () => {
      hits.fat += 1;
    };

    // A target standing eight units off the line of fire: inside the fat
    // shot's radius, outside the thin one's.
    [thin, fat].forEach(({ world }) => {
      const target = world.entities.spawn();
      const slot = world.entities.slotOf(target);

      world.entities.posX[slot] = 150;
      world.entities.posY[slot] = 108;
      world.entities.radius[slot] = 2;
      world.entities.flags[slot] = FLAG_HITTABLE;
    });

    thin.run(60, true);
    fat.run(60, true);

    expect(hits.thin).toBe(0);
    expect(hits.fat).toBe(1);
  });
});

describe('the shipped move in data/moves.json', () => {
  // Guards the one thing a fixture cannot: that the move actually in the data
  // file is a shape this engine can fire, with a parameter block the runtime
  // accepts. A designer who retypes its shape as one of the nine unimplemented
  // ones finds out here as well as in the validator -- and the move is read
  // off disk, so no id or type name appears in this file either.
  const result = validateContentOnDisk(repoRoot);

  it('is a shape the engine can fire, and fires', () => {
    if (!result.ok) {
      throw new Error(`data/ is invalid:\n${formatIssues(result.issues)}`);
    }

    const shipped = result.content.moves;

    expect(shipped.length).toBeGreaterThan(0);

    const first = shipped[0];

    if (first === undefined) {
      return;
    }

    const { caster, pool, run } = harness([first]);

    run(1 + first.cast, true);

    expect(caster.shotCount).toBe(1);
    expect(pool.count).toBe(1);
  });

  it('comes back off cooldown at the rate its own numbers say', () => {
    if (!result.ok) {
      return;
    }

    const first = result.content.moves[0];

    if (first === undefined) {
      return;
    }

    // Derived from the data, not asserted against a literal: the designer is
    // free to retune, and this still has to hold afterwards.
    const { caster, run } = harness([first], PIVOT_SPEED);
    const perShot = first.cast + Math.ceil(first.cooldown * TICK_HZ);

    run(perShot * 5, true);

    expect(caster.shotCount).toBeGreaterThanOrEqual(4);
    expect(caster.shotCount).toBeLessThanOrEqual(6);
  });
});
