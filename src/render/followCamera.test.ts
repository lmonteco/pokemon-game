import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';
import { CAMERA_DEADZONE_HALF_HEIGHT, CAMERA_DEADZONE_HALF_WIDTH } from '@/entities/tuning';
import { FollowCamera, type CameraViewOptions } from './followCamera';

/**
 * Two of M1-1's acceptance criteria are about this class, and neither can be
 * confirmed by looking at the screen:
 *
 * - "the camera never shows outside the room" -- a one-frame slip at an edge
 *   is not something you catch by playing, so every position is swept.
 * - "never shimmers" -- shimmer is a *sequence* of scroll values, not a value.
 *   A screenshot cannot show it. The property that rules it out is that the
 *   scroll is always a whole number and never moves backwards while the target
 *   moves forwards, and that is what is asserted here.
 */

const ROOM_WIDTH = 24 * 16;
const ROOM_HEIGHT = 16 * 16;

const options = (overrides: Partial<CameraViewOptions> = {}): CameraViewOptions => ({
  viewWidth: GAME_WIDTH,
  viewHeight: GAME_HEIGHT,
  worldWidth: ROOM_WIDTH,
  worldHeight: ROOM_HEIGHT,
  deadzoneHalfWidth: CAMERA_DEADZONE_HALF_WIDTH,
  deadzoneHalfHeight: CAMERA_DEADZONE_HALF_HEIGHT,
  ...overrides,
});

