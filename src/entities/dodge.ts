/**
 * The dodge: three pips, a dash with invulnerable frames, and a recharge
 * (GDD 4.4).
 *
 * This is the other half of "PP is gone". GDD 4.4 names what replaces it in
 * two parts -- cooldowns on moves, which live in `combat/moves.ts`, and
 * **Stamina, a 3-pip dodge meter**, which is this file. The pips are the
 * resource the player actually manages: a move comes back on its own whether
 * you like it or not, but a pip spent is a pip you do not have when the next
 * thing swings at you.
 *
 * The dash is a state machine over a single tick counter, and the counter is
 * the whole design:
 *
 *   elapsed:  0 1 2 3 | 4 5 6 7 8 | 9 10 11 12 13 | 14 ... 21 | idle
 *   phase:    startup | iframes   | recovery      | lockout   |
 *   hittable: yes     | NO        | yes           | yes       | yes
 *   moving:   yes     | yes       | yes           | no        | under control
 *
 * **The invulnerable window is a slice of the dash, not the dash.** That is
 * the single most important line in this file and the thing `dodge.test.ts`
 * exists to pin. A dash that were invulnerable end to end would make the
 * correct play "always be dashing": there would be no timing to learn, and the
 * defensive verb would collapse into a movement ability. A vulnerable start-up
 * means panicking late does not save you, and a vulnerable recovery means the
 * dash has a cost you can be punished for -- which is what makes reading the
 * enemy's telegraph (GDD 4.1) worth anything.
 *
 * Two things derive from the species' Speed stat, as GDD 4.4 requires. Neither
 * invents a new formula: the dash distance is stated in *seconds of walking*,
 * so it falls straight out of `moveSpeedPixelsPerSecond`, and the recharge
 * drains at `cooldownRate`, the same multiplier a move cooldown uses. A fast
 * creature therefore covers more ground per dash and gets its pips back
 * sooner, which is GDD 4.4's "fast frail Pokemon as a dodge build" without a
 * third Speed curve to balance.
 *
 * Pure: no Phaser, no DOM, no clock, no random. The whole machine is a handful
 * of integers, so a run replays bit for bit (`core/world.ts`) and the balance
 * harness in GDD 9.3 can drive it headless.
 */

import { TICK_HZ } from '@/core/constants';
import type { World } from '@/core/world';
import { cooldownRate, moveSpeedPixelsPerSecond } from '@/combat/stats';
import type { Vec2 } from './playerInput';
import {
  DODGE_DISTANCE_SECONDS,
  DODGE_IFRAME_TICKS,
  DODGE_LOCKOUT_TICKS,
  DODGE_PIP_MAX,
  DODGE_PIP_RECHARGE_SECONDS,
  DODGE_RECOVERY_TICKS,
  DODGE_STARTUP_TICKS,
} from './tuning';

/** Not dashing. A pip press will be taken. */
export const DODGE_IDLE = 0;
/** Moving, vulnerable. The commitment window. */
export const DODGE_STARTUP = 1;
/** Moving, cannot be targeted. The reward. */
export const DODGE_IFRAMES = 2;
/** Moving, vulnerable again. The cost. */
export const DODGE_RECOVERY = 3;
/** Not moving under the dash, and a press is refused. The inter-dash gap. */
export const DODGE_LOCKOUT = 4;

export type DodgePhase =
  | typeof DODGE_IDLE
  | typeof DODGE_STARTUP
  | typeof DODGE_IFRAMES
  | typeof DODGE_RECOVERY
  | typeof DODGE_LOCKOUT;

/** Phase names, for the readout and for a test failure that says something. */
export const DODGE_PHASE_NAMES: readonly string[] = [
  'idle',
  'startup',
  'iframes',
  'recovery',
  'lockout',
];

/** Ticks the body is in the air: start-up, invulnerable window, recovery. */
export const DODGE_DASH_TICKS = DODGE_STARTUP_TICKS + DODGE_IFRAME_TICKS + DODGE_RECOVERY_TICKS;

