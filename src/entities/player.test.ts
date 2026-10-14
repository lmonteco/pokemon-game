import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@/core/constants';
import { Rng } from '@/core/rng';
import { World } from '@/core/world';
import { validateContentOnDisk } from '@/content/node-loader.ts';
import { moveSpeedPixelsPerSecond } from '@/combat/stats';
import { FLAG_HITTABLE } from '@/combat/flags';
import { isBoxBlocked } from '@/dungeon/tileCollision';
import { tileGridFromRoom, type TileGrid } from '@/dungeon/tileGrid';
import { OPEN_BOX, PILLAR, roomFromRows } from '@/dungeon/testRooms';
import { PlayerController, WALK_CYCLE } from './player';
import {
  DODGE_CYCLE_TICKS,
  DODGE_DASH_TICKS,
  DODGE_IFRAMES,
  DODGE_IFRAME_FIRST_TICK,
  DODGE_IFRAME_LAST_TICK,
} from './dodge';
import {
  BUTTON_DODGE,
  BUTTON_MOVE_DOWN,
  BUTTON_MOVE_LEFT,
  BUTTON_MOVE_RIGHT,
  BUTTON_MOVE_UP,
  FACING_DOWN,
  FACING_LEFT,
  FACING_RIGHT,
  FACING_UP,
} from './playerInput';
import {
  DODGE_PIP_MAX,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  TICKS_TO_FULL_SPEED,
  TICKS_TO_REVERSE,
  TICKS_TO_STOP,
  WALK_FRAME_DISTANCE,
} from './tuning';

/**
 * The feel targets from the M1-1 plan, as numbers.
 *
 * "Responsive, not floaty" is a judgement, and the plan turns it into
 * something checkable: full speed within about four frames of pressing a key,
 * full stop within about four frames of releasing one. Those are the two
 * assertions that stop a later tuning pass from quietly making the game mushy,
 * and they are the reason the movement model steers by a fixed step rather
 * than by the exponential approach that never actually arrives.
 *
 * The rest of this file covers the acceptance criteria that are claims about
 * the controller: diagonal speed, aim independence, speed coming from `data/`,
 * and never ending up inside a wall.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A mid-tier Speed, so the numbers below are not special-cased by the pivot. */
const TEST_SPEED_STAT = 65;

interface Harness {
  readonly world: World;
  readonly player: PlayerController;
  readonly grid: TileGrid;
  /** Runs `ticks` steps with these buttons and aim held down. */
  hold(buttons: number, ticks: number, aimX?: number, aimY?: number): void;
  position(): { x: number; y: number };
}

function harness(
  rows: readonly string[] = OPEN_BOX,
  speedStat: number = TEST_SPEED_STAT,
  startTile: { x: number; y: number } = { x: 3, y: 2 },
): Harness {
  const world = new World({ seed: 'm1-1-player' });
  const grid = tileGridFromRoom(roomFromRows(rows));
  const player = new PlayerController(world, grid, {
    speedStat,
    startX: startTile.x * 16 + 8,
    startY: startTile.y * 16 + 8,
  });

  world.addSystem('player', (w) => player.step(w));

  return {
    world,
    player,
    grid,
    hold(buttons, ticks, aimX = 0, aimY = 0) {
      world.setInputSource((_tick, out) => {
        out.buttons = buttons;
        out.aimX = aimX;
        out.aimY = aimY;
      });
      world.run(ticks);
    },
    position() {
      return { x: player.x(world), y: player.y(world) };
    },
  };
}

