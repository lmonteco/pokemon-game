/**
 * The move caster: cast windup, cooldown, and the decision to release a shape
 * (GDD 4.2, 4.4).
 *
 * **PP is gone and this file is where that shows.** GDD 4.4 says why: PP
 * rations a resource across a turn-based dungeon, and in real time it produces
 * stretches with no buttons to press. What replaces it is here -- a per-slot
 * cooldown in seconds, drained at a rate the Speed stat decides -- and there
 * is no use counter anywhere in the game.
 *
 * The shape of one cast, in order:
 *
 *   ready -> (fire held, slot off cooldown) -> casting for `cast` frames
 *         -> release the shape -> cooldown for `cooldown` seconds -> ready
 *
 * Three decisions in that chain worth stating:
 *
 * - **The aim is read at release, not at the start of the cast.** A six-frame
 *   windup that locked the aim on the first frame would punish the player for
 *   the mouse moving during a hundred milliseconds they cannot feel. Steering
 *   through a windup is also the thing that makes a long cast interesting
 *   rather than merely slow.
 * - **The cooldown starts at release, not at the start of the cast.** Otherwise
 *   a long cast would partly pay for its own cooldown, and `cast` would
 *   quietly be a discount on `cooldown` rather than a cost.
 * - **Holding fire is the same as clicking perfectly.** The caster acts on the
 *   button being *down*, not on the edge, so a shot leaves the moment the slot
 *   is ready. That is what makes "spam-clicking does nothing extra" true by
 *   construction rather than by a rule that has to be enforced: there is
 *   nothing extra to get.
 *
 * Nothing here reads a clock or an unseeded random, so a run replays bit for
 * bit (`core/world.ts`).
 */

import { TICK_HZ } from '@/core/constants';
import type { EntityId } from '@/core/entity-registry';
import type { World } from '@/core/world';
import type { Move } from '@/content/schema/index.ts';
import type { Vec2 } from '@/entities/playerInput';
import type { MoveRelease, MoveShapeTable } from './moveShapes';
import { cooldownRate } from './stats';

/** Move slots, the Game Boy constraint kept on purpose (GDD 4.2). */
export const MOVE_SLOTS = 4;

/** Nothing is being cast. */
export const CAST_IDLE = -1;

export interface MoveCasterSpec {
  /** Who is casting. Its registry position supplies the origin every tick. */
  readonly caster: EntityId;
  /**
   * The equipped moves, in slot order, straight out of `data/moves.json`.
   *
   * Rows, not ids: the caster reads `cooldown`, `cast` and the shape block off
   * them and knows nothing else about a move. Change a number in the JSON and
   * the behaviour changes with no code edit, which is the acceptance criterion
   * this parameter exists to satisfy.
   */
  readonly moves: readonly Move[];
  /** The shapes this caster can fire. See `moveShapes.ts`. */
  readonly shapes: MoveShapeTable;
  /**
   * The caster's base Speed stat (GDD 4.4). Decides the cooldown *rate*, which
   * is the second of the two jobs Speed has.
   */
  readonly speedStat: number;
  /**
   * The unit aim direction, owned by the caller and read fresh at release.
   *
   * A reference rather than a copy, so the caster allocates nothing and so the
   * player's latched aim (`entities/player.ts`) and an enemy's AI aim plug in
   * the same way.
   */
  readonly aim: Vec2;
}

export class MoveCaster {
  readonly caster: EntityId;
  readonly moves: readonly Move[];

  private readonly shapes: MoveShapeTable;
  private readonly aim: Vec2;

  /** Cooldown drain per tick, in seconds of cooldown (GDD 4.4). */
  private readonly drainPerTick: number;

  /** Seconds of cooldown left on each slot. Zero means ready. */
  private readonly cooldowns: Float64Array;

  /** The slot being cast, or `CAST_IDLE`. One cast at a time: it is the cost. */
  private castingSlot = CAST_IDLE;
  private castTicksLeft = 0;
  private castTicksTotal = 0;

  /** Which slot `step` will try to fire. */
  private selected = 0;

  /** Releases since construction, for tests and for the readout. */
  private shots = 0;

  constructor(spec: MoveCasterSpec) {
    if (spec.moves.length === 0) {
      throw new Error('a caster needs at least one move');
    }
    if (spec.moves.length > MOVE_SLOTS) {
      throw new Error(`a caster has ${MOVE_SLOTS} slots, got ${spec.moves.length} moves`);
    }

    spec.moves.forEach((move) => {
      if (spec.shapes[move.shape] === undefined) {
        throw new Error(`no runtime for shape "${move.shape}" (move "${move.id}")`);
      }
    });

    this.caster = spec.caster;
    this.moves = spec.moves;
    this.shapes = spec.shapes;
    this.aim = spec.aim;
    this.drainPerTick = cooldownRate(spec.speedStat) / TICK_HZ;
    this.cooldowns = new Float64Array(spec.moves.length);
  }

  /** The slot the fire button will use. */
  get selectedSlot(): number {
    return this.selected;
  }

  /**
   * Chooses the slot, as keys 1-4 will (GDD 4.1). Ignores a slot with no move
   * in it rather than throwing: an empty slot is a normal state for a Pokemon
   * that has not learned four moves.
   */
  select(slot: number): void {
    if (Number.isInteger(slot) && slot >= 0 && slot < this.moves.length) {
      this.selected = slot;
    }
  }

  /** Total shapes released. */
  get shotCount(): number {
    return this.shots;
  }

  /** True while a windup is running. */
  get isCasting(): boolean {
    return this.castingSlot !== CAST_IDLE;
  }

  /** Seconds of cooldown left on a slot. */
  cooldownRemaining(slot: number): number {
    return this.cooldowns[slot] ?? 0;
  }

