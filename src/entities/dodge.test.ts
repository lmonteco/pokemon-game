import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@/core/constants';
import { cooldownRate, moveSpeedPixelsPerSecond } from '@/combat/stats';
import {
  DODGE_CYCLE_TICKS,
  DODGE_DASH_TICKS,
  DODGE_IDLE,
  DODGE_IFRAMES,
  DODGE_LOCKOUT,
  DODGE_PHASE_NAMES,
  DODGE_RECOVERY,
  DODGE_STARTUP,
  DodgeMeter,
  type DodgeIntent,
} from './dodge';
import {
  DODGE_DISTANCE_SECONDS,
  DODGE_IFRAME_TICKS,
  DODGE_LOCKOUT_TICKS,
  DODGE_PIP_MAX,
  DODGE_PIP_RECHARGE_SECONDS,
  DODGE_RECOVERY_TICKS,
  DODGE_STARTUP_TICKS,
} from './tuning';

/**
 * The dodge state machine (GDD 4.4).
 *
 * The one assertion this file exists for is **the i-frame window is a slice of
 * the dash, not the dash**. Everything else here guards a rule that would
 * otherwise rot silently: a pip accounting bug shows up as the meter being
 * generous, which nobody reports as a bug, and a lockout that stops working
 * shows up as the game feeling good for the person mashing.
 *
 * The phases are read from `step`, tick by tick, rather than from
 * `dodgePhaseAt` -- asserting a layout against the function that defines it
 * would prove nothing. What is checked is the sequence an input actually
 * produces.
 */

/** Mid-tier Speed, so no clamp or pivot is special-casing the numbers. */
const TEST_SPEED_STAT = 65;

function intent(overrides: Partial<DodgeIntent> = {}): DodgeIntent {
  return { wantsDodge: false, moveX: 0, moveY: 0, aimX: 0, aimY: 1, ...overrides };
}

/** One tick with the dodge button down, moving right. */
const PRESS = intent({ wantsDodge: true, moveX: 1, moveY: 0 });

/** One tick with nothing held, moving right. */
const RELEASE = intent({ moveX: 1, moveY: 0 });

function meter(speedStat = TEST_SPEED_STAT): DodgeMeter {
  return new DodgeMeter({ speedStat });
}

/** Steps `ticks` times with the same intent. */
function hold(dodge: DodgeMeter, ticks: number, held: DodgeIntent = RELEASE): void {
  for (let i = 0; i < ticks; i += 1) {
    dodge.step(held);
  }
}

/**
 * One tap: press for a tick, then release. Returns the meter so a test reads
 * as the thing it is about.
 */
function tap(dodge: DodgeMeter): DodgeMeter {
  dodge.step(PRESS);
  dodge.step(RELEASE);
  return dodge;
}

/** The phase observed on each of `ticks` ticks after a press. */
function phasesAfterPress(dodge: DodgeMeter, ticks: number): number[] {
  const seen: number[] = [];

  dodge.step(PRESS);
  seen.push(dodge.phase);

  for (let i = 1; i < ticks; i += 1) {
    dodge.step(RELEASE);
    seen.push(dodge.phase);
  }

  return seen;
}

/** Readable in a failure message. */
function named(phases: readonly number[]): string[] {
  return phases.map((phase) => DODGE_PHASE_NAMES[phase] ?? `?${phase}`);
}