/** First and last `elapsed` tick of the invulnerable window, inclusive. */
export const DODGE_IFRAME_FIRST_TICK = DODGE_STARTUP_TICKS;
export const DODGE_IFRAME_LAST_TICK = DODGE_STARTUP_TICKS + DODGE_IFRAME_TICKS - 1;

/** Ticks from one press to the earliest next one. */
export const DODGE_CYCLE_TICKS = DODGE_DASH_TICKS + DODGE_LOCKOUT_TICKS;

/** `elapsed` when nothing is running. */
const NOT_DASHING = -1;

/**
 * The phase for a tick count since the press. Exported because it is the
 * cheapest possible statement of the layout, and a test that reads the layout
 * off the same function the machine uses would be proving nothing -- so
 * `dodge.test.ts` asserts against the phases observed from `step` instead, and
 * uses this only to label them.
 */
export function dodgePhaseAt(elapsed: number): DodgePhase {
  if (elapsed < 0) {
    return DODGE_IDLE;
  }
  if (elapsed < DODGE_STARTUP_TICKS) {
    return DODGE_STARTUP;
  }
  if (elapsed <= DODGE_IFRAME_LAST_TICK) {
    return DODGE_IFRAMES;
  }
  if (elapsed < DODGE_DASH_TICKS) {
    return DODGE_RECOVERY;
  }
  if (elapsed < DODGE_CYCLE_TICKS) {
    return DODGE_LOCKOUT;
  }
  return DODGE_IDLE;
}

/**
 * One tick of intent, as the meter reads it.
 *
 * Split out from `World` so the machine stays pure and so an enemy that learns
 * to dodge later (GDD 4.7) feeds it the same struct with AI numbers in it.
 */
export interface DodgeIntent {
  /** The dodge button this tick. Edges are found here, not by the caller. */
  readonly wantsDodge: boolean;
  /** Direction of travel asked for by the keys: unit, or zero when standing. */
  readonly moveX: number;
  readonly moveY: number;
  /** Where the creature is pointing. Unit. Used only when standing still. */
  readonly aimX: number;
  readonly aimY: number;
}

export interface DodgeSpec {
  /**
   * The species' base Speed stat, from `data/species.json`. Decides the dash
   * distance and the recharge rate (GDD 4.4). A number rather than a species
   * row, for the same reason `PlayerSpec` takes one: the simulation must not
   * depend on the content loader.
   */
  readonly speedStat: number;
}

export class DodgeMeter {
  /** World units one uninterrupted dash covers. From the Speed stat. */
  readonly dashDistance: number;

  /** World units per second while dashing. Constant across the dash. */
  readonly dashSpeed: number;

  /** Seconds of recharge drained per tick (GDD 4.4's `cooldownRate`). */
  private readonly rechargePerTick: number;

  /**
   * The snap tolerance on the recharge timer. Same problem and same answer as
   * `MoveCaster.drainCooldowns`: `2 - 120 * (2/120)` is a few times 1e-16 in
   * binary floating point, not zero, so without the snap the pip lands a tick
   * late and `rechargeProgress` never quite reaches 1 -- which the player sees
   * as a HUD pip that fills and then hangs there for a frame before popping.
   */
  private readonly rechargeEpsilon: number;

  private pipsLeft = DODGE_PIP_MAX;

  /** Seconds left before the next pip returns. Zero when none is pending. */
  private rechargeLeft = 0;

  /** Ticks since the press that began the current dash, or `NOT_DASHING`. */
  private elapsed = NOT_DASHING;

  /** Last tick's button, so the dodge triggers on the press and not on hold. */
  private heldLast = false;

  /** The locked dash direction. Unit while dashing. */
  private readonly direction: Vec2 = { x: 0, y: 1 };

  /** Dashes begun since construction. For the readout and for tests. */
  private dashes = 0;