describe('PlayerController: responsiveness', () => {
  it('reaches full speed within the tuned number of ticks', () => {
    // The plan's target: "full speed within ~4 frames of press".
    const h = harness();

    h.hold(BUTTON_MOVE_RIGHT, TICKS_TO_FULL_SPEED);

    expect(h.player.speed(h.world)).toBeCloseTo(h.player.topSpeed, 10);
  });

  it('is not already at full speed on the first tick', () => {
    // A ramp of some kind has to exist, or the first step is a teleport. One
    // tick in, the player is moving but not yet at top speed.
    const h = harness();

    h.hold(BUTTON_MOVE_RIGHT, 1);

    const speed = h.player.speed(h.world);

    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(h.player.topSpeed);
  });

  it('comes to an exact dead stop within the tuned number of ticks', () => {
    // The plan's other target, and the one that decides whether the game feels
    // floaty. `toBe(0)` rather than `toBeCloseTo`: an exponential approach
    // would leave a residual velocity that is small, never zero, and reads as
    // the controls being mushy without the player being able to say why.
    const h = harness();

    h.hold(BUTTON_MOVE_RIGHT, 30);
    h.hold(0, TICKS_TO_STOP);

    expect(h.player.speed(h.world)).toBe(0);
  });

  it('has fully stopped moving once it has stopped', () => {
    // No residual drift after the stop: the position must be identical from
    // one tick to the next.
    const h = harness();

    h.hold(BUTTON_MOVE_RIGHT, 30);
    h.hold(0, TICKS_TO_STOP);

    const settled = h.position();

    h.hold(0, 60);

    expect(h.position()).toEqual(settled);
  });

  it('reverses faster than it would stop and start again', () => {
    // A panic reversal is what the player does when something is about to hit
    // them, so it is the one case that must not feel like wading.
    const h = harness();

    h.hold(BUTTON_MOVE_RIGHT, 30);
    h.hold(BUTTON_MOVE_LEFT, TICKS_TO_REVERSE + TICKS_TO_FULL_SPEED);

    const slot = h.world.entities.slotOf(h.player.entity);

    expect(h.world.entities.velX[slot]).toBeCloseTo(-h.player.topSpeed, 10);
    expect(TICKS_TO_REVERSE).toBeLessThan(TICKS_TO_STOP + TICKS_TO_FULL_SPEED);
  });

  it('hits both tick targets for every legal Speed stat', () => {
    // The ramps are expressed in ticks so that the targets are the same for a
    // slow species and a fast one (`tuning.ts`). Swept over the whole stat
    // range because the arrival tolerance scales with top speed, and a
    // tolerance that was right at one speed and wrong at another would show up
    // as "the fast one feels floaty" long after anyone was looking here.
    const missed: string[] = [];

    for (let stat = 1; stat <= 255; stat += 1) {
      const accelerating = harness(OPEN_BOX, stat);

      accelerating.hold(BUTTON_MOVE_RIGHT, TICKS_TO_FULL_SPEED);

      const reached = accelerating.player.speed(accelerating.world);

      if (Math.abs(reached - accelerating.player.topSpeed) > 1e-9) {
        missed.push(`stat ${stat}: reached ${reached}, wanted ${accelerating.player.topSpeed}`);
      }

      const stopping = harness(OPEN_BOX, stat);

      stopping.hold(BUTTON_MOVE_RIGHT, 30);
      stopping.hold(0, TICKS_TO_STOP);

      if (stopping.player.speed(stopping.world) !== 0) {
        missed.push(`stat ${stat}: still moving at ${stopping.player.speed(stopping.world)}`);
      }
    }

    expect(missed).toEqual([]);
  });

  it('stops faster than it starts', () => {
    // Stated as a tuning invariant rather than left to the constants: a
    // character that takes longer to stop than to start is the definition of
    // floaty, whatever the absolute numbers are.
    expect(TICKS_TO_STOP).toBeLessThanOrEqual(TICKS_TO_FULL_SPEED);
  });
});

