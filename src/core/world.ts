/**
 * The world: everything one run of the simulation consists of, and the single
 * place a step happens (GDD 9.3, 9.4).
 *
 * A world owns the entity registry, the event bus, the random streams and the
 * fixed-step loop, and nothing else. It has no rendering, no Phaser import and
 * no DOM dependency - `new World({ seed }).run(10_000)` works in Node. That is
 * the seam the balance simulator in GDD 9.3 plugs into: same object, same
 * systems, no canvas.
 *
 * Gameplay systems live in `src/combat`, `src/entities` and friends and
 * register themselves with `addSystem`. Core stays empty of gameplay on
 * purpose, so the determinism guarantee is about the machinery rather than
 * about any particular rule.
 *
 * What makes a run reproducible, stated as a contract systems must keep:
 *   - read time from `world.timeMs` or the tick, never `Date.now()`
 *   - read randomness from `world.rng.<stream>`, never `Math.random()`
 *   - read input from `world.input`, never from a browser event mid-step
 *   - do not iterate a `Map`/`Set` keyed by object identity
 * The first two are enforced by `no-wall-clock.test.ts`.
 */

import { DEFAULT_CAPACITY, EntityRegistry } from './entity-registry';
import { EventBus } from './events';
import { hashFloat64, hashUint32 } from './hash';
import { FixedLoop, type FixedLoopOptions } from './loop';
import { createRngStreams, RNG_STREAMS, seedToWord, type RngStreams } from './rng';

/**
 * One frame of player intent. A flat struct of numbers so a scripted run can
 * be replayed exactly and so feeding input allocates nothing.
 *
 * `buttons` is a bit field. Which bit means what is decided by the input
 * mapping in M1 (GAM-7/GAM-8) - the core only copies and hashes it.
 */
export interface FrameInput {
  buttons: number;
  /** Aim direction, world units from the player. Not normalised here. */
  aimX: number;
  aimY: number;
}

/**
 * Fills `out` with the input for a tick. Writes into the caller's struct
 * rather than returning a new one, so a 10,000-step replay allocates nothing.
 */
export type InputSource = (tick: number, out: FrameInput) => void;

/** A system runs once per simulation step, in registration order. */
export type SimSystem = (world: World) => void;

export interface WorldOptions {
  /** Seed string for every random stream in this run. */
  readonly seed: string;
  /** Entity pool size. Fixed for the life of the world. */
  readonly capacity?: number;
  /** Simulation rate. Defaults to 60Hz. */
  readonly hz?: number;
  /** Catch-up cap, forwarded to the loop. */
  readonly maxCatchUpSteps?: number;
}

interface RegisteredSystem {
  readonly name: string;
  readonly run: SimSystem;
}

export class World {
  readonly seed: string;
  readonly entities: EntityRegistry;
  readonly events: EventBus;
  readonly rng: RngStreams;
  readonly loop: FixedLoop;

  /** The input for the step currently running. Overwritten each step. */
  readonly input: FrameInput = { buttons: 0, aimX: 0, aimY: 0 };

  private readonly systems: RegisteredSystem[] = [];
  private inputSource: InputSource | undefined;
  private stepping = false;

  constructor(options: WorldOptions) {
    this.seed = options.seed;
    this.entities = new EntityRegistry(options.capacity ?? DEFAULT_CAPACITY);
    this.events = new EventBus();
    this.rng = createRngStreams(options.seed);

    const loopOptions: FixedLoopOptions = {
      step: (tick) => {
        this.stepOnce(tick);
      },
      ...(options.hz === undefined ? {} : { hz: options.hz }),
      ...(options.maxCatchUpSteps === undefined
        ? {}
        : { maxCatchUpSteps: options.maxCatchUpSteps }),
    };
    this.loop = new FixedLoop(loopOptions);
  }

  /** Simulation steps completed. */
  get tick(): number {
    return this.loop.tick;
  }

  /**
   * Simulated milliseconds since the run started. Derived from the tick count,
   * so it is identical in every run and safe for systems to read.
   */
  get timeMs(): number {
    return this.loop.simulatedMs;
  }

  /** Registration order is execution order. Names are for diagnostics. */
  addSystem(name: string, run: SimSystem): void {
    if (this.stepping) {
      throw new Error(`addSystem("${name}") called from inside a step`);
    }
    if (this.systems.some((system) => system.name === name)) {
      throw new Error(`a system named "${name}" is already registered`);
    }
    this.systems.push({ name, run });
  }

  /** Registered system names, in execution order. */
  get systemNames(): readonly string[] {
    return this.systems.map((system) => system.name);
  }

  /**
   * Sets where each step's input comes from. A scripted source makes a run
   * replayable; the live game installs one that reads the polled device state.
   * Pass `undefined` to hold the last input.
   */
  setInputSource(source: InputSource | undefined): void {
    this.inputSource = source;
  }

  /** Writes one frame of input directly. For a caller driving step by step. */
  setInput(buttons: number, aimX: number, aimY: number): void {
    this.input.buttons = buttons;
    this.input.aimX = aimX;
    this.input.aimY = aimY;
  }

  private stepOnce(tick: number): void {
    if (this.inputSource !== undefined) {
      this.inputSource(tick, this.input);
    }
    this.stepping = true;
    try {
      for (let i = 0; i < this.systems.length; i += 1) {
        const system = this.systems[i];
        if (system === undefined) {
          continue;
        }
        system.run(this);
      }
    } finally {
      this.stepping = false;
    }
  }

  /**
   * Advances by real elapsed time. This is what the Phaser scene calls; the
   * loop decides how many whole steps that buys and caps the catch-up.
   * Returns the number of steps run.
   */
  advance(deltaMs: number): number {
    return this.loop.advance(deltaMs);
  }

  /** Runs exactly `steps` steps with no reference to real time. Headless. */
  run(steps: number): void {
    this.loop.run(steps);
  }

  /**
   * One number that stands for the whole observable state of the run: tick,
   * every random stream's position, every entity field, and the event
   * counters. Two runs with the same seed and the same inputs must agree on
   * this after every step; a bug report quotes it.
   */
  hash(): number {
    let h = seedToWord(this.seed);
    h = hashUint32(h, this.loop.tick);
    h = hashUint32(h, this.input.buttons);
    h = hashFloat64(h, this.input.aimX);
    h = hashFloat64(h, this.input.aimY);
    for (const stream of RNG_STREAMS) {
      h = this.rng[stream].hash(h);
    }
    h = this.entities.hash(h);
    h = this.events.hash(h);
    return h;
  }
}

/** Convenience constructor for the common case: a seed and nothing else. */
export function createWorld(seed: string): World {
  return new World({ seed });
}