describe('the invulnerable window', () => {
  it('is a window inside the dash, with both ends exposed', () => {
    const dodge = meter();
    const phases = phasesAfterPress(dodge, DODGE_DASH_TICKS);

    // The three parts, in order, with the exact widths from `tuning.ts`. This
    // is the acceptance criterion: a dash that were invulnerable end to end
    // would be a single repeated phase here.
    expect(named(phases)).toEqual([
      ...Array.from({ length: DODGE_STARTUP_TICKS }, () => 'startup'),
      ...Array.from({ length: DODGE_IFRAME_TICKS }, () => 'iframes'),
      ...Array.from({ length: DODGE_RECOVERY_TICKS }, () => 'recovery'),
    ]);
  });

  it('leaves the player hittable on the first and the last tick of the dash', () => {
    const dodge = meter();

    dodge.step(PRESS);
    expect(dodge.isDashing).toBe(true);
    expect(dodge.isInvulnerable).toBe(false);

    // To the final dash tick.
    hold(dodge, DODGE_DASH_TICKS - 1);
    expect(dodge.isDashing).toBe(true);
    expect(dodge.isInvulnerable).toBe(false);
  });

  it('covers less than half the dash, so dashing is not strictly safe', () => {
    const dodge = meter();
    const phases = phasesAfterPress(dodge, DODGE_DASH_TICKS);
    const invulnerable = phases.filter((phase) => phase === DODGE_IFRAMES).length;

    expect(invulnerable).toBe(DODGE_IFRAME_TICKS);
    expect(invulnerable).toBeLessThan(DODGE_DASH_TICKS - invulnerable);
  });

  it('is one unbroken run, so the dash cannot flicker in and out of cover', () => {
    const dodge = meter();
    const phases = phasesAfterPress(dodge, DODGE_CYCLE_TICKS);
    const first = phases.indexOf(DODGE_IFRAMES);
    const last = phases.lastIndexOf(DODGE_IFRAMES);

    expect(first).toBeGreaterThan(0);
    expect(phases.slice(first, last + 1).every((phase) => phase === DODGE_IFRAMES)).toBe(true);
  });

  it('is over before the dash is, and the dash before the lockout', () => {
    const dodge = meter();
    const phases = phasesAfterPress(dodge, DODGE_CYCLE_TICKS + 1);

    expect(phases[DODGE_DASH_TICKS - 1]).toBe(DODGE_RECOVERY);
    expect(phases[DODGE_DASH_TICKS]).toBe(DODGE_LOCKOUT);
    expect(phases[DODGE_CYCLE_TICKS - 1]).toBe(DODGE_LOCKOUT);
    expect(phases[DODGE_CYCLE_TICKS]).toBe(DODGE_IDLE);
  });

  it('is the only thing `isInvulnerable` ever reports, across a whole cycle', () => {
    const dodge = meter();
    const safe: number[] = [];

    // Read from the accessor a damage system would call, not from the phase:
    // the two could drift, and the accessor is the one that matters.
    dodge.step(PRESS);
    if (dodge.isInvulnerable) {
      safe.push(0);
    }

    for (let tick = 1; tick < DODGE_CYCLE_TICKS * 2; tick += 1) {
      dodge.step(RELEASE);
      if (dodge.isInvulnerable) {
        safe.push(tick);
      }
    }

    expect(safe).toEqual(
      Array.from({ length: DODGE_IFRAME_TICKS }, (_unused, i) => DODGE_STARTUP_TICKS + i),
    );
  });
});

describe('the dash itself', () => {
  it('starts moving on the tick of the press, so it reads as instant', () => {
    const dodge = meter();
    const velocity = { x: 0, y: 0 };

    expect(dodge.dashVelocity(velocity)).toBe(false);

    dodge.step(PRESS);

    expect(dodge.dashVelocity(velocity)).toBe(true);
    expect(velocity.x).toBeCloseTo(dodge.dashSpeed, 9);
    expect(velocity.y).toBeCloseTo(0, 9);
  });

  it('drives the body for the whole dash and then hands it back', () => {
    const dodge = meter();
    const velocity = { x: 0, y: 0 };

    dodge.step(PRESS);

    for (let tick = 1; tick < DODGE_DASH_TICKS; tick += 1) {
      dodge.step(RELEASE);
      expect(dodge.dashVelocity(velocity), `tick ${tick}`).toBe(true);
    }

    dodge.step(RELEASE);
    expect(dodge.isDashing).toBe(false);
    expect(dodge.dashVelocity(velocity)).toBe(false);
  });

  it('covers the GDD 4.4 distance: seconds of walking, from the Speed stat', () => {
    const dodge = meter();
    const expected = moveSpeedPixelsPerSecond(TEST_SPEED_STAT) * DODGE_DISTANCE_SECONDS;

    expect(dodge.dashDistance).toBeCloseTo(expected, 9);

    // The distance has to be what the integration actually produces, not just
    // a field: the body advances `v / TICK_HZ` once per tick, for the whole
    // dash. Integrating it here is what keeps the two in step.
    const velocity = { x: 0, y: 0 };
    let travelled = 0;

    dodge.step(PRESS);
    do {
      if (!dodge.dashVelocity(velocity)) {
        break;
      }
      travelled += Math.hypot(velocity.x, velocity.y) / TICK_HZ;
      dodge.step(RELEASE);
    } while (dodge.isDashing);

    expect(travelled).toBeCloseTo(dodge.dashDistance, 9);
  });

  it('is faster than walking, by enough to read as a burst', () => {
    const dodge = meter();
    const walk = moveSpeedPixelsPerSecond(TEST_SPEED_STAT);

    expect(dodge.dashSpeed).toBeGreaterThan(walk * 2);
  });

  it('goes further for a faster species, as GDD 4.4 requires', () => {
    expect(meter(150).dashDistance).toBeGreaterThan(meter(50).dashDistance);
  });

  it('holds its direction for the whole dash, however the keys move', () => {
    const dodge = meter();
    const velocity = { x: 0, y: 0 };

    dodge.step(PRESS);
    dodge.step(intent({ moveX: -1, moveY: 0 }));
    dodge.step(intent({ moveX: 0, moveY: -1 }));
    dodge.dashVelocity(velocity);

    expect(velocity.x).toBeCloseTo(dodge.dashSpeed, 9);
    expect(velocity.y).toBeCloseTo(0, 9);
  });
});

