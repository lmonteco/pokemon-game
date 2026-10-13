import { describe, expect, it } from 'vitest';
import {
  BUTTON_DODGE,
  BUTTON_MOVE_DOWN,
  BUTTON_MOVE_LEFT,
  BUTTON_MOVE_RIGHT,
  BUTTON_MOVE_UP,
  FACINGS,
  FACING_DOWN,
  FACING_LEFT,
  FACING_RIGHT,
  FACING_UP,
  aimDirection,
  facingFromVector,
  moveDirection,
  type Vec2,
} from './playerInput';

const vec = (): Vec2 => ({ x: 0, y: 0 });

const length = (v: Vec2): number => Math.sqrt(v.x * v.x + v.y * v.y);

/** Every combination of the four movement keys, plus the dodge bit riding along. */
const ALL_BUTTON_COMBOS = Array.from({ length: 32 }, (_, i) => i);

const MOVE_BITS = BUTTON_MOVE_UP | BUTTON_MOVE_DOWN | BUTTON_MOVE_LEFT | BUTTON_MOVE_RIGHT;

describe('moveDirection', () => {
  it('gives a diagonal exactly the same magnitude as a cardinal', () => {
    // The acceptance criterion "diagonal speed equals cardinal speed", tested
    // at the layer that decides it. Unnormalised input is the classic top-down
    // movement bug: 1.41x faster on the diagonal, and every player who spots
    // it runs diagonally forever after.
    const cardinal = length(moveDirection(BUTTON_MOVE_RIGHT, vec()));
    const diagonal = length(moveDirection(BUTTON_MOVE_RIGHT | BUTTON_MOVE_DOWN, vec()));

    expect(cardinal).toBe(1);
    expect(diagonal).toBeCloseTo(1, 15);
  });

  it('is a unit vector or zero for every possible button combination', () => {
    // Swept over all 32 combinations rather than the four diagonals, because
    // the bug would arrive as a new button bit interacting with the mask.
    const wrong: string[] = [];

    ALL_BUTTON_COMBOS.forEach((buttons) => {
      const magnitude = length(moveDirection(buttons, vec()));
      const moving = magnitude !== 0;

      if (moving && Math.abs(magnitude - 1) > 1e-12) {
        wrong.push(`buttons ${buttons}: magnitude ${magnitude}`);
      }
    });

    expect(wrong).toEqual([]);
  });

  it('cancels opposite keys instead of picking a winner', () => {
    // What the player's hands expect, and it means a key the browser never
    // sent a keyup for cannot leave the character drifting forever.
    expect(moveDirection(BUTTON_MOVE_LEFT | BUTTON_MOVE_RIGHT, vec())).toEqual({ x: 0, y: 0 });
    expect(moveDirection(BUTTON_MOVE_UP | BUTTON_MOVE_DOWN, vec())).toEqual({ x: 0, y: 0 });
    expect(moveDirection(MOVE_BITS, vec())).toEqual({ x: 0, y: 0 });
  });

  it('cancels one axis without disturbing the other', () => {
    const out = moveDirection(BUTTON_MOVE_LEFT | BUTTON_MOVE_RIGHT | BUTTON_MOVE_DOWN, vec());

    expect(out).toEqual({ x: 0, y: 1 });
  });

  it('points each cardinal the way the screen does', () => {
    // Y grows downward, as it does in every canvas. Getting this backwards is
    // a bug nobody writes a test for and everybody notices immediately.
    expect(moveDirection(BUTTON_MOVE_UP, vec())).toEqual({ x: 0, y: -1 });
    expect(moveDirection(BUTTON_MOVE_DOWN, vec())).toEqual({ x: 0, y: 1 });
    expect(moveDirection(BUTTON_MOVE_LEFT, vec())).toEqual({ x: -1, y: 0 });
    expect(moveDirection(BUTTON_MOVE_RIGHT, vec())).toEqual({ x: 1, y: 0 });
  });

  it('ignores bits that are not movement', () => {
    // The dodge bit is claimed for M1-2 and must not steer anything yet.
    expect(moveDirection(BUTTON_DODGE, vec())).toEqual({ x: 0, y: 0 });
    expect(moveDirection(BUTTON_DODGE | BUTTON_MOVE_RIGHT, vec())).toEqual({ x: 1, y: 0 });
  });

  it('writes into the caller’s vector and returns it', () => {
    // Every moving entity calls this once a tick, and GDD 9.3's headless runs
    // should allocate nothing. Returning a fresh object would be the easy
    // mistake, and invisible until a 10,000-step run was profiled.
    const out = vec();

    expect(moveDirection(BUTTON_MOVE_UP, out)).toBe(out);
    expect(out).toEqual({ x: 0, y: -1 });
  });

  it('has distinct bits for every button', () => {
    // The bit layout is a wire format: a recorded input log is a list of these
    // integers. Two buttons sharing a bit would corrupt every recording made
    // before anyone noticed.
    const bits = [
      BUTTON_MOVE_UP,
      BUTTON_MOVE_DOWN,
      BUTTON_MOVE_LEFT,
      BUTTON_MOVE_RIGHT,
      BUTTON_DODGE,
    ];

    expect(new Set(bits).size).toBe(bits.length);
    bits.forEach((bit) => {
      // One bit each, so a button is a mask and never two.
      expect(bit & (bit - 1)).toBe(0);
    });
  });
});