describe('PlayerController: diagonal speed', () => {
  it('moves at the same speed diagonally as it does straight', () => {
    // The acceptance criterion, at the level the player experiences it.
    const straight = harness();
    const diagonal = harness();

    straight.hold(BUTTON_MOVE_RIGHT, 20);
    diagonal.hold(BUTTON_MOVE_RIGHT | BUTTON_MOVE_DOWN, 20);

    expect(diagonal.player.speed(diagonal.world)).toBeCloseTo(
      straight.player.speed(straight.world),
      10,
    );
  });

  it('covers the same distance diagonally as it does straight', () => {
    // Speed being equal is the mechanism; distance travelled is what the
    // player actually notices. Measured in a big empty room so no wall
    // interferes.
    const rows = [
      '################',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '################',
    ];
    const straight = harness(rows, TEST_SPEED_STAT, { x: 2, y: 3 });
    const diagonal = harness(rows, TEST_SPEED_STAT, { x: 2, y: 3 });

    const straightStart = straight.position();
    const diagonalStart = diagonal.position();

    straight.hold(BUTTON_MOVE_RIGHT, 30);
    diagonal.hold(BUTTON_MOVE_RIGHT | BUTTON_MOVE_DOWN, 30);

    const straightDistance = Math.hypot(
      straight.position().x - straightStart.x,
      straight.position().y - straightStart.y,
    );
    const diagonalDistance = Math.hypot(
      diagonal.position().x - diagonalStart.x,
      diagonal.position().y - diagonalStart.y,
    );

    expect(diagonalDistance).toBeCloseTo(straightDistance, 8);
  });
});

describe('PlayerController: aim', () => {
  it('faces the cursor regardless of which way it is moving', () => {
    // "Aim is independent of movement; strafing works." Running left while
    // the cursor is to the right must leave the sprite facing right -- this is
    // what lets the player retreat from the thing chasing them.
    const h = harness();

    h.hold(BUTTON_MOVE_LEFT, 10, 100, 0);

    const slot = h.world.entities.slotOf(h.player.entity);

    expect(h.player.facing).toBe(FACING_RIGHT);
    expect(h.world.entities.velX[slot]).toBeLessThan(0);
  });

  it('strafes: the same aim with every direction of travel', () => {
    // Swept over all four directions, because a controller that coupled aim to
    // movement would still pass the single case above half the time.
    const wrong: string[] = [];
    const directions = [
      { buttons: BUTTON_MOVE_UP, name: 'up' },
      { buttons: BUTTON_MOVE_DOWN, name: 'down' },
      { buttons: BUTTON_MOVE_LEFT, name: 'left' },
      { buttons: BUTTON_MOVE_RIGHT, name: 'right' },
    ];

    directions.forEach(({ buttons, name }) => {
      const h = harness();

      // Cursor held below the player the whole time.
      h.hold(buttons, 10, 0, 100);

      if (h.player.facing !== FACING_DOWN) {
        wrong.push(`moving ${name}: facing ${h.player.facing}`);
      }
    });

    expect(wrong).toEqual([]);
  });

  it('holds its facing when the cursor sits on top of the player', () => {
    // Inside the aim deadzone the direction is noise, so the character must
    // not spin. Without this a cursor parked on the player flickers between
    // facings every frame.
    const h = harness();

    h.hold(0, 5, 0, -100);
    expect(h.player.facing).toBe(FACING_UP);

    h.hold(0, 60, 0, 0);
    expect(h.player.facing).toBe(FACING_UP);
  });

  it('keeps aiming while standing still', () => {
    // Aim is not gated on moving: you can stand and track a target.
    const h = harness();

    h.hold(0, 5, -100, 0);

    expect(h.player.facing).toBe(FACING_LEFT);
    expect(h.player.speed(h.world)).toBe(0);
  });
});