describe('the dash direction', () => {
  it('follows the keys when the player is moving', () => {
    const dodge = meter();
    const velocity = { x: 0, y: 0 };

    // Walking up, aiming down: the keys win.
    dodge.step(intent({ wantsDodge: true, moveX: 0, moveY: -1, aimX: 0, aimY: 1 }));
    dodge.dashVelocity(velocity);

    expect(velocity.y).toBeCloseTo(-dodge.dashSpeed, 9);
  });

  it('follows the aim when the player is standing still', () => {
    const dodge = meter();
    const velocity = { x: 0, y: 0 };

    dodge.step(intent({ wantsDodge: true, aimX: -1, aimY: 0 }));
    dodge.dashVelocity(velocity);

    expect(velocity.x).toBeCloseTo(-dodge.dashSpeed, 9);
  });

  it('normalises a diagonal, so a diagonal dash is not longer', () => {
    const dodge = meter();
    const velocity = { x: 0, y: 0 };

    dodge.step(intent({ wantsDodge: true, moveX: 1, moveY: 1 }));
    dodge.dashVelocity(velocity);

    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(dodge.dashSpeed, 9);
  });

  it('refuses rather than spending a pip on a direction nobody chose', () => {
    const dodge = meter();

    dodge.step(intent({ wantsDodge: true, aimX: 0, aimY: 0 }));

    expect(dodge.isDashing).toBe(false);
    expect(dodge.pips).toBe(DODGE_PIP_MAX);
  });
});

describe('the pips', () => {
  it('starts full', () => {
    expect(meter().pips).toBe(DODGE_PIP_MAX);
  });

  it('costs exactly one pip per dash', () => {
    const dodge = meter();

    for (let spent = 1; spent <= DODGE_PIP_MAX; spent += 1) {
      tap(dodge);
      expect(dodge.pips, `after ${spent} dashes`).toBe(DODGE_PIP_MAX - spent);
      hold(dodge, DODGE_CYCLE_TICKS);
    }
  });

  it('refuses to dash on an empty meter', () => {
    const dodge = meter();

    for (let i = 0; i < DODGE_PIP_MAX; i += 1) {
      tap(dodge);
      hold(dodge, DODGE_CYCLE_TICKS);
    }

    expect(dodge.pips).toBe(0);

    const before = dodge.dashCount;
    tap(dodge);

    expect(dodge.dashCount).toBe(before);
    expect(dodge.isDashing).toBe(false);
  });

  it('comes back one at a time, not all at once', () => {
    const dodge = meter();
    const perPip = Math.ceil(
      (DODGE_PIP_RECHARGE_SECONDS / cooldownRate(TEST_SPEED_STAT)) * TICK_HZ,
    );

    for (let i = 0; i < DODGE_PIP_MAX; i += 1) {
      tap(dodge);
      hold(dodge, DODGE_CYCLE_TICKS);
    }

    // The ticks spent waiting out the lockouts above already paid for some of
    // the recharge, so this asserts the shape rather than an absolute tick:
    // after one more recharge period there is at most one further pip, never
    // the whole meter.
    const start = dodge.pips;

    hold(dodge, perPip);
    expect(dodge.pips).toBeLessThanOrEqual(start + 1);

    hold(dodge, perPip);
    expect(dodge.pips).toBeLessThanOrEqual(start + 2);
  });

  it('returns the first pip exactly one recharge period after it is spent', () => {
    const dodge = meter();
    const perPip = (DODGE_PIP_RECHARGE_SECONDS / cooldownRate(TEST_SPEED_STAT)) * TICK_HZ;
    const whole = Math.ceil(perPip);

    tap(dodge);
    expect(dodge.pips).toBe(DODGE_PIP_MAX - 1);

    // Two ticks were already spent on the tap, so stop two short of the
    // period and the pip must still be out.
    hold(dodge, whole - 3);
    expect(dodge.pips).toBe(DODGE_PIP_MAX - 1);

    hold(dodge, 2);
    expect(dodge.pips).toBe(DODGE_PIP_MAX);
  });

  it('does not push back a pip already on its way when another is spent', () => {
    const dodge = meter();
    const perPip = Math.ceil(
      (DODGE_PIP_RECHARGE_SECONDS / cooldownRate(TEST_SPEED_STAT)) * TICK_HZ,
    );

    tap(dodge);
    hold(dodge, DODGE_CYCLE_TICKS);

    const progressBeforeSecondDash = dodge.rechargeProgress();

    tap(dodge);

    // The second spend must not have reset the first pip's timer: a dash that
    // cost one pip plus part of another would be a penalty the HUD cannot show.
    expect(dodge.rechargeProgress()).toBeGreaterThan(progressBeforeSecondDash);
    expect(dodge.pips).toBe(DODGE_PIP_MAX - 2);

    // And the first pip still lands on its own schedule.
    hold(dodge, perPip);
    expect(dodge.pips).toBeGreaterThanOrEqual(DODGE_PIP_MAX - 1);
  });

  it('recharges faster for a faster species, as GDD 4.4 requires', () => {
    const quick = tap(meter(150));
    const slow = tap(meter(50));

    hold(quick, 60);
    hold(slow, 60);

    expect(quick.rechargeProgress()).toBeGreaterThan(slow.rechargeProgress());
  });

  it('reports a full meter as a full pip, so the HUD needs no special case', () => {
    expect(meter().rechargeProgress()).toBe(1);
  });

  it('never exceeds the maximum, however long it is left alone', () => {
    const dodge = meter();

    tap(dodge);
    hold(dodge, TICK_HZ * 30);

    expect(dodge.pips).toBe(DODGE_PIP_MAX);
    expect(dodge.rechargeProgress()).toBe(1);
  });
});

