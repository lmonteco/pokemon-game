/**
 * Fixed timestep loop (GDD 9.4).
 *
 * The simulation advances in exact 1/60 s steps and nothing else. Rendering
 * runs at whatever rate the browser offers and interpolates between the last
 * two simulation states using `alpha`. That split is why a run is reproducible:
 * the step function never sees a frame time, never sees the wall clock, and
 * cannot behave differently on a 144Hz monitor.
 *
 * Two details that are easy to get wrong and expensive to fix later:
 *
 * 1. **No accumulator subtraction.** Time is kept as a single elapsed total and
 *    the target tick is `floor(elapsed * 60 / 1000)`. Repeatedly subtracting
 *    16.666... ms from an accumulator drifts, because that number is not
 *    representable in binary floating point. One multiply has no drift.
 * 2. **Catch-up is capped.** If the tab is backgrounded for five seconds, the
 *    honest answer is 300 steps, which would take longer than a frame to run
 *    and hand the player a slideshow that then runs 300 steps again. The loop
 *    runs at most `maxCatchUpSteps` and throws the rest of the time away,
 *    counting it, so the stall shows up in diagnostics instead of as a spiral.
 */

import { TICK_HZ, TICK_MS } from './constants';

/** Steps per `advance` call. 5 is 83 ms of catch-up: enough for a GC pause. */
export const DEFAULT_MAX_CATCH_UP_STEPS = 5;

export interface FixedLoopOptions {
  /** Runs one simulation step. Receives the tick index it is producing. */
  readonly step: (tick: number) => void;
  /** Simulation rate. Defaults to GDD 9.4's 60Hz. */
  readonly hz?: number;
  /** Upper bound on steps per `advance` call. */
  readonly maxCatchUpSteps?: number;
}

export class FixedLoop {
  private readonly stepFn: (tick: number) => void;
  readonly hz: number;
  readonly stepMs: number;
  readonly maxCatchUpSteps: number;

  /** Real time fed in so far, in ms. Never read by the simulation. */
  private elapsedMs = 0;
  private currentTick = 0;
  private droppedMsTotal = 0;
  private stallCount = 0;

  constructor(options: FixedLoopOptions) {
    const hz = options.hz ?? TICK_HZ;
    if (!Number.isFinite(hz) || hz <= 0) {
      throw new RangeError(`hz must be positive, got ${hz}`);
    }
    const maxCatchUp = options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;
    if (!Number.isInteger(maxCatchUp) || maxCatchUp < 1) {
      throw new RangeError(`maxCatchUpSteps must be a positive integer, got ${maxCatchUp}`);
    }
    this.stepFn = options.step;
    this.hz = hz;
    this.stepMs = hz === TICK_HZ ? TICK_MS : 1000 / hz;
    this.maxCatchUpSteps = maxCatchUp;
  }

  /** Ticks simulated so far. */
  get tick(): number {
    return this.currentTick;
  }

  /**
   * How far the renderer is between the previous step and the next one, in
   * [0, 1). Multiply positions by this to interpolate and the picture is
   * smooth at any refresh rate without the simulation knowing.
   */
  get alpha(): number {
    const exact = (this.elapsedMs * this.hz) / 1000;
    const fraction = exact - this.currentTick;
    return fraction <= 0 ? 0 : fraction >= 1 ? 1 - Number.EPSILON : fraction;
  }

  /** Simulated time, in ms. Derived from the tick count, not from wall clock. */
  get simulatedMs(): number {
    return (this.currentTick * 1000) / this.hz;
  }

  /** Real time discarded to the catch-up cap. Non-zero means stalls happened. */
  get droppedMs(): number {
    return this.droppedMsTotal;
  }

  /** How many `advance` calls hit the catch-up cap. */
  get stalls(): number {
    return this.stallCount;
  }

  /**
   * Feeds real elapsed time in and runs however many whole steps that buys.
   * Returns the number of steps run. Negative or non-finite deltas are
   * ignored: a backwards clock must not rewind the simulation.
   */
  advance(deltaMs: number): number {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return 0;
    }
    this.elapsedMs += deltaMs;

    const targetTick = Math.floor((this.elapsedMs * this.hz) / 1000);
    let owed = targetTick - this.currentTick;
    if (owed <= 0) {
      return 0;
    }

    if (owed > this.maxCatchUpSteps) {
      const dropped = owed - this.maxCatchUpSteps;
      owed = this.maxCatchUpSteps;
      this.droppedMsTotal += (dropped * 1000) / this.hz;
      this.stallCount += 1;
      // Re-base the clock onto the ticks actually being run. Without this the
      // debt stays on the books and every later frame runs the capped number
      // of steps forever - the spiral this cap exists to prevent.
      this.elapsedMs -= (dropped * 1000) / this.hz;
    }

    for (let i = 0; i < owed; i += 1) {
      this.currentTick += 1;
      this.stepFn(this.currentTick);
    }
    return owed;
  }

  /**
   * Runs exactly `steps` steps with no reference to real time. This is the
   * headless entry point: the balance simulator (GDD 9.3) and the determinism
   * tests drive the simulation through here, with no Phaser and no canvas.
   */
  run(steps: number): void {
    if (!Number.isInteger(steps) || steps < 0) {
      throw new RangeError(`run needs a non-negative integer step count, got ${steps}`);
    }
    for (let i = 0; i < steps; i += 1) {
      this.currentTick += 1;
      this.stepFn(this.currentTick);
    }
    this.elapsedMs = (this.currentTick * 1000) / this.hz;
  }

  /** Rewinds the clock and the tick counter. Does not touch simulation state. */
  reset(): void {
    this.elapsedMs = 0;
    this.currentTick = 0;
    this.droppedMsTotal = 0;
    this.stallCount = 0;
  }
}