  /**
   * How ready a slot is, 0 to 1, for the HUD. 1 is ready to fire.
   *
   * A fraction rather than the raw seconds, because a cooldown bar should read
   * the same whether the move takes a quarter of a second or four.
   */
  readiness(slot: number): number {
    const move = this.moves[slot];

    if (move === undefined) {
      return 0;
    }
    if (move.cooldown <= 0) {
      return 1;
    }

    const left = this.cooldowns[slot] ?? 0;

    return left <= 0 ? 1 : Math.max(0, 1 - left / move.cooldown);
  }

  /**
   * How far through the windup the current cast is, 0 to 1, for the telegraph.
   * Zero when nothing is being cast.
   */
  castProgress(): number {
    if (this.castingSlot === CAST_IDLE || this.castTicksTotal === 0) {
      return 0;
    }

    return 1 - this.castTicksLeft / this.castTicksTotal;
  }

  /**
   * One simulation step. `wantsFire` is the fire intent for this tick -- the
   * mapped button for the player, an AI decision for an enemy.
   *
   * Register it before the projectile pool, so a shot released this tick also
   * travels this tick:
   *
   *   world.addSystem('moves', (w) => caster.step(w, fireHeld(w, BUTTON_FIRE)));
   */
  step(world: World, wantsFire: boolean): void {
    this.drainCooldowns();

    if (this.castingSlot === CAST_IDLE) {
      if (!wantsFire || !this.beginCast(this.selected)) {
        return;
      }
    }

    // The tick a cast begins is also its first windup frame, which is what
    // makes a `cast` of 6 take six ticks rather than seven, and a `cast` of 0
    // fire on the tick the button went down.
    this.advanceCast(world);
  }

  /**
   * Clears every cooldown and cancels any cast. The hook an Elixir hangs on
   * (GDD 4.4: "Elixirs survive as cooldown-reset consumables").
   */
  resetCooldowns(): void {
    this.cooldowns.fill(0);
    this.castingSlot = CAST_IDLE;
    this.castTicksLeft = 0;
    this.castTicksTotal = 0;
  }

  /**
   * Drains every slot, including the one being cast.
   *
   * A rate on the drain rather than a divisor on the length, so that a Speed
   * change part-way through a cooldown -- paralysis landing (GDD 4.5), a scarf
   * coming off -- would take effect on the cooldown already running. See
   * `stats.ts`.
   *
   * The epsilon is the same problem, and the same answer, as `arriveEpsilon`
   * in `entities/player.ts`: `1 - 60 * (1/60)` is not zero in binary floating
   * point, it is a couple of times 1e-16. Without the snap a one-second
   * cooldown at a rate of one ends a tick late, the rate of fire is quietly
   * off by one frame for every move in the game, and -- the part a player can
   * see -- `readiness` never quite reaches 1, so the HUD bar never fills.
   *
   * Scaled to the drain step, so it means the same thing for a fast species
   * and a slow one, and a millionth of one tick's drain is far below anything
   * reachable and far above the residue of a few hundred subtractions.
   */
  private drainCooldowns(): void {
    const epsilon = this.drainPerTick * 1e-6;

    for (let slot = 0; slot < this.cooldowns.length; slot += 1) {
      const left = this.cooldowns[slot] ?? 0;

      if (left <= 0) {
        continue;
      }

      const next = left - this.drainPerTick;

      this.cooldowns[slot] = next <= epsilon ? 0 : next;
    }
  }

  /** Claims the slot for a cast. Returns false when it is not available. */
  private beginCast(slot: number): boolean {
    const move = this.moves[slot];

    if (move === undefined || (this.cooldowns[slot] ?? 0) > 0) {
      return false;
    }

    this.castingSlot = slot;
    this.castTicksTotal = move.cast;
    this.castTicksLeft = move.cast;
    return true;
  }

  private advanceCast(world: World): void {
    this.castTicksLeft -= 1;

    if (this.castTicksLeft <= 0) {
      this.release(world);
    }
  }

  /**
   * Hands the cast to its shape and starts the cooldown.
   *
   * A release that produced nothing -- a full projectile pool -- does not go on
   * cooldown. Charging the player for a shot the engine dropped would be a
   * frame-rate problem showing up as a lost turn.
   */
  private release(world: World): void {
    const slot = this.castingSlot;
    const move = this.moves[slot];

    this.castingSlot = CAST_IDLE;
    this.castTicksLeft = 0;
    this.castTicksTotal = 0;

    if (move === undefined) {
      return;
    }

    const runtime = this.shapes[move.shape];

    if (runtime === undefined) {
      // The constructor refuses a move whose shape has no runtime, so this is
      // only reachable if the table were mutated behind the caster's back.
      return;
    }

    const entities = world.entities;
    const casterSlot = entities.slotOf(this.caster);

    if (casterSlot === -1) {
      return;
    }

    const release: MoveRelease = {
      caster: this.caster,
      originX: entities.posX[casterSlot] ?? 0,
      originY: entities.posY[casterSlot] ?? 0,
      aimX: this.aim.x,
      aimY: this.aim.y,
      moveIndex: slot,
    };

    if (!runtime.release(world, move, release)) {
      return;
    }

    this.cooldowns[slot] = move.cooldown;
    this.shots += 1;
  }
}

/**
 * Builds the fire intent for a player-controlled caster from one frame of
 * input.
 *
 * Here rather than in the scene because it is the simulation's reading of a
 * mapped button, and the headless harness in GDD 9.3 needs it without a
 * browser. The device half -- which physical button maps to this bit -- is
 * `render/deviceInput.ts`.
 */
export function fireHeld(world: World, fireButton: number): boolean {
  return (world.input.buttons & fireButton) !== 0;
}