describe('the lockout', () => {
  it('refuses a second dash until it expires', () => {
    const dodge = meter();

    // `tap` leaves `elapsed` at 1, so this lands on the first lockout tick.
    tap(dodge);
    hold(dodge, DODGE_DASH_TICKS - 1);
    expect(dodge.isLockedOut).toBe(true);

    // Pressed while locked out: refused, and no pip taken.
    const pipsBefore = dodge.pips;
    dodge.step(PRESS);
    expect(dodge.dashCount).toBe(1);
    expect(dodge.pips).toBe(pipsBefore);

    // Out the rest of the lockout, then it takes.
    hold(dodge, DODGE_LOCKOUT_TICKS - 1);
    expect(dodge.isLockedOut).toBe(false);
    dodge.step(PRESS);
    expect(dodge.dashCount).toBe(2);
  });

  it('stops the whole meter being spent in three frames', () => {
    const dodge = meter();

    // Mash: press and release every other tick, for three dashes' worth of
    // ticks if there were no lockout at all.
    for (let i = 0; i < DODGE_DASH_TICKS; i += 1) {
      dodge.step(i % 2 === 0 ? PRESS : RELEASE);
    }

    expect(dodge.dashCount).toBe(1);
    expect(dodge.pips).toBe(DODGE_PIP_MAX - 1);
  });

  it('lets the meter be spent across the cycle, and no faster', () => {
    const dodge = meter();

    for (let i = 0; i < DODGE_CYCLE_TICKS * DODGE_PIP_MAX; i += 1) {
      dodge.step(i % 2 === 0 ? PRESS : RELEASE);
    }

    expect(dodge.dashCount).toBe(DODGE_PIP_MAX);
  });
});

describe('the press', () => {
  it('is an edge, so holding the button does not chain dashes', () => {
    const dodge = meter();

    // Held down continuously for several full cycles.
    hold(dodge, DODGE_CYCLE_TICKS * 3, PRESS);

    expect(dodge.dashCount).toBe(1);
    expect(dodge.pips).toBe(DODGE_PIP_MAX - 1);
  });

  it('takes a release and a fresh press to dash again', () => {
    const dodge = meter();

    hold(dodge, DODGE_CYCLE_TICKS, PRESS);
    expect(dodge.dashCount).toBe(1);

    dodge.step(RELEASE);
    dodge.step(PRESS);

    expect(dodge.dashCount).toBe(2);
  });

  it('is taken on the tick the lockout ends, losing no frame of input', () => {
    const dodge = meter();

    tap(dodge);

    // The cycle occupies ticks 0..CYCLE-1 after the press, so the earliest a
    // second press can be taken is the CYCLE'th tick. `tap` already spent two
    // of them, and the press below is itself the last one -- on that step the
    // counter runs out *before* the button is read, which is the no-lost-frame
    // ordering `step` documents.
    hold(dodge, DODGE_CYCLE_TICKS - 2);
    dodge.step(PRESS);

    expect(dodge.dashCount).toBe(2);
    expect(dodge.phase).toBe(DODGE_STARTUP);
  });
});

describe('reset', () => {
  it('refills the meter and cancels a dash in flight', () => {
    const dodge = meter();

    tap(dodge);
    expect(dodge.isDashing).toBe(true);

    dodge.reset();

    expect(dodge.pips).toBe(DODGE_PIP_MAX);
    expect(dodge.isDashing).toBe(false);
    expect(dodge.isInvulnerable).toBe(false);
    expect(dodge.phase).toBe(DODGE_IDLE);
  });
});
