import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PALETTE_ID,
  PALETTES,
  SHADES,
  SHADE_COUNT,
  SHADE_DARKEST,
  SHADE_LIGHTEST,
  SHADE_SOURCE,
  shadeSource,
  activePalette,
  cssColor,
  cyclePalette,
  getPalette,
  onPaletteChange,
  paletteBrightness,
  setActivePalette,
  shade,
  validatePalette,
} from './palette';

// The active palette is module state, so every test puts it back.
afterEach(() => {
  setActivePalette(DEFAULT_PALETTE_ID);
});

describe('shipped palettes', () => {
  it('ships more than one, so the swap is testable at all', () => {
    expect(PALETTES.length).toBeGreaterThan(1);
  });

  it('has a unique id for every palette', () => {
    const ids = PALETTES.map((palette) => palette.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // A palette whose shades are out of brightness order makes the quantiser map
  // bright pixels to dark colours. That looks like a shader bug and is not one,
  // so it gets caught here instead.
  PALETTES.forEach((palette) => {
    it(`'${palette.id}' is a valid ${SHADE_COUNT}-shade ramp`, () => {
      expect(validatePalette(palette)).toEqual([]);
      expect(palette.shades).toHaveLength(SHADE_COUNT);
    });
  });

  it('defaults to a palette that exists', () => {
    expect(getPalette(DEFAULT_PALETTE_ID)).toBeDefined();
  });

  // GDD 8.1 names these four values. If they change, it is a design decision.
  it('keeps the DMG shades named in GDD 8.1', () => {
    expect(getPalette('dmg')?.shades).toEqual([0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f]);
  });
});

describe('validatePalette', () => {
  const base = { id: 'test', name: 'Test' };

  it('rejects shades that are not brighter than the one before', () => {
    const problems = validatePalette({
      ...base,
      shades: [0x000000, 0xffffff, 0x404040, 0xf0f0f0],
    });

    expect(problems).toContain('shade 2 is not brighter than shade 1');
  });

  it('rejects two shades of the same brightness', () => {
    const problems = validatePalette({
      ...base,
      shades: [0x000000, 0x404040, 0x404040, 0xffffff],
    });

    expect(problems).toContain('shade 2 is not brighter than shade 1');
  });

  it('rejects a value that is not a 24-bit RGB integer', () => {
    expect(validatePalette({ ...base, shades: [-1, 0x404040, 0x808080, 0xffffff] })).toContain(
      'shade 0 is not a 24-bit RGB integer',
    );
    expect(
      validatePalette({ ...base, shades: [0x000000, 0x404040, 0x808080, 0x1000000] }),
    ).toContain('shade 3 is not a 24-bit RGB integer');
  });

  it('rejects an empty id', () => {
    expect(
      validatePalette({ id: '', name: 'Test', shades: [0x000000, 0x404040, 0x808080, 0xffffff] }),
    ).toContain('id is empty');
  });
});

describe('paletteBrightness', () => {
  it('ranks black below white', () => {
    expect(paletteBrightness(0x000000)).toBe(0);
    expect(paletteBrightness(0xffffff)).toBeCloseTo(1, 12);
  });
});

describe('source greys', () => {
  it('has one per shade slot', () => {
    expect(SHADE_SOURCE).toHaveLength(SHADE_COUNT);
    SHADES.forEach((index) => {
      expect(shadeSource(index)).toBe(SHADE_SOURCE[index]);
    });
  });

  // Evenly spaced is the whole point: it is what makes one grey land in one
  // band, so art drawn against the slots keeps all four shades under any
  // palette. Uneven source greys would reintroduce exactly the problem that
  // drawing art in palette colours has.
  it('spaces the greys evenly in brightness', () => {
    const steps = SHADE_SOURCE.slice(1).map(
      (rgb, i) => paletteBrightness(rgb) - paletteBrightness(SHADE_SOURCE[i] ?? 0),
    );

    expect(steps).toHaveLength(SHADE_COUNT - 1);
    steps.forEach((step) => {
      expect(step).toBeCloseTo(1 / (SHADE_COUNT - 1), 2);
    });
  });

  it('spans the full brightness range', () => {
    expect(paletteBrightness(shadeSource(SHADE_DARKEST))).toBe(0);
    expect(paletteBrightness(shadeSource(SHADE_LIGHTEST))).toBeCloseTo(1, 12);
  });
});

describe('the active palette', () => {
  it('starts on the default', () => {
    expect(activePalette().id).toBe(DEFAULT_PALETTE_ID);
  });

  it('resolves every shade slot to a colour of the active palette', () => {
    SHADES.forEach((index) => {
      expect(activePalette().shades).toContain(shade(index));
    });
  });

  it('changes every shade when the palette changes', () => {
    const before = SHADES.map((index) => shade(index));

    setActivePalette('grey');

    const after = SHADES.map((index) => shade(index));

    expect(after).not.toEqual(before);
    SHADES.forEach((index) => {
      expect(after[index]).not.toBe(before[index]);
    });
  });

  it('throws on an unknown id rather than leaving the screen as it was', () => {
    expect(() => setActivePalette('does-not-exist')).toThrow(/unknown palette/);
    expect(activePalette().id).toBe(DEFAULT_PALETTE_ID);
  });

  it('notifies listeners once per real change', () => {
    const listener = vi.fn();
    const unsubscribe = onPaletteChange(listener);

    setActivePalette('grey');
    expect(listener).toHaveBeenCalledTimes(1);

    // Setting the palette it is already on is not a change.
    setActivePalette('grey');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setActivePalette(DEFAULT_PALETTE_ID);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cycles through every palette and wraps back round', () => {
    const seen = [activePalette().id];

    for (let i = 0; i < PALETTES.length; i++) {
      seen.push(cyclePalette().id);
    }

    expect(seen[seen.length - 1]).toBe(DEFAULT_PALETTE_ID);
    expect(new Set(seen).size).toBe(PALETTES.length);
  });
});

describe('cssColor', () => {
  it('pads short values to six digits', () => {
    expect(cssColor(0x000000)).toBe('#000000');
    expect(cssColor(0x0f380f)).toBe('#0f380f');
    expect(cssColor(0xffffff)).toBe('#ffffff');
  });

  it('round-trips the shades of the active palette', () => {
    expect(cssColor(shade(SHADE_DARKEST))).toBe('#0f380f');
    expect(cssColor(shade(SHADE_LIGHTEST))).toBe('#9bbc0f');
  });
});
