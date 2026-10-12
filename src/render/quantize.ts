/**
 * The quantise maths, in plain TypeScript.
 *
 * The screen is quantised on the GPU by Phaser's GradientMap filter, driven by
 * a ColorRamp of four flat bands. A shader cannot be unit tested, so the same
 * arithmetic lives here and `quantize.test.ts` tests this. The two stay honest
 * because `paletteRampBands()` below is what builds the ramp the shader reads:
 * the thresholds are shared, not copied.
 *
 * The shader is `node_modules/phaser/src/renderer/webgl/shaders/src/`
 * `FilterGradientMap.frag` plus `Ramp.glsl`. In short:
 *
 *   progress = r * LUMA_R + g * LUMA_G + b * LUMA_B      (channels 0..1)
 *   band     = the first band whose `end` is >= progress
 *   output   = that band's colour, flat, because colorStart === colorEnd
 *
 * The pass is an indexing step, not a colour match. Brightness selects a shade
 * *slot* against fixed thresholds, and the palette supplies the colour for
 * that slot. So art drawn in the four source greys lands on the four palette
 * shades exactly, whatever palette is loaded, and anything drawn off-palette
 * (browser-antialiased text, a gradient) is snapped to the nearest slot.
 *
 * The two quantisers are not bit-identical and cannot be. The shader works in
 * float32, this file in float64, and ColorRamp encodes each band end into its
 * data texture as fixed point with a step of 1/65536. A pixel whose brightness
 * is within about 1.5e-5 of a threshold may be given the adjacent shade on the
 * GPU. That costs a razor-edge pixel one shade; it cannot put a fifth colour
 * on screen, which is the property that matters.
 */

import {
  SHADE_COUNT,
  SHADE_DARK,
  SHADE_DARKEST,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
  SHADE_SOURCE,
  paletteBrightness,
  type Palette,
  type ShadeIndex,
} from './palette';

/**
 * Channel weights that turn a pixel into one brightness value. These are the
 * defaults of Phaser's GradientMap `colorFactor`, chosen to approximate
 * luminance. They sum to 1, so progress stays inside 0..1.
 */
export const LUMA_R = 0.3;
export const LUMA_G = 0.6;
export const LUMA_B = 0.1;

/** Brightness of an 8-bit RGB triple, 0..1. */
export function brightness(r: number, g: number, b: number): number {
  return (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 0xff;
}

/**
 * The upper bound of each shade band, in brightness.
 *
 * Each threshold sits halfway between two neighbouring source greys, so a
 * pixel is given whichever shade slot it is already closest to. Derived from
 * `SHADE_SOURCE` rather than written out, so the two cannot drift apart.
 *
 * The last band always ends at 1 so the ramp covers the whole input range.
 */
export const SHADE_BAND_ENDS: readonly number[] = SHADE_SOURCE.map((rgb, i) => {
  const next = SHADE_SOURCE[i + 1];

  return next === undefined ? 1 : (paletteBrightness(rgb) + paletteBrightness(next)) / 2;
});

/**
 * Which shade slot an 8-bit RGB triple lands in.
 *
 * The comparison is `<=` to match `Ramp.glsl`, which descends into the upper
 * half of the band tree only on `progress > pivot`.
 */
export function shadeOf(r: number, g: number, b: number): ShadeIndex {
  const progress = brightness(r, g, b);

  if (progress <= (SHADE_BAND_ENDS[0] ?? 1)) {
    return SHADE_DARKEST;
  }
  if (progress <= (SHADE_BAND_ENDS[1] ?? 1)) {
    return SHADE_DARK;
  }
  if (progress <= (SHADE_BAND_ENDS[2] ?? 1)) {
    return SHADE_LIGHT;
  }

  return SHADE_LIGHTEST;
}

/** Maps a 24-bit RGB colour onto the shade slot of a palette it belongs to. */
export function quantize(rgb: number, palette: Palette): number {
  const index = shadeOf((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
  const shade = palette.shades[index];

  if (shade === undefined) {
    // Unreachable: `shades` is a 4-tuple and `shadeOf` returns 0..3.
    throw new Error(`palette '${palette.id}' is missing shade ${index}`);
  }

  return shade;
}

/**
 * One band of the GPU colour ramp. Flat: `colorStart === colorEnd`, so the
 * band's interpolation, gamma and dithering all collapse to a single colour
 * and the output cannot contain an in-between shade.
 */
export interface ShadeBand {
  readonly start: number;
  readonly end: number;
  readonly colorStart: number;
  readonly colorEnd: number;
}

/**
 * Builds the ColorRamp band list for a palette.
 *
 * Phaser's ColorRamp takes this shape directly, so this is the single
 * definition of where the shade boundaries are on the GPU.
 */
export function paletteRampBands(palette: Palette): ShadeBand[] {
  const bands: ShadeBand[] = [];
  let start = 0;

  for (let i = 0; i < SHADE_COUNT; i++) {
    const color = palette.shades[i];
    const end = SHADE_BAND_ENDS[i];

    if (color === undefined || end === undefined) {
      // Unreachable: `shades` is a 4-tuple and SHADE_BAND_ENDS has
      // SHADE_COUNT entries.
      throw new Error(`shade band ${i} is undefined`);
    }

    bands.push({ start, end, colorStart: color, colorEnd: color });
    start = end;
  }

  return bands;
}
