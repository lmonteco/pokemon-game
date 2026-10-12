import { describe, expect, it } from 'vitest';
import {
  LUMA_B,
  LUMA_G,
  LUMA_R,
  SHADE_BAND_ENDS,
  brightness,
  paletteRampBands,
  quantize,
  shadeOf,
} from './quantize';
import {
  PALETTES,
  SHADES,
  SHADE_COUNT,
  SHADE_DARK,
  SHADE_DARKEST,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
  SHADE_SOURCE,
  shadeSource,
  type Palette,
} from './palette';

const dmg = PALETTES[0];
const grey = PALETTES[1];

if (!dmg || !grey) {
  throw new Error('expected at least two shipped palettes');
}

describe('brightness', () => {
  it('maps black to 0 and white to 1', () => {
    expect(brightness(0, 0, 0)).toBe(0);
    expect(brightness(0xff, 0xff, 0xff)).toBeCloseTo(1, 12);
  });

  // If these stop summing to 1 the shader's progress can leave 0..1 and the
  // ramp lookup walks off the end of the band tree.
  it('uses weights that sum to 1', () => {
    expect(LUMA_R + LUMA_G + LUMA_B).toBeCloseTo(1, 12);
  });

  it('never leaves the 0..1 range for any 8-bit input', () => {
    for (let r = 0; r <= 0xff; r += 17) {
      for (let g = 0; g <= 0xff; g += 17) {
        for (let b = 0; b <= 0xff; b += 17) {
          const value = brightness(r, g, b);

          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('SHADE_BAND_ENDS', () => {
  it('has one strictly rising threshold per shade, ending at 1', () => {
    expect(SHADE_BAND_ENDS).toHaveLength(SHADE_COUNT);
    expect(SHADE_BAND_ENDS[SHADE_BAND_ENDS.length - 1]).toBe(1);

    for (let i = 1; i < SHADE_BAND_ENDS.length; i++) {
      expect(SHADE_BAND_ENDS[i]).toBeGreaterThan(SHADE_BAND_ENDS[i - 1] ?? 0);
    }
  });

  // Each source grey must sit inside its own band, well clear of the
  // thresholds either side. If a threshold crept up to a source grey, art
  // drawn in it would come out one shade off under float32 on the GPU, which
  // is the failure this whole file exists to prevent. The outermost greys are
  // black and white, so they sit on the ends of the range by definition and
  // only have an interior edge to keep clear of.
  it('leaves a wide margin between each source grey and its thresholds', () => {
    SHADES.forEach((index) => {
      const rgb = shadeSource(index);
      const value = brightness((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
      const lower = index === 0 ? undefined : SHADE_BAND_ENDS[index - 1];
      const upper = index === SHADE_COUNT - 1 ? undefined : SHADE_BAND_ENDS[index];

      if (lower !== undefined) {
        expect(value - lower).toBeGreaterThan(0.1);
      }
      if (upper !== undefined) {
        expect(upper - value).toBeGreaterThan(0.1);
      }
    });
  });
});

describe('shadeOf', () => {
  // The invariant the whole pipeline rests on: art drawn in source grey `i`
  // comes out as shade `i`, so a sprite keeps all four of its shades under
  // every palette.
  it('maps each source grey to its own shade slot', () => {
    SHADES.forEach((index) => {
      const rgb = shadeSource(index);

      expect(shadeOf((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff)).toBe(index);
    });
  });

  it('puts black on the darkest shade and white on the lightest', () => {
    expect(shadeOf(0x00, 0x00, 0x00)).toBe(SHADE_DARKEST);
    expect(shadeOf(0xff, 0xff, 0xff)).toBe(SHADE_LIGHTEST);
  });

  it('walks up through all four shades as a grey gets brighter', () => {
    expect(shadeOf(0x10, 0x10, 0x10)).toBe(SHADE_DARKEST);
    expect(shadeOf(0x55, 0x55, 0x55)).toBe(SHADE_DARK);
    expect(shadeOf(0xaa, 0xaa, 0xaa)).toBe(SHADE_LIGHT);
    expect(shadeOf(0xf0, 0xf0, 0xf0)).toBe(SHADE_LIGHTEST);
  });

  it('splits each band exactly at its threshold', () => {
    for (let band = 0; band < SHADE_COUNT - 1; band++) {
      const end = SHADE_BAND_ENDS[band] ?? 1;
      // The weights sum to 1, so a grey of `end * 255` has brightness `end`.
      const below = (end - 1e-6) * 0xff;
      const above = (end + 1e-6) * 0xff;

      expect(shadeOf(below, below, below)).toBe(band);
      expect(shadeOf(above, above, above)).toBe(band + 1);
    }
  });

  // Colours can sit exactly on a threshold -- rgb(0,70,5) is exactly on the
  // darkest/dark boundary -- so the tie-break is reachable and has to match
  // the shader. Ramp.glsl descends into the upper half of the band tree only
  // on `progress > pivot`, which puts the tie on the darker side, and
  // `shadeOf` uses `<=` to agree.
  it('sends a pixel exactly on a threshold to the darker shade', () => {
    expect(brightness(0, 70, 5)).toBe(SHADE_BAND_ENDS[0]);
    expect(shadeOf(0, 70, 5)).toBe(SHADE_DARKEST);
  });

  it('rises monotonically as a grey gets brighter', () => {
    let previous = shadeOf(0, 0, 0);

    for (let v = 1; v <= 0xff; v++) {
      const current = shadeOf(v, v, v);

      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('never returns a slot outside the palette', () => {
    for (let r = 0; r <= 0xff; r += 7) {
      for (let g = 0; g <= 0xff; g += 7) {
        for (let b = 0; b <= 0xff; b += 7) {
          const index = shadeOf(r, g, b);

          expect(index).toBeGreaterThanOrEqual(SHADE_DARKEST);
          expect(index).toBeLessThanOrEqual(SHADE_LIGHTEST);
        }
      }
    }
  });
});

/**
 * The colours a quantised frame could possibly contain, for one palette.
 *
 * The acceptance criterion for this task is that a frame holds at most four
 * distinct colours. A frame is just a bag of pixels, so sweeping the 24-bit
 * cube on a stride plus every grey plus every colour the project defines
 * stands in for any frame the game can draw: no pixel escapes this set.
 */
const sweepColors = (palette: Palette): Set<number> => {
  const seen = new Set<number>();

  for (let r = 0; r <= 0xff; r += 3) {
    for (let g = 0; g <= 0xff; g += 3) {
      for (let b = 0; b <= 0xff; b += 3) {
        seen.add(quantize((r << 16) | (g << 8) | b, palette));
      }
    }
  }

  for (let v = 0; v <= 0xff; v++) {
    seen.add(quantize((v << 16) | (v << 8) | v, palette));
  }

  SHADE_SOURCE.forEach((rgb) => seen.add(quantize(rgb, palette)));
  PALETTES.forEach((source) => {
    source.shades.forEach((rgb) => seen.add(quantize(rgb, palette)));
  });

  return seen;
};

const sweepCache = new Map<string, Set<number>>();

const sweep = (palette: Palette): Set<number> => {
  const cached = sweepCache.get(palette.id);

  if (cached) {
    return cached;
  }

  const seen = sweepColors(palette);
  sweepCache.set(palette.id, seen);

  return seen;
};

describe('quantize', () => {
  PALETTES.forEach((palette) => {
    it(`emits at most ${SHADE_COUNT} distinct colours for '${palette.id}'`, () => {
      expect(sweep(palette).size).toBeLessThanOrEqual(SHADE_COUNT);
    });

    it(`emits exactly the shades of '${palette.id}' and nothing else`, () => {
      const seen = [...sweep(palette)].sort((a, b) => a - b);

      expect(seen).toEqual([...palette.shades].sort((a, b) => a - b));
    });

    // Art drawn in source grey `i` has to come out as shade `i` of whichever
    // palette is loaded. This is what lets one set of sprites serve every
    // palette, and it is the acceptance criterion "palette swap changes every
    // on-screen colour" reduced to something testable.
    it(`maps every source grey to the matching shade of '${palette.id}'`, () => {
      SHADES.forEach((index) => {
        expect(quantize(shadeSource(index), palette)).toBe(palette.shades[index]);
      });
    });
  });

  it('gives a pixel a different colour in a different palette', () => {
    SHADES.forEach((index) => {
      expect(quantize(shadeSource(index), dmg)).not.toBe(quantize(shadeSource(index), grey));
    });
  });
});

describe('paletteRampBands', () => {
  it('builds one flat band per shade', () => {
    const bands = paletteRampBands(dmg);

    expect(bands).toHaveLength(SHADE_COUNT);

    bands.forEach((band, i) => {
      expect(band.colorStart).toBe(band.colorEnd);
      expect(band.colorStart).toBe(dmg.shades[i]);
    });
  });

  // The ramp shader assumes bands run end to end with no gap and no overlap.
  // A gap samples an undefined band; an overlap picks the wrong one.
  it('covers 0..1 end to end with no gaps', () => {
    PALETTES.forEach((palette) => {
      const bands = paletteRampBands(palette);

      expect(bands[0]?.start).toBe(0);
      expect(bands[bands.length - 1]?.end).toBe(1);

      for (let i = 1; i < bands.length; i++) {
        expect(bands[i]?.start).toBe(bands[i - 1]?.end);
      }
    });
  });

  // This is the link that keeps the GPU pass and `shadeOf` in step: the band
  // ends the shader reads are the thresholds the pure function compares to.
  it('uses the same thresholds as shadeOf', () => {
    PALETTES.forEach((palette) => {
      paletteRampBands(palette).forEach((band, i) => {
        expect(band.end).toBe(SHADE_BAND_ENDS[i]);
      });
    });
  });
});