describe('aimDirection', () => {
  it('normalises a cursor offset to a unit vector', () => {
    const out = vec();

    expect(aimDirection(30, 40, 3, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.6, 15);
    expect(out.y).toBeCloseTo(0.8, 15);
    expect(length(out)).toBeCloseTo(1, 15);
  });

  it('holds the last good aim while the cursor sits on the player', () => {
    // Inside the deadzone the direction is noise -- a one-pixel mouse move can
    // swing it 90 degrees -- so the character would spin on the spot. Leaving
    // `out` untouched is what "holds its last aim" means.
    const out: Vec2 = { x: 1, y: 0 };

    expect(aimDirection(0, 0, 3, out)).toBe(false);
    expect(aimDirection(1, 1, 3, out)).toBe(false);
    expect(out).toEqual({ x: 1, y: 0 });
  });

  it('treats the deadzone boundary as too close', () => {
    const out = vec();

    // Exactly on the edge is rejected, so the accept condition is a strict
    // inequality and there is no radius at which the result flickers.
    expect(aimDirection(3, 0, 3, out)).toBe(false);
    expect(aimDirection(3.001, 0, 3, out)).toBe(true);
  });

  it('is usable at any distance beyond the deadzone', () => {
    const out = vec();
    const wrong: string[] = [];

    for (let distance = 4; distance < 2000; distance += 7) {
      aimDirection(distance, -distance, 3, out);

      if (Math.abs(length(out) - 1) > 1e-12) {
        wrong.push(`${distance}: ${length(out)}`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe('facingFromVector', () => {
  it('keeps the fallback when there is no direction', () => {
    // A zero vector has no facing, and defaulting to "down" here would snap
    // the sprite round every time the player stopped.
    FACINGS.forEach((facing) => {
      expect(facingFromVector(0, 0, facing)).toBe(facing);
    });
  });

  it('picks the dominant axis', () => {
    expect(facingFromVector(1, 0.2, FACING_DOWN)).toBe(FACING_RIGHT);
    expect(facingFromVector(-1, 0.2, FACING_DOWN)).toBe(FACING_LEFT);
    expect(facingFromVector(0.2, 1, FACING_DOWN)).toBe(FACING_DOWN);
    expect(facingFromVector(0.2, -1, FACING_DOWN)).toBe(FACING_UP);
  });

  it('resolves a perfect 45 degrees the same way every time', () => {
    // Four facings out of 360 degrees means every boundary is arbitrary. What
    // matters is that it does not flicker: a rule that alternated between two
    // facings on the diagonal is the one the player would see.
    expect(facingFromVector(1, 1, FACING_DOWN)).toBe(FACING_DOWN);
    expect(facingFromVector(1, 1, FACING_RIGHT)).toBe(FACING_DOWN);
    expect(facingFromVector(-1, -1, FACING_RIGHT)).toBe(FACING_UP);
  });

  it('never flickers as the aim sweeps a full circle', () => {
    // The real anti-flicker property: going round the circle in small steps,
    // the facing may change at most four times. A boundary rule that wobbled
    // would show up here as a fifth change.
    let changes = 0;
    let previous = facingFromVector(1, 0, FACING_RIGHT);

    for (let step = 1; step <= 3600; step += 1) {
      const angle = (step / 3600) * Math.PI * 2;
      const facing = facingFromVector(Math.cos(angle), Math.sin(angle), previous);

      if (facing !== previous) {
        changes += 1;
        previous = facing;
      }
    }

    expect(changes).toBe(4);
  });

  it('gives each of the four facings a distinct index, in sheet-row order', () => {
    // The facing *is* the sprite-sheet row (`render/playerArt.ts`), so these
    // being 0..3 and distinct is load-bearing rather than cosmetic.
    expect([FACING_DOWN, FACING_UP, FACING_LEFT, FACING_RIGHT]).toEqual([0, 1, 2, 3]);
    expect(new Set(FACINGS).size).toBe(4);
  });
});
