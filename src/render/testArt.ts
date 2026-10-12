/**
 * Procedural art for the M0-2 test scene.
 *
 * Drawn in code rather than loaded, for two reasons. It is original by
 * construction (GDD 11.2), and it is built to prove things about the pipeline
 * rather than to look like a creature:
 *
 * - a smooth radial gradient, which has no business surviving a 4-shade
 *   screen, so if the quantiser is working it comes out as four hard rings;
 * - a 1px checkerboard, which turns into a grey mush the moment anything
 *   blurs or scales by a fraction;
 * - a 1px outline, which goes soft under bilinear filtering.
 *
 * None of this is game art and none of it should survive past M1.
 */

import type Phaser from 'phaser';
import {
  SHADES,
  SHADE_DARK,
  SHADE_DARKEST,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
  cssColor,
  shadeSource,
  type ShadeIndex,
} from './palette';

export const TEST_SPRITE_KEY = 'test-sprite';
export const TEST_TILES_KEY = 'test-tiles';
export const SHADE_BARS_KEY = 'shade-bars';

/** GDD 8.1: 32x32 is the medium sprite size. */
export const TEST_SPRITE_SIZE = 32;

/** GDD 8.1: tiles are 16x16. */
export const TILE_SIZE = 16;

/** Tile indices within the generated tile sheet. */
export const TILE_FLOOR = 0;
export const TILE_FLOOR_DITHER = 1;
export const TILE_WALL = 2;
export const TILE_BRICK = 3;

const TILE_COUNT = 4;

type Context = CanvasRenderingContext2D;

function canvas(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
): Phaser.Textures.CanvasTexture {
  const texture = scene.textures.createCanvas(key, width, height);

  if (!texture) {
    throw new Error(`could not create the '${key}' texture`);
  }

  return texture;
}

function plot(context: Context, x: number, y: number, shade: ShadeIndex): void {
  context.fillStyle = cssColor(shadeSource(shade));
  context.fillRect(x, y, 1, 1);
}

function fill(
  context: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  shade: ShadeIndex,
): void {
  context.fillStyle = cssColor(shadeSource(shade));
  context.fillRect(x, y, width, height);
}

/**
 * A 32x32 test sprite: a radial gradient disc with a 1px outline, a
 * checkerboard quadrant and a solid quadrant.
 */
export function createTestSprite(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEST_SPRITE_KEY)) {
    return;
  }

  const size = TEST_SPRITE_SIZE;
  const texture = canvas(scene, TEST_SPRITE_KEY, size, size);
  const context = texture.getContext();
  const centre = (size - 1) / 2;
  const radius = size / 2 - 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > radius) {
        continue;
      }

      // A smooth 0..1 ramp from the rim to the centre. The screen cannot show
      // a ramp, so this is what the quantiser has to flatten.
      const toward = 1 - distance / radius;

      if (distance > radius - 1) {
        // GDD 8.2: a 1px outline in the lightest shade, so the silhouette
        // reads against anything.
        plot(context, x, y, SHADE_LIGHTEST);
      } else if (x < centre && y < centre) {
        // 1px checkerboard. Survives only if the scale is a whole number and
        // the filtering is nearest-neighbour.
        plot(context, x, y, (x + y) % 2 === 0 ? SHADE_LIGHTEST : SHADE_DARKEST);
      } else if (x >= centre && y < centre) {
        plot(context, x, y, SHADE_DARK);
      } else {
        // The lower half is the raw gradient, written as an off-palette grey
        // so that the quantiser is what bands it. If this half shows a smooth
        // ramp instead of rings, the quantise pass is not running.
        context.fillStyle = cssColor(greyRamp(toward));
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  texture.refresh();
}

/** A smooth grey, 0 (black) to 1 (white). Deliberately off-palette. */
function greyRamp(t: number): number {
  const value = Math.max(0, Math.min(0xff, Math.round(t * 0xff)));

  return (value << 16) | (value << 8) | value;
}

/** Four 16x16 tiles: plain floor, dithered floor, flat wall, brick wall. */
export function createTestTiles(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEST_TILES_KEY)) {
    return;
  }

  const texture = canvas(scene, TEST_TILES_KEY, TILE_SIZE * TILE_COUNT, TILE_SIZE);
  const context = texture.getContext();

  const origin = (index: number): number => index * TILE_SIZE;

  // Plain floor.
  fill(context, origin(TILE_FLOOR), 0, TILE_SIZE, TILE_SIZE, SHADE_DARK);

  // Dithered floor: a 2px checker, the classic way to fake a fifth shade
  // without having one.
  fill(context, origin(TILE_FLOOR_DITHER), 0, TILE_SIZE, TILE_SIZE, SHADE_DARK);
  for (let y = 0; y < TILE_SIZE; y += 2) {
    for (let x = 0; x < TILE_SIZE; x += 2) {
      plot(context, origin(TILE_FLOOR_DITHER) + x, y, SHADE_LIGHT);
    }
  }

  // Flat wall.
  fill(context, origin(TILE_WALL), 0, TILE_SIZE, TILE_SIZE, SHADE_LIGHT);

  // Brick wall: 1px mortar lines, which is the detail that goes soft first if
  // the scaling is fractional.
  fill(context, origin(TILE_BRICK), 0, TILE_SIZE, TILE_SIZE, SHADE_LIGHT);
  for (let y = 0; y < TILE_SIZE; y += 4) {
    fill(context, origin(TILE_BRICK), y, TILE_SIZE, 1, SHADE_DARKEST);

    const offset = (y / 4) % 2 === 0 ? 0 : TILE_SIZE / 2;

    fill(context, origin(TILE_BRICK) + offset, y, 1, 4, SHADE_DARKEST);
    fill(context, origin(TILE_BRICK) + ((offset + TILE_SIZE / 2) % TILE_SIZE), y, 1, 4, SHADE_DARKEST);
  }

  texture.refresh();
}

/**
 * Four vertical bars, one per shade, with a smooth grey ramp beneath them.
 *
 * The bars show that all four shades reach the screen. The ramp underneath is
 * a continuous gradient: on a working pipeline it reads as four hard steps
 * lining up with the bars above it, and on a broken one it reads as a
 * gradient.
 */
export function createShadeBars(scene: Phaser.Scene, width: number, height: number): void {
  if (scene.textures.exists(SHADE_BARS_KEY)) {
    return;
  }

  const texture = canvas(scene, SHADE_BARS_KEY, width, height);
  const context = texture.getContext();
  const barHeight = Math.floor(height / 2);
  const barWidth = Math.floor(width / SHADES.length);

  SHADES.forEach((index) => {
    fill(context, index * barWidth, 0, barWidth, barHeight, index);
  });

  for (let x = 0; x < width; x++) {
    context.fillStyle = cssColor(greyRamp(x / (width - 1)));
    context.fillRect(x, barHeight, 1, height - barHeight);
  }

  texture.refresh();
}
