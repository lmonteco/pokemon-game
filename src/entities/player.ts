/**
 * The player: free movement, independent aim (GDD 4.1, 4.4, 7).
 *
 * This is the one thing that makes DEEPWILD not a Pokemon game with a grid in
 * it. No tiles, no turns -- a position, a velocity, and walls that stop you.
 *
 * The movement model, and why it is this one:
 *
 *   velocity is steered toward a target of `direction * topSpeed`, by a fixed
 *   step per tick, and snapped onto the target when it is within one step
 *
 * The alternative most projects reach for first is an exponential approach --
 * `v += (target - v) * k` -- which is one line shorter and wrong in a way that
 * is hard to name later. It never actually arrives: at k = 0.3 the character
 * is still drifting at 3% of top speed twelve ticks after the key came up, and
 * the player reads that as the controls being mushy without being able to say
 * why. A fixed step arrives exactly, on a tick you can count, which is what
 * lets the M1-1 target -- full speed and full stop inside about four frames --
 * be a tested number rather than a feeling.
 *
 * Aim is wholly separate from movement, which is the point of plan item 3: you
 * can retreat while facing the thing chasing you. Movement comes from the keys
 * and aim comes from the mouse, and neither reads the other.
 *
 * The dodge (GDD 4.4) is the one exception to "the keys decide the velocity":
 * while a dash is running it writes the velocity itself and the keys are
 * ignored. The machine lives in `dodge.ts`; what lives here is the arbitration
 * between the two, because they both write the same two numbers.
 *
 * Nothing here reads a clock or an unseeded random, so a world driven by a
 * scripted input source replays bit for bit (see `core/world.ts`).
 */

import { TICK_HZ } from '@/core/constants';
import { NO_ENTITY, type EntityId } from '@/core/entity-registry';
import type { World } from '@/core/world';
import { moveSpeedPixelsPerSecond } from '@/combat/stats';
import { FLAG_HITTABLE } from '@/combat/flags';
import { moveBox, isBoxBlocked, type BoxMoveResult } from '@/dungeon/tileCollision';
import type { TileGrid } from '@/dungeon/tileGrid';
import {
  AIM_DEADZONE,
  PLAYER_BOX_OFFSET_Y,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  TICKS_TO_FULL_SPEED,
  TICKS_TO_REVERSE,
  TICKS_TO_STOP,
  WALK_FRAME_DISTANCE,
} from './tuning';
import { DodgeMeter, dodgeHeld } from './dodge';
import {
  BUTTON_DODGE,
  FACING_DOWN,
  aimDirection,
  facingFromVector,
  moveDirection,
  type Facing,
  type Vec2,
} from './playerInput';

/** How many poses the placeholder sprite has per facing (`render/playerArt.ts`). */
export const PLAYER_FRAME_COUNT = 3;

/**
 * The walk cycle, as pose indices: left step, contact, right step, contact.
 *
 * Four phases over three drawn poses is the standard trick -- the contact pose
 * is also the standing pose, so it is drawn once and used twice. A two-phase
 * cycle that alternated the two steps with no contact between them would read
 * as a waddle.
 */
export const WALK_CYCLE: readonly number[] = [1, 0, 2, 0];

export interface PlayerSpec {
  /**
   * The species' base Speed stat, straight from `data/species.json`. The only
   * thing that decides how fast the player moves (GDD 4.4). Passed in as a
   * number rather than read from the content database here, so that the
   * simulation never depends on the content loader and the headless harness in
   * GDD 9.3 can drive a player with one line.
   */
  readonly speedStat: number;
  /** Spawn position of the collision box, in world units. */
  readonly startX: number;
  readonly startY: number;
}

export class PlayerController {
  readonly entity: EntityId;
  readonly grid: TileGrid;

  /** Top speed in world units per second, from the Speed stat (GDD 4.4). */
  readonly topSpeed: number;

  /** Per-tick velocity changes. Derived once; see `tuning.ts` for the why. */
  private readonly accelStep: number;
  private readonly brakeStep: number;
  private readonly reverseStep: number;

