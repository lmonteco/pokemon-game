/**
 * The acceptance test for the deterministic core (GDD 9.3, 9.4).
 *
 * The property under test: the same seed and the same inputs produce the same
 * state, step for step, forever. Everything else in this milestone exists to
 * make this test possible.
 *
 * The systems below are a stand-in for gameplay, written here rather than in
 * `src/` because M0-3 ships no gameplay. They are chosen to exercise every
 * part of the core that could go non-deterministic: all six random streams,
 * pool reuse under churn, float integration, events, and input. Real combat
 * (GAM-10) will register the same way, against the same guarantee.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_ENTITY, type EntityId } from './entity-registry';
import { formatHash } from './hash';
import { World, type FrameInput } from './world';

const CORE_DIR = dirname(fileURLToPath(import.meta.url));

/** Hit points, held in a parallel array the way a real system would hold them. */
const HP_BY_WORLD = new WeakMap<World, Int32Array>();

// Reused payload structs. A system that allocates a fresh object per event
// would allocate 10,000 of them in this test; the bus never retains a payload,
// so one struct per event name is enough.
const spawnedPayload = { entity: NO_ENTITY as EntityId };
const despawnedPayload = { entity: NO_ENTITY as EntityId };
const damagedPayload = { target: NO_ENTITY as EntityId, source: NO_ENTITY as EntityId, amount: 0 };
const faintedPayload = { entity: NO_ENTITY as EntityId, source: NO_ENTITY as EntityId };

const ARENA = 160;
const MAX_LIVE = 200;

function hpOf(world: World): Int32Array {
  const existing = HP_BY_WORLD.get(world);
  if (existing !== undefined) {
    return existing;
  }
  const fresh = new Int32Array(world.entities.capacity);
  HP_BY_WORLD.set(world, fresh);
  return fresh;
}

/** Spawns churn from the `spawn` stream, so the pool is never at rest. */
function spawnSystem(world: World): void {
  const rng = world.rng.spawn;
  const wanted = world.entities.count < MAX_LIVE ? rng.nextInt(3) : 0;
  for (let i = 0; i < wanted; i += 1) {
    const id = world.entities.spawn();
    if (id === NO_ENTITY) {
      break;
    }
    const slot = world.entities.slotOf(id);
    world.entities.posX[slot] = rng.nextFloatBetween(-ARENA, ARENA);
    world.entities.posY[slot] = rng.nextFloatBetween(-ARENA, ARENA);
    world.entities.velX[slot] = rng.nextFloatBetween(-1, 1);
    world.entities.velY[slot] = rng.nextFloatBetween(-1, 1);
    world.entities.radius[slot] = rng.nextFloatBetween(1, 4);
    // An opaque numeric kind, as the data layer will hand out. No names here.
    world.entities.kind[slot] = rng.nextIntBetween(1, 6);
    hpOf(world)[slot] = rng.nextIntBetween(10, 40);
    spawnedPayload.entity = id;
    world.events.emit('spawned', spawnedPayload);
  }
}

/** Integrates position, and bounces at the arena edge. Pure float maths. */
function moveSystem(world: World): void {
  const { entities } = world;
  for (let i = 0; i < entities.count; i += 1) {
    const slot = entities.slotAt(i);
    entities.posX[slot] = (entities.posX[slot] ?? 0) + (entities.velX[slot] ?? 0);
    entities.posY[slot] = (entities.posY[slot] ?? 0) + (entities.velY[slot] ?? 0);
    if (Math.abs(entities.posX[slot] ?? 0) > ARENA) {
      entities.velX[slot] = -(entities.velX[slot] ?? 0);
    }
    if (Math.abs(entities.posY[slot] ?? 0) > ARENA) {
      entities.velY[slot] = -(entities.velY[slot] ?? 0);
    }
  }
}

