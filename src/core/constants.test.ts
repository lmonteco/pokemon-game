import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH, TICK_HZ, TICK_MS } from './constants';

describe('core constants', () => {
  it('keeps the 3:2 handheld aspect ratio so integer scaling stays square', () => {
    expect(GAME_WIDTH / GAME_HEIGHT).toBeCloseTo(3 / 2, 10);
  });

  // 1000 / 60 is not exact in binary floating point, so this is a closeness
  // check on purpose. The fixed-step loop (M0-3) must accumulate in integers
  // rather than summing TICK_MS, or the drift shows up here first.
  it('derives the tick length from the tick rate', () => {
    expect(TICK_MS * TICK_HZ).toBeCloseTo(1000, 9);
  });
});
