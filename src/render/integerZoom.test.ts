import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';
import { MIN_ZOOM, integerZoom, zoomedSize } from './integerZoom';

/**
 * The acceptance criterion for M0-2 is "pixels stay square and crisp at every
 * window size". Squareness is not a thing a screenshot proves at one size, it
 * is a property of the zoom chosen for every size, so it is tested here over
 * a sweep of window sizes rather than looked at.
 *
 * Square pixels follow from one rule: the zoom is a whole number. The rest of
 * the sweep checks that it is also the *largest* whole number that fits, so
 * the game is as big as it can be without letterboxing more than it must.
 */

/** A sweep that covers phone, laptop, desktop and silly aspect ratios. */
const WIDTHS = [1, 239, 240, 241, 360, 479, 480, 481, 720, 816, 1280, 1366, 1920, 2560, 3840];
const HEIGHTS = [1, 159, 160, 161, 200, 319, 320, 321, 540, 768, 800, 1080, 1440, 2160];

describe('integerZoom', () => {
  it('is always a whole number, at every window size', () => {
    const fractional: string[] = [];

    WIDTHS.forEach((width) => {
      HEIGHTS.forEach((height) => {
        const zoom = integerZoom(width, height);

        if (!Number.isInteger(zoom)) {
          fractional.push(`${width}x${height} -> ${zoom}`);
        }
      });
    });

    expect(fractional).toEqual([]);
  });

  it('never goes below 1x', () => {
    expect(integerZoom(0, 0)).toBe(MIN_ZOOM);
    expect(integerZoom(1, 1)).toBe(MIN_ZOOM);
    expect(integerZoom(GAME_WIDTH - 1, GAME_HEIGHT - 1)).toBe(MIN_ZOOM);
  });

  it('picks the largest zoom that fits, and no larger', () => {
    const wrong: string[] = [];

    WIDTHS.forEach((width) => {
      HEIGHTS.forEach((height) => {
        const zoom = integerZoom(width, height);
        const drawn = zoomedSize(zoom);
        const next = zoomedSize(zoom + 1);

        const fits = drawn.width <= width && drawn.height <= height;
        const nextFits = next.width <= width && next.height <= height;

        // At 1x a window too small to hold 240x160 is allowed not to fit.
        if (!fits && zoom !== MIN_ZOOM) {
          wrong.push(`${width}x${height}: ${zoom}x overflows`);
        }
        if (nextFits) {
          wrong.push(`${width}x${height}: ${zoom + 1}x would have fitted`);
        }
      });
    });

    expect(wrong).toEqual([]);
  });

  it('is limited by the tighter of the two axes', () => {
    // A wide, short window is capped by its height, and the reverse. Getting
    // this backwards would overflow the window on one axis.
    expect(integerZoom(GAME_WIDTH * 9, GAME_HEIGHT * 2)).toBe(2);
    expect(integerZoom(GAME_WIDTH * 2, GAME_HEIGHT * 9)).toBe(2);
  });

  it('holds its zoom while the window grows, then steps once', () => {
    // The window has to grow by a whole 240x160 to earn another step. This is
    // what makes a drag-resize jump in steps instead of smoothly stretching.
    expect(integerZoom(GAME_WIDTH * 3, GAME_HEIGHT * 3)).toBe(3);
    expect(integerZoom(GAME_WIDTH * 4 - 1, GAME_HEIGHT * 4 - 1)).toBe(3);
    expect(integerZoom(GAME_WIDTH * 4, GAME_HEIGHT * 4)).toBe(4);
  });

  it('fills a maximised 1080p window', () => {
    // GAM-4's done-when: a 240x160 frame filling a maximised browser window.
    // 1920x1080 with browser chrome taken off still clears 6x vertically.
    const zoom = integerZoom(1920, 1080 - 120);

    expect(zoom).toBe(6);
    expect(zoomedSize(zoom)).toEqual({ width: 1440, height: 960 });
  });
});