describe('PlayerController: speed comes from data', () => {
  it('moves at the speed the Speed stat dictates', () => {
    const h = harness(OPEN_BOX, 120);

    expect(h.player.topSpeed).toBe(moveSpeedPixelsPerSecond(120));
  });

  it('makes a faster species measurably faster over the same ticks', () => {
    // The acceptance criterion "movement speed changes when you change the
    // Speed stat in data/, with no code edit", reduced to the thing it
    // depends on: nothing between the stat and the distance travelled is
    // hardcoded.
    const rows = [
      '##########################',
      '#........................#',
      '#........................#',
      '##########################',
    ];
    const slow = harness(rows, 20, { x: 1, y: 1 });
    const fast = harness(rows, 200, { x: 1, y: 1 });

    const slowStart = slow.position().x;
    const fastStart = fast.position().x;

    slow.hold(BUTTON_MOVE_RIGHT, 20);
    fast.hold(BUTTON_MOVE_RIGHT, 20);

    expect(fast.position().x - fastStart).toBeGreaterThan(slow.position().x - slowStart);
  });

  it('is driven by the Speed stat in data/species.json', () => {
    // Closes the loop: the number actually shipped in `data/` produces the
    // controller's top speed, so editing that file is all it takes.
    const result = validateContentOnDisk(REPO_ROOT);

    if (!result.ok) {
      throw new Error('data/ did not validate; fix that before reading this test');
    }

    const species = result.content.species[0];

    expect(species).toBeDefined();

    const h = harness(OPEN_BOX, species?.baseStats.speed ?? 0);

    expect(h.player.topSpeed).toBe(moveSpeedPixelsPerSecond(species?.baseStats.speed ?? 0));
    // And it is a real speed, not an accidental zero from a missing field.
    expect(h.player.topSpeed).toBeGreaterThan(0);
  });

  it('travels close to its stated speed over a second of open floor', () => {
    // Ties the units together: `topSpeed` is per second, the loop runs at
    // TICK_HZ, so a second of running should cover roughly that distance. The
    // shortfall is the acceleration ramp, which is a handful of ticks.
    const rows = [
      '##########################',
      '#........................#',
      '#........................#',
      '##########################',
    ];
    const h = harness(rows, 100, { x: 1, y: 1 });
    const start = h.position().x;

    h.hold(BUTTON_MOVE_RIGHT, TICK_HZ);

    const travelled = h.position().x - start;

    expect(travelled).toBeGreaterThan(h.player.topSpeed * 0.9);
    expect(travelled).toBeLessThanOrEqual(h.player.topSpeed);
  });
});