  constructor(spec: DodgeSpec) {
    const topSpeed = moveSpeedPixelsPerSecond(spec.speedStat);

    // Distance stated as seconds of walking, so Speed carries into the dash
    // through the formula that already exists rather than through a new one.
    this.dashDistance = topSpeed * DODGE_DISTANCE_SECONDS;

    // The dash covers that distance in exactly `DODGE_DASH_TICKS` integrations
    // of `v / TICK_HZ`, which is what makes the travelled distance an exact
    // number a test can assert rather than an approximation.
    this.dashSpeed = this.dashDistance / (DODGE_DASH_TICKS / TICK_HZ);

    this.rechargePerTick = cooldownRate(spec.speedStat) / TICK_HZ;
    this.rechargeEpsilon = this.rechargePerTick * 1e-6;
  }

  /** Pips available to spend, 0..`DODGE_PIP_MAX`. */
  get pips(): number {
    return this.pipsLeft;
  }

  get phase(): DodgePhase {
    return dodgePhaseAt(this.elapsed);
  }

  /** True while the dash owns the velocity: start-up, i-frames or recovery. */
  get isDashing(): boolean {
    return this.elapsed >= 0 && this.elapsed < DODGE_DASH_TICKS;
  }

  /**
   * True only inside the invulnerable window. The player's controller turns
   * this into the registry's hittable flag, so no damage source can forget it.
   */
  get isInvulnerable(): boolean {
    return this.phase === DODGE_IFRAMES;
  }

  /** True while a press would be refused because the last dash is too recent. */
  get isLockedOut(): boolean {
    return this.phase === DODGE_LOCKOUT;
  }

  /** Dashes begun. */
  get dashCount(): number {
    return this.dashes;
  }

  /**
   * How full the pip currently recharging is, 0 to 1, for the HUD.
   *
   * 1 when the meter is full and nothing is pending, so a caller that draws
   * `pips` solid blocks plus one partial never has to special-case the top.
   */
  rechargeProgress(): number {
    if (this.rechargeLeft <= 0) {
      return 1;
    }

    return Math.max(0, Math.min(1, 1 - this.rechargeLeft / DODGE_PIP_RECHARGE_SECONDS));
  }

  /**
   * How far through the dash the body is, 0 to 1. Zero when not dashing.
   * For the renderer; the simulation reads the phase instead.
   */
  dashProgress(): number {
    if (!this.isDashing) {
      return 0;
    }

    return this.elapsed / DODGE_DASH_TICKS;
  }

  /**
   * Writes the dash velocity into `out` and returns true, or returns false and
   * leaves `out` alone when the dash is not driving the body.
   *
   * The same shape as `aimDirection` in `playerInput.ts`: a boolean and an
   * out-param, so a per-tick call allocates nothing.
   */
  dashVelocity(out: Vec2): boolean {
    if (!this.isDashing) {
      return false;
    }

    out.x = this.direction.x * this.dashSpeed;
    out.y = this.direction.y * this.dashSpeed;
    return true;
  }

  /**
   * One simulation step.
   *
   * The order inside is load-bearing:
   *
   * 1. **Recharge first**, so the pip that comes back on this tick is
   *    spendable on this tick. The alternative loses one frame of input on the
   *    exact press the player cared most about.
   * 2. **Advance the running dash**, so a lockout that expires on this tick
   *    has expired by the time the press is read.
   * 3. **Then read the press.** A dash begun here has `elapsed === 0` and so
   *    is already in its first start-up frame, which is what makes a dash
   *    `DODGE_DASH_TICKS` long rather than one tick longer -- the same
   *    convention `MoveCaster` uses for a cast.
   */
  step(intent: DodgeIntent): void {
    this.recharge();
    this.advance();

    const pressed = intent.wantsDodge && !this.heldLast;
    this.heldLast = intent.wantsDodge;

    if (pressed) {
      this.tryStart(intent);
    }
  }

  /**
   * Refills the meter and cancels any dash. The hook a floor transition or a
   * death-and-restart hangs on; also what a test uses to get back to a known
   * state without building a second meter.
   */
  reset(): void {
    this.pipsLeft = DODGE_PIP_MAX;
    this.rechargeLeft = 0;
    this.elapsed = NOT_DASHING;
    this.heldLast = false;
  }