/** Steers the first live entity from input, so a replay depends on the script. */
function inputSystem(world: World): void {
  // A button press costs a draw from the `ai` stream, the way a dodge or a
  // move will. That is what makes input part of the run rather than a cosmetic
  // nudge: press a different button on tick 5000 and every later tick differs.
  if ((world.input.buttons & 1) === 1) {
    world.rng.ai.nextInt32();
  }
  if (world.entities.count === 0) {
    return;
  }
  const slot = world.entities.slotAt(0);
  const speed = (world.input.buttons & 1) === 1 ? 2 : 1;
  world.entities.posX[slot] = (world.entities.posX[slot] ?? 0) + world.input.aimX * speed;
  world.entities.posY[slot] = (world.entities.posY[slot] ?? 0) + world.input.aimY * speed;
}

/** Draws from the `combat`, `ai` and `cosmetic` streams and raises events. */
function combatSystem(world: World): void {
  const { entities, events } = world;
  if (entities.count === 0) {
    return;
  }
  const hp = hpOf(world);
  const attacks = world.rng.ai.nextInt(4);
  for (let a = 0; a < attacks; a += 1) {
    if (entities.count === 0) {
      break;
    }
    const victim = entities.idAt(world.rng.combat.nextInt(entities.count));
    const slot = entities.slotOf(victim);
    if (slot === -1) {
      continue;
    }
    const amount = world.rng.combat.nextIntBetween(1, 9);
    world.rng.cosmetic.nextInt32();
    hp[slot] = (hp[slot] ?? 0) - amount;
    damagedPayload.target = victim;
    damagedPayload.source = NO_ENTITY;
    damagedPayload.amount = amount;
    events.emit('damaged', damagedPayload);

    if ((hp[slot] ?? 0) <= 0) {
      faintedPayload.entity = victim;
      faintedPayload.source = NO_ENTITY;
      events.emit('fainted', faintedPayload);
      despawnedPayload.entity = victim;
      events.emit('despawned', despawnedPayload);
      entities.despawn(victim);
    }
  }
}

/** Keeps the `dungeon` and `loot` streams moving too, so all six are covered. */
function dropSystem(world: World): void {
  if (world.rng.loot.chance(0.05)) {
    world.rng.dungeon.nextInt32();
  }
}

/**
 * A scripted input track. Deterministic in the tick alone - no clock, no
 * randomness - and it writes into the caller's struct, so replaying 10,000
 * steps allocates nothing.
 */
function scriptedInput(tick: number, out: FrameInput): void {
  out.buttons = tick % 7 === 0 ? 1 : 0;
  out.aimX = Math.sin(tick * 0.031);
  out.aimY = Math.cos(tick * 0.017);
}

/** A world with the toy systems installed. */
function buildWorld(seed: string, input: typeof scriptedInput | undefined = scriptedInput): World {
  const world = new World({ seed, capacity: 256 });
  world.addSystem('input', inputSystem);
  world.addSystem('spawn', spawnSystem);
  world.addSystem('move', moveSystem);
  world.addSystem('combat', combatSystem);
  world.addSystem('drop', dropSystem);
  world.setInputSource(input);
  return world;
}