describe('PlayerController: walls', () => {
  it('refuses to spawn inside a wall', () => {
    // A misplaced `p` glyph would otherwise put the player in a wall, where
    // collision's "not overlapping on arrival" assumption no longer holds and
    // the symptom would appear somewhere else entirely.
    const world = new World({ seed: 'spawn-in-wall' });
    const grid = tileGridFromRoom(roomFromRows(OPEN_BOX));

    expect(
      () => new PlayerController(world, grid, { speedStat: 65, startX: 4, startY: 4 }),
    ).toThrow(/inside a wall/);
  });

  it('stops at a wall instead of passing through it', () => {
    const h = harness();

    h.hold(BUTTON_MOVE_LEFT, 120);

    expect(h.player.hitWallX).toBe(true);
    expect(
      isBoxBlocked(h.grid, h.position().x, h.position().y, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT),
    ).toBe(false);
  });

  it('does not build up velocity while pressed against a wall', () => {
    // Without zeroing the blocked component, the velocity keeps growing into
    // the wall and the tick the player turns away they are fired off at a
    // speed they never asked for.
    const h = harness();

    h.hold(BUTTON_MOVE_LEFT, 120);

    const slot = h.world.entities.slotOf(h.player.entity);

    expect(h.world.entities.velX[slot]).toBe(0);
  });

  it('slides along a wall rather than sticking to it', () => {
    const h = harness();
    const start = h.position();

    // Into the left wall and downward at the same time.
    h.hold(BUTTON_MOVE_LEFT | BUTTON_MOVE_DOWN, 20);

    expect(h.position().y).toBeGreaterThan(start.y);
  });

  it('never ends up inside a wall under random input', () => {
    // The acceptance criterion "no wall clipping at any speed, including into
    // corners", driven through the whole controller rather than through
    // collision alone: this is the path the real game takes, including the
    // acceleration ramp and the velocity zeroing.
    const h = harness(PILLAR, 255, { x: 1, y: 1 });
    const rng = Rng.fromSeed('m1-1-player-stress', 'dungeon');
    const offenders: string[] = [];

    h.world.setInputSource((tick, out) => {
      // A new direction every few ticks, so the run includes reversals,
      // diagonals into corners and releases mid-stride.
      if (tick % 5 === 0) {
        // Through BUTTON_DODGE, so the run dashes into walls and into corners
        // at 2.6x walking speed as well as walking into them. That is the
        // "dashing into a wall does not clip through it" criterion from the
        // dodge plan, and this is the cheapest honest way to cover it: every
        // direction, every approach angle, mid-reversal, 20k ticks.
        out.buttons = rng.nextInt(BUTTON_DODGE * 2);
      }
      out.aimX = rng.nextFloatBetween(-100, 100);
      out.aimY = rng.nextFloatBetween(-100, 100);
    });

    for (let tick = 0; tick < 20_000; tick += 1) {
      h.world.run(1);

      const { x, y } = h.position();

      if (isBoxBlocked(h.grid, x, y, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)) {
        offenders.push(`tick ${tick} at (${x}, ${y})`);
        break;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        offenders.push(`tick ${tick} position went non-finite`);
        break;
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * The dodge, through the controller rather than through the machine.
 *
 * `dodge.test.ts` owns the state machine. What is only true here is the
 * arbitration: the dash and the keys both write the same velocity, the
 * invulnerability has to reach the registry flag the damage systems read, and
 * the dash has to go through `moveBox` like everything else.
 */
describe('PlayerController: the dodge', () => {
  /** Buttons for a dash to the right. */
  const DASH_RIGHT = BUTTON_MOVE_RIGHT | BUTTON_DODGE;

  /** Whether the player can be targeted this tick. */
  function hittable(h: Harness): boolean {
    const slot = h.world.entities.slotOf(h.player.entity);

    return ((h.world.entities.flags[slot] ?? 0) & FLAG_HITTABLE) !== 0;
  }

  it('covers exactly the dash distance, and the keys do not add to it', () => {
    const h = harness();
    const start = h.position();

    h.hold(DASH_RIGHT, DODGE_DASH_TICKS);

    // Exactly, not approximately: the dash writes the velocity outright, so
    // the distance is `dashSpeed / TICK_HZ` integrated DODGE_DASH_TICKS times.
    // If the key's acceleration were being blended in on top, this would come
    // out long -- and a dash whose length depends on which keys are held is
    // one the i-frame window cannot be priced against.
    expect(h.position().x - start.x).toBeCloseTo(h.player.dodge.dashDistance, 9);
    expect(h.position().y).toBeCloseTo(start.y, 9);
  });

  it('reads as a burst: much further than walking the same ticks', () => {
    const dash = harness();
    const walk = harness();

    dash.hold(DASH_RIGHT, DODGE_DASH_TICKS);
    walk.hold(BUTTON_MOVE_RIGHT, DODGE_DASH_TICKS);

    const dashed = dash.position().x - 3 * 16 - 8;
    const walked = walk.position().x - 3 * 16 - 8;

    // The acceptance criterion is "a clear distance, reads instantly". Against
    // a walk that spends part of those ticks accelerating, the dash is several
    // times further; anything under about double would not register as a
    // separate action on screen.
    expect(dashed).toBeGreaterThan(walked * 2);
  });

  it('publishes the i-frames on the registry flag, for the middle window only', () => {
    const h = harness();
    const exposed: number[] = [];
    const safe: number[] = [];

    for (let tick = 0; tick < DODGE_CYCLE_TICKS; tick += 1) {
      h.hold(DASH_RIGHT, 1);
      (hittable(h) ? exposed : safe).push(tick);
    }

    // Read off the flag the projectile broadphase rebuilds its target index
    // from (`combat/projectiles.ts`), not off `isInvulnerable`: a dodge that
    // worked on the accessor but never reached the flag would protect nothing.
    expect(safe).toEqual(
      Array.from(
        { length: DODGE_IFRAME_LAST_TICK - DODGE_IFRAME_FIRST_TICK + 1 },
        (_unused, i) => DODGE_IFRAME_FIRST_TICK + i,
      ),
    );

    // And the ends of the dash are in the exposed list, which is the half of
    // the criterion that says the window is a slice and not the whole dash.
    expect(exposed).toContain(0);
    expect(exposed).toContain(DODGE_DASH_TICKS - 1);
  });

  it('is hittable again once the dash is over', () => {
    const h = harness();

    h.hold(DASH_RIGHT, DODGE_CYCLE_TICKS * 2);

    expect(h.player.dodge.phase).not.toBe(DODGE_IFRAMES);
    expect(hittable(h)).toBe(true);
  });

  it('dashing into a wall neither clips through it nor sticks to it', () => {
    // Started one tile in, so the dash is longer than the gap to the wall.
    const h = harness(OPEN_BOX, TEST_SPEED_STAT, { x: 1, y: 2 });

    h.hold(BUTTON_MOVE_LEFT | BUTTON_DODGE, DODGE_DASH_TICKS);

    const stopped = h.position();

    expect(h.player.hitWallX).toBe(true);
    expect(isBoxBlocked(h.grid, stopped.x, stopped.y, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)).toBe(
      false,
    );

    // Not stuck: the dash ends, the keys come back, and the player walks off
    // the wall. A dash that left the body pinned would show up here as a
    // position that never changes again.
    h.hold(0, DODGE_CYCLE_TICKS);
    h.hold(BUTTON_MOVE_RIGHT, 20);

    expect(h.position().x).toBeGreaterThan(stopped.x);
  });

  it('slides along a wall when dashed into it at an angle', () => {
    const h = harness(OPEN_BOX, TEST_SPEED_STAT, { x: 1, y: 2 });
    const start = h.position();

    h.hold(BUTTON_MOVE_LEFT | BUTTON_MOVE_DOWN | BUTTON_DODGE, DODGE_DASH_TICKS);

    expect(h.position().y).toBeGreaterThan(start.y);
    expect(
      isBoxBlocked(h.grid, h.position().x, h.position().y, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT),
    ).toBe(false);
  });

  it('does not skid out of the dash at dash speed', () => {
    const h = harness();

    h.hold(DASH_RIGHT, DODGE_DASH_TICKS);
    h.hold(0, 1);

    // Clamped back to walking speed on the tick the dash ends, so releasing
    // the keys stops the player on the normal schedule. Without the clamp the
    // brake would have 2.6x top speed to bleed off and every dash would end in
    // a slide the player did not ask for -- and dash-then-walk would beat
    // walking, which makes bunny-hopping the fastest way across a room.
    expect(h.player.speed(h.world)).toBeLessThanOrEqual(h.player.topSpeed);

    h.hold(0, TICKS_TO_STOP);

    expect(h.player.speed(h.world)).toBe(0);
  });

  it('keeps aiming independently while dashing', () => {
    const h = harness();

    // Dashing right, cursor to the left: the facing follows the cursor, the
    // body follows the dash. The strafe from GDD 4.4 must not switch off
    // because a dash is running.
    h.hold(DASH_RIGHT, DODGE_DASH_TICKS, -40, 0);

    expect(h.player.facing).toBe(FACING_LEFT);
    expect(h.player.dodge.isDashing).toBe(true);
  });

  it('dashes toward the cursor from a standing start', () => {
    // Low in the room, so a full dash upward has somewhere to go.
    const h = harness(OPEN_BOX, TEST_SPEED_STAT, { x: 3, y: 4 });
    const start = h.position();

    h.hold(BUTTON_DODGE, DODGE_DASH_TICKS, 0, -40);

    expect(h.position().y).toBeLessThan(start.y);
    expect(h.position().x).toBeCloseTo(start.x, 9);
  });

  it('spends the whole meter and then refuses, through the real input path', () => {
    const h = harness();

    for (let i = 0; i < DODGE_PIP_MAX + 2; i += 1) {
      // Tap: the dodge is an edge, so the button has to be released between
      // dashes, and the cycle has to be waited out.
      h.hold(DASH_RIGHT, 1);
      h.hold(BUTTON_MOVE_RIGHT, DODGE_CYCLE_TICKS - 1);
    }

    // Three dashes from three pips. The two extra taps found an empty meter --
    // and only the recharge can have given anything back, never the taps.
    expect(h.player.dodge.dashCount).toBe(DODGE_PIP_MAX);
  });
});

describe('PlayerController: determinism', () => {
  it('replays bit for bit from the same seed and the same inputs', () => {
    // The contract in `core/world.ts`. The player is the first system with
    // real state, so it is the first chance to break it -- a `Date.now()` or a
    // `Math.random()` in here would show up as a hash mismatch.
    const script = (tick: number, out: { buttons: number; aimX: number; aimY: number }): void => {
      // The dodge is in the script because it is the one piece of player state
      // with a timer in it, and a timer is where a wall clock gets read.
      out.buttons =
        [BUTTON_MOVE_RIGHT, BUTTON_MOVE_DOWN | BUTTON_DODGE, 0, BUTTON_MOVE_LEFT, BUTTON_DODGE][
          tick % 5
        ] ?? 0;
      out.aimX = Math.sin(tick) * 50;
      out.aimY = Math.cos(tick) * 50;
    };

    const run = (): { hash: number; x: number; y: number } => {
      const world = new World({ seed: 'replay' });
      const grid = tileGridFromRoom(roomFromRows(PILLAR));
      const player = new PlayerController(world, grid, {
        speedStat: 65,
        startX: 1 * 16 + 8,
        startY: 1 * 16 + 8,
      });

      world.addSystem('player', (w) => player.step(w));
      world.setInputSource(script);
      world.run(500);

      return { hash: world.hash(), x: player.x(world), y: player.y(world) };
    };

    expect(run()).toEqual(run());
  });
});

describe('PlayerController: walk animation', () => {
  it('stands on a single pose when still', () => {
    const h = harness();

    h.hold(0, 10);

    expect(WALK_CYCLE[1]).toBe(0);
    expect(h.player.animationPose()).toBe(0);
  });

  it('cycles through every pose while walking', () => {
    // The legs have to actually move through all three drawn poses, or the
    // sprite reads as sliding.
    const h = harness(PILLAR, 255, { x: 1, y: 1 });
    const seen = new Set<number>();

    for (let tick = 0; tick < 120; tick += 1) {
      h.hold(BUTTON_MOVE_DOWN, 1);
      seen.add(h.player.animationPose());
    }

    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('advances the cycle by distance walked, not by time', () => {
    // So a fast species' legs move faster for free, and the animation cannot
    // drift out of step with the simulation.
    const slow = harness(PILLAR, 20, { x: 1, y: 1 });
    const fast = harness(PILLAR, 255, { x: 1, y: 1 });

    let slowChanges = 0;
    let fastChanges = 0;
    let slowPose = slow.player.animationPose();
    let fastPose = fast.player.animationPose();

    for (let tick = 0; tick < 60; tick += 1) {
      slow.hold(BUTTON_MOVE_DOWN, 1);
      fast.hold(BUTTON_MOVE_DOWN, 1);

      if (slow.player.animationPose() !== slowPose) {
        slowChanges += 1;
        slowPose = slow.player.animationPose();
      }
      if (fast.player.animationPose() !== fastPose) {
        fastChanges += 1;
        fastPose = fast.player.animationPose();
      }
    }

    expect(fastChanges).toBeGreaterThan(slowChanges);
  });

  it('does not run the legs on the spot against a wall', () => {
    // Distance travelled, not keys held: walking into a wall travels nothing,
    // so the legs stop. A time-driven cycle would keep them going and the
    // sprite would look like it was on a treadmill.
    const h = harness();

    h.hold(BUTTON_MOVE_LEFT, 120);

    const pose = h.player.animationPose();

    h.hold(BUTTON_MOVE_LEFT, 30);

    expect(h.player.animationPose()).toBe(pose);
  });

  it('takes a stride every WALK_FRAME_DISTANCE units travelled', () => {
    // Pins the tuning constant to observable behaviour, so the feel pass can
    // change it and see the test's expectation change with it.
    const rows = [
      '##########################',
      '#........................#',
      '#........................#',
      '##########################',
    ];
    const h = harness(rows, 100, { x: 1, y: 1 });
    const start = h.position().x;
    let changes = 0;
    let pose = h.player.animationPose();

    // Run until a known distance has been covered.
    while (h.position().x - start < WALK_FRAME_DISTANCE * 8) {
      h.hold(BUTTON_MOVE_RIGHT, 1);

      if (h.player.animationPose() !== pose) {
        changes += 1;
        pose = h.player.animationPose();
      }
    }

    // Eight strides' worth of distance, so eight or nine pose changes
    // depending on where in the cycle it started.
    expect(changes).toBeGreaterThanOrEqual(7);
    expect(changes).toBeLessThanOrEqual(9);
  });
});