  /**
   * Begins a dash if there is a pip and the lockout has expired.
   *
   * Returns whether it started. Public so a test can assert the refusal
   * directly, and so a later ability that grants a free dash has a door in.
   */
  tryStart(intent: DodgeIntent): boolean {
    if (this.elapsed !== NOT_DASHING || this.pipsLeft <= 0) {
      return false;
    }

    if (!this.chooseDirection(intent)) {
      return false;
    }

    this.spendPip();
    this.elapsed = 0;
    this.dashes += 1;
    return true;
  }

  /**
   * Locks the dash direction: **where you are walking, or where you are aiming
   * when you are not walking.**
   *
   * That choice, and not the other way round, because the dodge is a
   * repositioning tool first. A player holding left and pressing dodge means
   * "left", unambiguously, and making them also swing the mouse there would
   * make the panic case a two-handed operation. Standing still is the only
   * case with no movement answer, and there the mouse is the only thing that
   * says anything about intent.
   *
   * The direction is fixed for the whole dash: steering mid-dash would remove
   * the commitment that makes a vulnerable recovery meaningful. The feel pass
   * (GDD 4.1) may revisit which input wins; it is one branch here.
   */
  private chooseDirection(intent: DodgeIntent): boolean {
    const useMove = intent.moveX !== 0 || intent.moveY !== 0;
    const x = useMove ? intent.moveX : intent.aimX;
    const y = useMove ? intent.moveY : intent.aimY;
    const length = Math.sqrt(x * x + y * y);

    if (!(length > 0)) {
      // Neither keys nor a usable aim. Refuse rather than dash in the last
      // direction: spending a pip on a direction the player did not choose is
      // worse than the button appearing not to work.
      return false;
    }

    this.direction.x = x / length;
    this.direction.y = y / length;
    return true;
  }

  /**
   * Takes a pip, and starts the recharge timer only if it was not already
   * running.
   *
   * This is the rule the plan calls out: pips come back **one at a time**.
   * Restarting the timer on every spend would mean dodging twice in quick
   * succession also pushed back the first pip's return, so the second dash
   * would cost one pip and part of another -- a hidden penalty the HUD could
   * not show. Leaving the in-flight timer alone means three dashes cost three
   * pips and nothing more, and the meter refills on a steady beat the player
   * can count.
   */
  private spendPip(): void {
    this.pipsLeft -= 1;

    if (this.rechargeLeft <= 0) {
      this.rechargeLeft = DODGE_PIP_RECHARGE_SECONDS;
    }
  }

  /** Drains the recharge timer and returns one pip when it empties. */
  private recharge(): void {
    if (this.pipsLeft >= DODGE_PIP_MAX || this.rechargeLeft <= 0) {
      return;
    }

    const next = this.rechargeLeft - this.rechargePerTick;

    if (next > this.rechargeEpsilon) {
      this.rechargeLeft = next;
      return;
    }

    this.pipsLeft += 1;

    // One at a time: the next pip's timer starts now, from full, rather than
    // every missing pip sharing one timer and arriving together.
    this.rechargeLeft = this.pipsLeft >= DODGE_PIP_MAX ? 0 : DODGE_PIP_RECHARGE_SECONDS;
  }

  /** Advances the dash-and-lockout counter, and ends it when it runs out. */
  private advance(): void {
    if (this.elapsed === NOT_DASHING) {
      return;
    }

    this.elapsed += 1;

    if (this.elapsed >= DODGE_CYCLE_TICKS) {
      this.elapsed = NOT_DASHING;
    }
  }
}

/**
 * The dodge intent for a player-controlled creature, from one frame of input.
 *
 * Companion to `fireHeld` in `combat/moves.ts`, here for the same reason: it
 * is the simulation's reading of a mapped button, and the headless harness in
 * GDD 9.3 needs it with no browser attached. Which physical button sets the
 * bit is `render/deviceInput.ts`.
 */
export function dodgeHeld(world: World, dodgeButton: number): boolean {
  return (world.input.buttons & dodgeButton) !== 0;
}