describe('FollowCamera', () => {
  it('starts centred on the target', () => {
    const camera = new FollowCamera(options());

    camera.centreOn(ROOM_WIDTH / 2, ROOM_HEIGHT / 2);

    expect(camera.left).toBe(ROOM_WIDTH / 2 - GAME_WIDTH / 2);
    expect(camera.top).toBe(ROOM_HEIGHT / 2 - GAME_HEIGHT / 2);
  });

  it('holds still while the target moves inside the deadzone', () => {
    // What makes a sidestep read as the player moving rather than as the
    // camera lurching. Without it, every small movement drags the world.
    const camera = new FollowCamera(options());
    const centreX = ROOM_WIDTH / 2;
    const centreY = ROOM_HEIGHT / 2;

    camera.centreOn(centreX, centreY);
    const before = { left: camera.left, top: camera.top };

    camera.follow(centreX + CAMERA_DEADZONE_HALF_WIDTH, centreY + CAMERA_DEADZONE_HALF_HEIGHT);

    expect({ left: camera.left, top: camera.top }).toEqual(before);
  });

  it('moves only as far as it must once the target leaves the deadzone', () => {
    const camera = new FollowCamera(options());
    const centreX = ROOM_WIDTH / 2;
    const centreY = ROOM_HEIGHT / 2;

    camera.centreOn(centreX, centreY);
    camera.follow(centreX + CAMERA_DEADZONE_HALF_WIDTH + 10, centreY);

    // The target ends up exactly on the deadzone edge, not re-centred: a
    // camera that snapped the target back to the middle would undo the point
    // of having a deadzone at all.
    expect(camera.left).toBe(centreX + 10 - GAME_WIDTH / 2);
  });

  it('always reports a whole-number scroll', () => {
    // The anti-shimmer rule. At six times upscale, a camera at x = 10.5 draws
    // the world three screen pixels off from a camera at x = 10, so a
    // fractional scroll makes every vertical edge in the room crawl.
    const camera = new FollowCamera(options());
    const fractional: string[] = [];

    camera.centreOn(0, 0);

    for (let step = 0; step < 4000; step += 1) {
      // Deliberately irrational-ish per-tick movement, so the target is almost
      // never on a whole coordinate.
      camera.follow(step * 0.37, step * 0.21);

      if (!Number.isInteger(camera.left) || !Number.isInteger(camera.top)) {
        fractional.push(`step ${step}: ${camera.left}, ${camera.top}`);
      }
    }

    expect(fractional).toEqual([]);
  });

  it('never scrolls backwards while the target moves forwards', () => {
    // The other half of shimmer. A camera that quantised its own state would
    // feed the rounding error back in and jitter back and forth by a pixel
    // while following a target moving steadily in one direction.
    const camera = new FollowCamera(options());
    const reversals: string[] = [];

    camera.centreOn(0, 0);

    let previousLeft = camera.left;
    let previousTop = camera.top;

    for (let step = 0; step < 4000; step += 1) {
      camera.follow(step * 0.17, step * 0.11);

      if (camera.left < previousLeft) {
        reversals.push(`step ${step}: left ${previousLeft} -> ${camera.left}`);
      }
      if (camera.top < previousTop) {
        reversals.push(`step ${step}: top ${previousTop} -> ${camera.top}`);
      }

      previousLeft = camera.left;
      previousTop = camera.top;
    }

    expect(reversals).toEqual([]);
  });

  it('never moves more than one unit per unit the target moves', () => {
    // A camera that overshot and corrected would technically be monotonic but
    // would still read as a lurch. Following at most as fast as the player is
    // what keeps the motion invisible.
    const camera = new FollowCamera(options());
    const jumps: string[] = [];
    const stepSize = 0.5;

    camera.centreOn(0, 0);

    let previousLeft = camera.left;

    for (let step = 0; step < 2000; step += 1) {
      camera.follow(step * stepSize, 0);

      if (camera.left - previousLeft > 1) {
        jumps.push(`step ${step}: jumped ${camera.left - previousLeft}`);
      }

      previousLeft = camera.left;
    }

    expect(jumps).toEqual([]);
  });

  it('never shows anything outside the room, wherever the target goes', () => {
    // Swept over the whole room and well past its edges, because the camera
    // is asked to follow a target that collision keeps inside the room but
    // nothing here guarantees that.
    const camera = new FollowCamera(options());
    const escapes: string[] = [];

    for (let y = -200; y < ROOM_HEIGHT + 200; y += 7) {
      for (let x = -200; x < ROOM_WIDTH + 200; x += 7) {
        camera.centreOn(x, y);

        if (camera.left < 0 || camera.left + GAME_WIDTH > ROOM_WIDTH) {
          escapes.push(`(${x},${y}): left ${camera.left}`);
        }
        if (camera.top < 0 || camera.top + GAME_HEIGHT > ROOM_HEIGHT) {
          escapes.push(`(${x},${y}): top ${camera.top}`);
        }
      }
    }

    expect(escapes).toEqual([]);
  });

  it('clamps hard against each edge of the room', () => {
    const camera = new FollowCamera(options());

    camera.centreOn(-1000, -1000);
    expect({ left: camera.left, top: camera.top }).toEqual({ left: 0, top: 0 });

    camera.centreOn(10_000, 10_000);
    expect({ left: camera.left, top: camera.top }).toEqual({
      left: ROOM_WIDTH - GAME_WIDTH,
      top: ROOM_HEIGHT - GAME_HEIGHT,
    });
  });

  it('sits at the origin when the room is smaller than the screen', () => {
    // No scroll position shows only the room, so the room goes against the
    // top-left and the slack shows on the other two sides. A camera that went
    // negative here would be worse: it would scroll the room away from the
    // corner and look like a bug with no obvious cause.
    const camera = new FollowCamera(
      options({ worldWidth: GAME_WIDTH - 64, worldHeight: GAME_HEIGHT - 32 }),
    );

    camera.centreOn(0, 0);
    expect({ left: camera.left, top: camera.top }).toEqual({ left: 0, top: 0 });

    camera.centreOn(10_000, 10_000);
    expect({ left: camera.left, top: camera.top }).toEqual({ left: 0, top: 0 });
  });

  it('follows a target that reverses direction without drifting away', () => {
    // Walking right then back left must leave the camera where it started, or
    // the deadzone would accumulate a bias and the player would slowly end up
    // off-centre after enough pacing.
    const camera = new FollowCamera(options());
    const start = { x: ROOM_WIDTH / 2, y: ROOM_HEIGHT / 2 };

    camera.centreOn(start.x, start.y);
    const before = camera.left;

    for (let step = 1; step <= 100; step += 1) {
      camera.follow(start.x + step, start.y);
    }
    for (let step = 99; step >= 0; step -= 1) {
      camera.follow(start.x + step, start.y);
    }

    // Back within the deadzone of where it began, and on the same side.
    expect(Math.abs(camera.left - before)).toBeLessThanOrEqual(CAMERA_DEADZONE_HALF_WIDTH * 2 + 1);
  });

  it('keeps the target on screen at full tilt', () => {
    // The deadzone is a quarter of the screen, so the player can never
    // approach the edge and lose sight of what is coming -- the reason the
    // deadzone is small in the first place.
    const camera = new FollowCamera(options());
    const offScreen: string[] = [];

    camera.centreOn(ROOM_WIDTH / 2, ROOM_HEIGHT / 2);

    for (let step = 0; step < 600; step += 1) {
      const targetX = ROOM_WIDTH / 2 + Math.sin(step / 30) * 120;
      const targetY = ROOM_HEIGHT / 2 + Math.cos(step / 17) * 60;

      camera.follow(targetX, targetY);

      const screenX = targetX - camera.left;
      const screenY = targetY - camera.top;

      if (screenX < 0 || screenX > GAME_WIDTH || screenY < 0 || screenY > GAME_HEIGHT) {
        offScreen.push(`step ${step}: (${screenX}, ${screenY})`);
      }
    }

    expect(offScreen).toEqual([]);
  });
});
