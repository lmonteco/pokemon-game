import { describe, expect, it } from 'vitest';
import { TICK_HZ, TICK_MS } from './constants';
import { DEFAULT_MAX_CATCH_UP_STEPS, FixedLoop } from './loop';

function countingLoop(options?: { hz?: number; maxCatchUpSteps?: number }): {
  loop: FixedLoop;
  ticks: number[];
} {
  const ticks: number[] = [];
  const loop = new FixedLoop({
    step: (tick) => {
      ticks.push(tick);
    },
    ...(options?.hz === undefined ? {} : { hz: options.hz }),
    ...(options?.maxCatchUpSteps === undefined ? {} : { maxCatchUpSteps: options.maxCatchUpSteps }),
  });
  return { loop, ticks };
}

describe('fixed timestep loop', () => {
  it('runs at 60Hz by default', () => {
    const { loop } = countingLoop();
    expect(loop.hz).toBe(TICK_HZ);
    expect(loop.stepMs).toBe(TICK_MS);
  });

  it('runs one step per tick length of real time', () => {
    const { loop, ticks } = countingLoop();
    expect(loop.advance(TICK_MS)).toBe(1);
    expect(loop.advance(TICK_MS)).toBe(1);
    expect(ticks).toEqual([1, 2]);
    expect(loop.tick).toBe(2);
  });

  it('holds the step until a whole tick of time has arrived', () => {
    const { loop, ticks } = countingLoop();
    expect(loop.advance(8)).toBe(0);
    expect(ticks).toEqual([]);
    expect(loop.advance(8)).toBe(0);
    expect(loop.advance(1)).toBe(1);
    expect(ticks).toEqual([1]);
  });

  // The drift this prevents: 1000/60 is not representable in binary floating
  // point, so an accumulator that subtracts it 36,000 times is measurably off.
  // Ten minutes of real time must be exactly 36,000 ticks, not 35,999.
  // The drift this prevents: 1000/60 is not representable in binary floating
  // point, so an accumulator that subtracts it every step accumulates error
  // that grows with the length of the session. Deriving the target tick from
  // total elapsed time instead means the error never exceeds one tick, however
  // long the run - which is what these two assertions say. The bound is the
  // same after an hour as after ten minutes.
  it('stays within one tick of real time over ten minutes', () => {
    const { loop } = countingLoop({ maxCatchUpSteps: 4 });
    for (let frame = 0; frame < 36_000; frame += 1) {
      loop.advance(TICK_MS);
    }
    expect(Math.abs(loop.tick - 36_000)).toBeLessThanOrEqual(1);
    expect(loop.stalls).toBe(0);
    expect(loop.droppedMs).toBe(0);
  });

  it('stays within one tick of real time over an hour', () => {
    const { loop } = countingLoop();
    for (let frame = 0; frame < 216_000; frame += 1) {
      loop.advance(TICK_MS);
    }
    expect(Math.abs(loop.tick - 216_000)).toBeLessThanOrEqual(1);
    expect(loop.stalls).toBe(0);
  });

  it('stays within one tick under a 144Hz render rate', () => {
    // 2.4 render frames per simulation step: the common case for a player with
    // a good monitor, and the ratio where accumulated error shows up first.
    const { loop } = countingLoop();
    const frameMs = 1000 / 144;
    for (let frame = 0; frame < 144 * 60; frame += 1) {
      loop.advance(frameMs);
    }
    expect(Math.abs(loop.tick - 60 * 60)).toBeLessThanOrEqual(1);
  });

  it('caps catch-up after a five second stall', () => {
    // 5000 ms is 300 steps of honest debt. Running them would take longer than
    // a frame, which produces another stall, which produces another 300 steps.
    const { loop, ticks } = countingLoop();
    const steps = loop.advance(5000);

    expect(steps).toBe(DEFAULT_MAX_CATCH_UP_STEPS);
    expect(ticks.length).toBe(DEFAULT_MAX_CATCH_UP_STEPS);
    expect(loop.stalls).toBe(1);
    expect(loop.droppedMs).toBeCloseTo(5000 - DEFAULT_MAX_CATCH_UP_STEPS * TICK_MS, 6);
  });

  it('returns to normal after a stall instead of spiralling', () => {
    // Without re-basing the clock, the dropped time stays owed and every later
    // frame runs the capped number of steps forever.
    const { loop } = countingLoop();
    loop.advance(5000);
    const afterStall = loop.tick;
    let stepsRun = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      // Without the re-base this would be the cap, 5, on every one of these
      // frames, forever. With it, a normal frame buys a normal step.
      const steps = loop.advance(TICK_MS);
      expect(steps).toBeLessThanOrEqual(2);
      stepsRun += steps;
    }
    expect(Math.abs(stepsRun - 60)).toBeLessThanOrEqual(1);
    expect(loop.tick).toBe(afterStall + stepsRun);
    expect(loop.stalls).toBe(1);
  });

  it('survives a minute of five second stalls without unbounded work', () => {
    const { loop } = countingLoop();
    for (let i = 0; i < 12; i += 1) {
      expect(loop.advance(5000)).toBeLessThanOrEqual(DEFAULT_MAX_CATCH_UP_STEPS);
    }
    expect(loop.tick).toBe(12 * DEFAULT_MAX_CATCH_UP_STEPS);
  });

  it('ignores a backwards or broken clock', () => {
    const { loop, ticks } = countingLoop();
    expect(loop.advance(-100)).toBe(0);
    expect(loop.advance(0)).toBe(0);
    expect(loop.advance(Number.NaN)).toBe(0);
    expect(loop.advance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(ticks).toEqual([]);
    expect(loop.tick).toBe(0);
  });

  it('reports interpolation alpha in [0, 1)', () => {
    const { loop } = countingLoop();
    expect(loop.alpha).toBe(0);
    loop.advance(TICK_MS / 2);
    expect(loop.alpha).toBeCloseTo(0.5, 9);
    loop.advance(TICK_MS / 2);
    expect(loop.tick).toBe(1);
    expect(loop.alpha).toBeLessThan(1);
    expect(loop.alpha).toBeGreaterThanOrEqual(0);

    // After a capped stall the clock is re-based, so alpha stays in range
    // rather than reporting the hundreds of frames of discarded debt.
    loop.advance(5000);
    expect(loop.alpha).toBeGreaterThanOrEqual(0);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('reports simulated time derived from the tick count, not the clock', () => {
    const { loop } = countingLoop();
    loop.advance(5000);
    expect(loop.simulatedMs).toBeCloseTo(DEFAULT_MAX_CATCH_UP_STEPS * TICK_MS, 9);
  });

  it('runs an exact step count with no reference to real time', () => {
    const { loop, ticks } = countingLoop();
    loop.run(10_000);
    expect(loop.tick).toBe(10_000);
    expect(ticks.length).toBe(10_000);
    expect(ticks[0]).toBe(1);
    expect(ticks[9_999]).toBe(10_000);
    expect(loop.stalls).toBe(0);
    // A headless run leaves the clock consistent, so a run can hand over to a
    // rendered session without a jump.
    expect(loop.simulatedMs).toBeCloseTo((10_000 * 1000) / TICK_HZ, 6);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('runs at a non-default rate', () => {
    const { loop } = countingLoop({ hz: 30 });
    expect(loop.stepMs).toBeCloseTo(1000 / 30, 9);
    for (let frame = 0; frame < 300; frame += 1) {
      loop.advance(1000 / 30);
    }
    expect(loop.tick).toBe(300);
  });

  it('resets the clock without touching simulation state', () => {
    const { loop } = countingLoop();
    loop.advance(5000);
    loop.reset();
    expect(loop.tick).toBe(0);
    expect(loop.droppedMs).toBe(0);
    expect(loop.stalls).toBe(0);
    expect(loop.alpha).toBe(0);
  });

  it('rejects a nonsense configuration', () => {
    const step = (): void => undefined;
    expect(() => new FixedLoop({ step, hz: 0 })).toThrow(RangeError);
    expect(() => new FixedLoop({ step, hz: -60 })).toThrow(RangeError);
    expect(() => new FixedLoop({ step, maxCatchUpSteps: 0 })).toThrow(RangeError);
    expect(() => new FixedLoop({ step, maxCatchUpSteps: 1.5 })).toThrow(RangeError);
    expect(() => new FixedLoop({ step }).run(-1)).toThrow(RangeError);
    expect(() => new FixedLoop({ step }).run(1.5)).toThrow(RangeError);
  });
});