  /**
   * How close to the target velocity counts as having arrived.
   *
   * This exists because `topSpeed - 3 * (topSpeed / 3)` is not zero in binary
   * floating point -- it is a few times 1e-15. Without the tolerance the last
   * brake step lands a whisker short of a standstill, the snap below does not
   * fire, and the stop takes one tick longer than `TICKS_TO_STOP` says it
   * does. The tick counts in `tuning.ts` would then be quietly wrong, which is
   * the kind of thing that gets "fixed" during a feel pass by changing a
   * number rather than by finding this.
   *
   * Scaled to `topSpeed` so it means the same thing for a slow species and a
   * fast one, and a billionth of a top speed is around 1e-10 world units of
   * travel per tick: far below anything that could ever be seen, and far above
   * the accumulated error of a handful of subtractions.
   */
  private readonly arriveEpsilon: number;

  /**
   * The dodge: three pips, a dash, invulnerable frames (GDD 4.4). Owned by the
   * controller rather than passed in, because the dash and ordinary movement
   * write the same velocity and exactly one of them may win on any tick --
   * that arbitration is this class's job and nobody else can do it.
   */
  readonly dodge: DodgeMeter;

  /** The facing the sprite is drawn in. Follows the aim, never the movement. */
  facing: Facing = FACING_DOWN;

  /** Unit aim vector. Holds its last good value while the cursor is on top. */
  readonly aim: Vec2 = { x: 0, y: 1 };

  /** True on the ticks a wall decided where the player ended up. */
  hitWallX = false;
  hitWallY = false;

  /**
   * World units walked since the walk cycle last advanced. Distance, not time
   * (`tuning.ts`), so the animation cannot drift away from the simulation.
   */
  private strideDistance = 0;
  private walkPhase = 0;

  /** Whether the dash drove the body last tick. See `stepDodge`. */
  private wasDashing = false;

  // Scratch, reused every tick so that stepping allocates nothing.
  private readonly wish: Vec2 = { x: 0, y: 0 };
  private readonly dash: Vec2 = { x: 0, y: 0 };
  private readonly moved: BoxMoveResult = { x: 0, y: 0, hitX: false, hitY: false };

  constructor(world: World, grid: TileGrid, spec: PlayerSpec) {
    this.grid = grid;
    this.topSpeed = moveSpeedPixelsPerSecond(spec.speedStat);
    this.dodge = new DodgeMeter({ speedStat: spec.speedStat });

    // Velocity is integrated per tick, so the ramps convert from "ticks to get
    // there" into "units per second of velocity, per tick".
    this.accelStep = this.topSpeed / TICKS_TO_FULL_SPEED;
    this.brakeStep = this.topSpeed / TICKS_TO_STOP;
    this.reverseStep = this.topSpeed / TICKS_TO_REVERSE;
    this.arriveEpsilon = this.topSpeed * 1e-9;

    if (isBoxBlocked(grid, spec.startX, spec.startY, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)) {
      throw new Error(
        `player spawn (${spec.startX}, ${spec.startY}) is inside a wall; ` +
          "check the room template's player-start glyph",
      );
    }

    const entity = world.entities.spawn();
    if (entity === NO_ENTITY) {
      throw new Error('could not spawn the player: the entity pool is full');
    }
    this.entity = entity;

    const slot = world.entities.slotOf(entity);
    world.entities.posX[slot] = spec.startX;
    world.entities.posY[slot] = spec.startY;
    world.entities.radius[slot] = PLAYER_HALF_WIDTH;
    // A creature, so moves can hit it (`combat/flags.ts`). The player's own
    // shots exclude their owner, so this does not make them shoot themselves;
    // what it does is make an enemy's shots able to land once there are any.
    world.entities.flags[slot] = FLAG_HITTABLE;
    world.events.emit('spawned', { entity });
  }

  /** The collision box centre. */
  x(world: World): number {
    return world.entities.posX[world.entities.slotOf(this.entity)] ?? 0;
  }

