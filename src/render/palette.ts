/**
 * The four shades of the virtual handheld screen, and the palettes that fill
 * them (GDD 8.1).
 *
 * This is the only module in `src/` allowed to contain a colour literal.
 * Everything else names a shade and resolves it through `shade()`, so swapping
 * the palette recolours the whole game without touching another file.
 *
 * Four shades is a hard constraint, not a style preference. It is what makes
 * sprites drawn at different times by different hands look like one game.
 */

/** A shade slot. Darkest (0) to lightest (3). */
export const SHADE_DARKEST = 0;
export const SHADE_DARK = 1;
export const SHADE_LIGHT = 2;
export const SHADE_LIGHTEST = 3;

/** How many shades a palette has. The screen may never show more. */
export const SHADE_COUNT = 4;

export type ShadeIndex =
  | typeof SHADE_DARKEST
  | typeof SHADE_DARK
  | typeof SHADE_LIGHT
  | typeof SHADE_LIGHTEST;

/** Every shade slot, darkest first. Use to iterate without magic numbers. */
export const SHADES: readonly ShadeIndex[] = [
  SHADE_DARKEST,
  SHADE_DARK,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
];

export interface Palette {
  /** Stable id. Saves and settings refer to this, never to the index. */
  readonly id: string;
  /** Shown to the player. */
  readonly name: string;
  /** 24-bit RGB, darkest to lightest. Must be monotonically brighter. */
  readonly shades: readonly [number, number, number, number];
}

/**
 * The shipped palettes. Adding one is a new entry here and nothing else: the
 * quantiser reads whatever four shades it is handed.
 *
 * `dmg` is the palette named in GDD 8.1. Its two lightest shades are close
 * together on purpose -- that is what the real hardware looked like.
 */
export const PALETTES: readonly Palette[] = [
  {
    id: 'dmg',
    name: 'DMG Green',
    shades: [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f],
  },
  {
    id: 'grey',
    name: 'Pocket Grey',
    shades: [0x1b1b1b, 0x565656, 0x9c9c9c, 0xe3e3e3],
  },
];

/** The palette the game starts in. */
export const DEFAULT_PALETTE_ID = 'dmg';

/**
 * The greys that art is *drawn* in, one per shade slot.
 *
 * Art is authored against shade slots, not against colours: a sprite drawn in
 * `SHADE_SOURCE[SHADE_LIGHTEST]` comes out as the lightest colour of whatever
 * palette is active. The quantise pass reads brightness, so these four are
 * evenly spaced -- that is what makes the mapping an exact one per slot for
 * every palette, present and future.
 *
 * Drawing art in a palette's own colours instead would not survive a swap.
 * The DMG ramp in GDD 8.1 has its two lightest shades at 0.574 and 0.631
 * brightness, almost touching, while a grey ramp spreads its four evenly;
 * a sprite authored in one would lose a shade in the other.
 */
export const SHADE_SOURCE: readonly [number, number, number, number] = [
  0x000000, 0x555555, 0xaaaaaa, 0xffffff,
];

/** The grey to draw in to get the given shade slot on screen. */
export function shadeSource(index: ShadeIndex): number {
  const rgb = SHADE_SOURCE[index];

  if (rgb === undefined) {
    // Unreachable: SHADE_SOURCE is a 4-tuple and ShadeIndex is 0..3.
    throw new Error(`no source grey for shade ${index}`);
  }

  return rgb;
}

/**
 * Relative brightness of a 24-bit colour, 0..1.
 *
 * Uses the same channel weights as the quantise pass so that "monotonically
 * brighter" means the same thing to this file and to the shader.
 */
export function paletteBrightness(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;

  return (0.3 * r + 0.6 * g + 0.1 * b) / 0xff;
}

/**
 * Returns the reasons a palette is unusable, or an empty array if it is fine.
 *
 * A palette with shades out of brightness order would make the quantiser map
 * bright pixels to dark colours, which looks like a shader bug and is not one.
 * `palette.test.ts` runs this over every shipped palette.
 */
export function validatePalette(palette: Palette): string[] {
  const problems: string[] = [];

  if (palette.id.length === 0) {
    problems.push('id is empty');
  }

  if (palette.shades.length !== SHADE_COUNT) {
    problems.push(`has ${palette.shades.length} shades, expected ${SHADE_COUNT}`);
  }

  palette.shades.forEach((rgb, i) => {
    if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff) {
      problems.push(`shade ${i} is not a 24-bit RGB integer`);
    }
  });

  for (let i = 1; i < palette.shades.length; i++) {
    const previous = palette.shades[i - 1];
    const current = palette.shades[i];

    if (previous === undefined || current === undefined) {
      continue;
    }

    if (paletteBrightness(current) <= paletteBrightness(previous)) {
      problems.push(`shade ${i} is not brighter than shade ${i - 1}`);
    }
  }

  return problems;
}

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((palette) => palette.id === id);
}

function requirePalette(id: string): Palette {
  const palette = getPalette(id);

  if (!palette) {
    throw new Error(`unknown palette '${id}'`);
  }

  return palette;
}

let active: Palette = requirePalette(DEFAULT_PALETTE_ID);

const listeners = new Set<(palette: Palette) => void>();

export function activePalette(): Palette {
  return active;
}

/**
 * Switches palette and notifies every listener. Throws on an unknown id
 * rather than silently leaving the screen as it was.
 */
export function setActivePalette(id: string): Palette {
  const palette = requirePalette(id);

  if (palette === active) {
    return active;
  }

  active = palette;
  listeners.forEach((listener) => listener(active));

  return active;
}

/** Steps to the next shipped palette. Wired to a key in the test scene. */
export function cyclePalette(): Palette {
  const index = PALETTES.indexOf(active);
  const next = PALETTES[(index + 1) % PALETTES.length];

  if (!next) {
    return active;
  }

  return setActivePalette(next.id);
}

/** Subscribes to palette changes. Returns the unsubscribe function. */
export function onPaletteChange(listener: (palette: Palette) => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** The current colour of a shade slot, as a 24-bit RGB number for Phaser. */
export function shade(index: ShadeIndex): number {
  const rgb = active.shades[index];

  if (rgb === undefined) {
    // Unreachable: `shades` is a 4-tuple and ShadeIndex is 0..3.
    throw new Error(`palette '${active.id}' has no shade ${index}`);
  }

  return rgb;
}

/** A 24-bit RGB number as a CSS colour, for the few places the DOM needs one. */
export function cssColor(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}