describe('determinism', () => {
  it('reaches the same state hash from the same seed and inputs after 10,000 steps', () => {
    const first = buildWorld('DEEPWILD-1');
    const second = buildWorld('DEEPWILD-1');

    first.run(10_000);
    second.run(10_000);

    expect(first.tick).toBe(10_000);
    expect(formatHash(second.hash())).toBe(formatHash(first.hash()));

    // The world has to have actually done something, or this test proves only
    // that two empty worlds are empty.
    expect(first.events.emitCount('spawned')).toBeGreaterThan(1000);
    expect(first.events.emitCount('fainted')).toBeGreaterThan(100);
    expect(first.entities.count).toBeGreaterThan(0);
  });

  it('agrees at every step, not just at the end', () => {
    // End-state equality can hide a divergence that happens to converge. This
    // compares step by step, so the first differing tick is the failure.
    const a = buildWorld('step-by-step');
    const b = buildWorld('step-by-step');
    for (let tick = 1; tick <= 2000; tick += 1) {
      a.run(1);
      b.run(1);
      if (a.hash() !== b.hash()) {
        throw new Error(`diverged at tick ${tick}`);
      }
    }
    expect(b.hash()).toBe(a.hash());
  });

  it('diverges on a different seed', () => {
    const a = buildWorld('seed-a');
    const b = buildWorld('seed-b');
    a.run(10_000);
    b.run(10_000);
    expect(formatHash(b.hash())).not.toBe(formatHash(a.hash()));
  });

  it('diverges on different inputs from the same seed', () => {
    const a = buildWorld('same-seed');
    const b = buildWorld('same-seed', (tick, out) => {
      scriptedInput(tick, out);
      if (tick === 5000) {
        out.buttons = 0b1111;
      }
    });
    a.run(10_000);
    b.run(10_000);
    expect(formatHash(b.hash())).not.toBe(formatHash(a.hash()));
  });

  it('reaches the same state whether run in one block or in chunks', () => {
    // The property the balance simulator needs: stepping is stepping, however
    // the caller slices it.
    const whole = buildWorld('chunked');
    const pieces = buildWorld('chunked');
    whole.run(6000);
    for (let i = 0; i < 6; i += 1) {
      pieces.run(1000);
    }
    expect(pieces.hash()).toBe(whole.hash());
  });

  it('reaches the same state through advance() as through run()', () => {
    // The rendered game drives the loop with real frame times. As long as no
    // stall caps the catch-up, it must land on exactly the same state as a
    // headless run of the same number of steps.
    const headless = buildWorld('frame-driven');
    const framed = buildWorld('frame-driven');

    headless.run(600);
    let steps = 0;
    while (steps < 600) {
      steps += framed.advance(1000 / 60);
    }
    expect(framed.tick).toBeGreaterThanOrEqual(600);
    // Bring the headless run up to whatever the framed one reached, then they
    // must agree: the frame times changed when steps happened, not what they do.
    headless.run(framed.tick - headless.tick);
    expect(framed.hash()).toBe(headless.hash());
  });

  it('runs 10,000 steps headless, with no canvas and no DOM', () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const world = buildWorld('headless');
    expect(() => world.run(10_000)).not.toThrow();
    expect(world.tick).toBe(10_000);
  });

  // The seam from GDD 9.3: the balance simulator imports the core and nothing
  // else. A stray `import Phaser` anywhere in src/core would make a headless
  // run pull in a canvas and this guarantee would quietly disappear.
  it('keeps src/core free of Phaser and of render imports', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(CORE_DIR)) {
      if (!file.endsWith('.ts')) {
        continue;
      }
      const source = readFileSync(join(CORE_DIR, file), 'utf8');
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1] ?? '';
        const allowed =
          specifier.startsWith('./') ||
          specifier.startsWith('node:') ||
          specifier === 'vitest' ||
          (file.endsWith('.test.ts') && specifier.startsWith('@/'));
        if (!allowed) {
          offenders.push(`${file} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not allocate per step in the hot path', async () => {
    // The spot check the plan asks for, with the result printed rather than
    // only asserted. V8 gives no exact allocation counter without
    // --expose-gc, so this measures the two things that are observable:
    //
    //   - garbage collections during a 50,000 step run. A step that allocates
    //     even one small object fills the young generation and forces repeated
    //     scavenges; an allocation-free step forces none.
    //   - marginal heap growth per step, which must not scale with the step
    //     count.
    //
    // Both are read after a warm-up run, so JIT and the lazily created hit
    // point array are outside the window.
    const world = buildWorld('allocation');
    world.run(2000);

    let collections = 0;
    const observer = new PerformanceObserver((list) => {
      collections += list.getEntries().length;
    });
    observer.observe({ entryTypes: ['gc'] });

    const before = process.memoryUsage().heapUsed;
    world.run(50_000);
    const growth = process.memoryUsage().heapUsed - before;

    // GC entries are delivered on the event loop, so let it turn once before
    // reading the count.
    await new Promise((resolve) => setImmediate(resolve));
    observer.disconnect();

    const perStep = growth / 50_000;
    process.stdout.write(
      `  [alloc spot-check] 50,000 steps: ${collections} collections, ` +
        `heap growth ${growth} B (${perStep.toFixed(2)} B/step)\n`,
    );

    expect(world.tick).toBe(52_000);
    // Generous bounds on purpose: this is a smoke alarm for a step that starts
    // allocating, not a benchmark. 50,000 allocating steps would be thousands
    // of collections and megabytes of churn.
    expect(collections).toBeLessThan(10);
    expect(perStep).toBeLessThan(64);
  });
});