  y(world: World): number {
    return world.entities.posY[world.entities.slotOf(this.entity)] ?? 0;
  }

  /**
   * Where to draw the sprite's centre: above the collision box, which sits at
   * the feet (`tuning.ts`).
   */
  spriteY(world: World): number {
    return this.y(world) - PLAYER_BOX_OFFSET_Y;
  }

  /** Current speed in world units per second. For the HUD and for tests. */
  speed(world: World): number {
    const slot = world.entities.slotOf(this.entity);
    const vx = world.entities.velX[slot] ?? 0;
    const vy = world.entities.velY[slot] ?? 0;
    return Math.sqrt(vx * vx + vy * vy);
  }

  /**
   * The pose index to draw: 0 while standing still, then the walk cycle.
   * Combine with `facing` to get a sprite-sheet frame (`render/playerArt.ts`).
   */
  animationPose(): number {
    return WALK_CYCLE[this.walkPhase] ?? 0;
  }

  /**
   * One simulation step. Register it with
   * `world.addSystem('player', (w) => player.step(w))`.
   */
  step(world: World): void {
    const entities = world.entities;
    const slot = entities.slotOf(this.entity);
    if (slot === -1) {
      return;
    }

    // Aim first, because a dash from a standing start takes its direction from
    // it (`dodge.ts`) and must use this tick's cursor rather than last tick's.
    this.updateAim(world);

    const wish = moveDirection(world.input.buttons, this.wish);

    // The dash owns the velocity outright while it runs. Blending it with the
    // keys would let a player hold the opposite direction to shorten their own
    // dash, which turns the commitment the i-frame window is priced against
    // into a thing you can opt out of half way through.
    if (!this.stepDodge(world, slot, wish)) {
      this.steerVelocity(world, slot, wish);
    }

    this.integrate(world, slot);
  }

  /**
   * Runs the dodge and, while it is dashing, writes its velocity.
   *
   * Returns whether the dash took the velocity this tick.
   *
   * Two details beyond handing the velocity over:
   *
   * - **Invulnerability is published as the registry's hittable flag**, not as
   *   a boolean a damage system has to remember to ask about. The projectile
   *   broadphase already rebuilds its target index from that flag every tick
   *   (`combat/projectiles.ts`), so the i-frames work on every damage source
   *   that exists and on every one written later, including ones written by
   *   somebody who has never read this file. That is the whole reason to spend
   *   a flag on it.
   * - **The velocity is clamped back to walking speed on the tick the dash
   *   ends.** Without the clamp the player leaves a dash at 2.6x top speed and
   *   the brake takes several ticks to bleed it off, so every dash ends in a
   *   skid the player did not ask for -- and dashing then walking would be
   *   faster than walking, which makes bunny-hopping the optimal way to cross
   *   a room.
   */
  private stepDodge(world: World, slot: number, wish: Vec2): boolean {
    const entities = world.entities;

    this.dodge.step({
      wantsDodge: dodgeHeld(world, BUTTON_DODGE),
      moveX: wish.x,
      moveY: wish.y,
      aimX: this.aim.x,
      aimY: this.aim.y,
    });

    const flags = entities.flags[slot] ?? 0;
    entities.flags[slot] = this.dodge.isInvulnerable
      ? flags & ~FLAG_HITTABLE
      : flags | FLAG_HITTABLE;

    const dashing = this.dodge.dashVelocity(this.dash);

    if (dashing) {
      entities.velX[slot] = this.dash.x;
      entities.velY[slot] = this.dash.y;
    } else if (this.wasDashing) {
      const vx = entities.velX[slot] ?? 0;
      const vy = entities.velY[slot] ?? 0;
      const speed = Math.sqrt(vx * vx + vy * vy);

      if (speed > this.topSpeed) {
        entities.velX[slot] = (vx / speed) * this.topSpeed;
        entities.velY[slot] = (vy / speed) * this.topSpeed;
      }
    }

    this.wasDashing = dashing;
    return dashing;
  }

  /**
   * Moves the velocity one step toward what the keys are asking for.
   *
   * The step size depends on which of three things is happening, and the
   * distinction is most of what "responsive" means:
   *
   *   - no keys down: brake, hard, so the stop is crisp;
   *   - reversing, meaning the new direction opposes the current velocity:
   *     the fastest of the three, because this is what the player does when
   *     something is about to hit them;
   *   - anything else: accelerate.
   */
  private steerVelocity(world: World, slot: number, wish: Vec2): void {
    const entities = world.entities;

    const targetX = wish.x * this.topSpeed;
    const targetY = wish.y * this.topSpeed;

    const vx = entities.velX[slot] ?? 0;
    const vy = entities.velY[slot] ?? 0;

    const deltaX = targetX - vx;
    const deltaY = targetY - vy;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance === 0) {
      return;
    }

    let step: number;
    if (wish.x === 0 && wish.y === 0) {
      step = this.brakeStep;
    } else if (targetX * vx + targetY * vy < 0) {
      step = this.reverseStep;
    } else {
      step = this.accelStep;
    }

    if (distance <= step + this.arriveEpsilon) {
      // Snap onto the target. This is the line that makes "full stop in
      // TICKS_TO_STOP ticks" exact rather than asymptotic, and the tolerance
      // is what makes it exact on the tick rather than one tick late (see
      // `arriveEpsilon`).
      entities.velX[slot] = targetX;
      entities.velY[slot] = targetY;
      return;
    }

    entities.velX[slot] = vx + (deltaX / distance) * step;
    entities.velY[slot] = vy + (deltaY / distance) * step;
  }

  /** Points the facing at the cursor, or holds the last aim if it is too close. */
  private updateAim(world: World): void {
    if (aimDirection(world.input.aimX, world.input.aimY, AIM_DEADZONE, this.aim)) {
      this.facing = facingFromVector(this.aim.x, this.aim.y, this.facing);
    }
  }

  /** Applies the velocity through the walls, and advances the walk cycle. */
  private integrate(world: World, slot: number): void {
    const entities = world.entities;
    const vx = entities.velX[slot] ?? 0;
    const vy = entities.velY[slot] ?? 0;

    const fromX = entities.posX[slot] ?? 0;
    const fromY = entities.posY[slot] ?? 0;

    const moved = moveBox(
      this.grid,
      fromX,
      fromY,
      PLAYER_HALF_WIDTH,
      PLAYER_HALF_HEIGHT,
      vx / TICK_HZ,
      vy / TICK_HZ,
      this.moved,
    );

    entities.posX[slot] = moved.x;
    entities.posY[slot] = moved.y;
    this.hitWallX = moved.hitX;
    this.hitWallY = moved.hitY;

    // Zero the blocked component. Without this the velocity keeps building
    // against the wall, and the tick the player turns away they are launched
    // at a speed they never asked for.
    if (moved.hitX) {
      entities.velX[slot] = 0;
    }
    if (moved.hitY) {
      entities.velY[slot] = 0;
    }

    this.advanceWalkCycle(moved.x - fromX, moved.y - fromY);
  }

  /**
   * Advances the walk cycle by distance actually travelled -- so walking into
   * a wall does not run the legs on the spot, and a fast species' legs move
   * faster with no extra tuning.
   */
  private advanceWalkCycle(dx: number, dy: number): void {
    const travelled = Math.sqrt(dx * dx + dy * dy);

    if (travelled < Number.EPSILON) {
      // Reset to the contact phase rather than freezing mid-stride: stopping
      // with one foot in the air looks like the animation hung.
      this.strideDistance = 0;
      this.walkPhase = 1;
      return;
    }

    this.strideDistance += travelled;
    while (this.strideDistance >= WALK_FRAME_DISTANCE) {
      this.strideDistance -= WALK_FRAME_DISTANCE;
      this.walkPhase = (this.walkPhase + 1) % WALK_CYCLE.length;
    }
  }
}
