/**
 * A 5x7 pixel font, drawn for this project.
 *
 * Original art, hand-plotted here rather than loaded from anywhere: GDD 11.2
 * allows Game Boy-*style* art and no ripped assets, and a font is an asset.
 * It is written as '#' and '.' rows so it can be read and edited as pixels
 * instead of as numbers.
 *
 * Glyphs are plotted in the lightest source grey, so the quantise pass turns
 * them into the lightest shade of whichever palette is active. Tint a
 * BitmapText with another source grey to draw it in a different shade.
 *
 * This is the minimum the M0-2 test scene needs. The full GB UI kit is a
 * later milestone and will likely replace it.
 */

import Phaser from 'phaser';
import { SHADE_LIGHTEST, cssColor, shadeSource } from './palette';

/** Texture and bitmap-font cache key. */
export const GB_FONT_KEY = 'gb-font';

/** Drawn size of a glyph. */
export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

/** Cell size on the font sheet. The spare column and row are the spacing. */
const CELL_WIDTH = GLYPH_WIDTH + 1;
const CELL_HEIGHT = GLYPH_HEIGHT + 1;

const CELLS_PER_ROW = 16;

/**
 * The glyphs. Insertion order is the sheet order, so the character set handed
 * to RetroFont is derived from these keys and the two cannot fall out of step.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '>': ['.....', '#....', '.#...', '..#..', '.#...', '#....', '.....'],
};

/** The characters the font can draw, in sheet order. */
export const GB_FONT_CHARS = Object.keys(GLYPHS).join('');

/**
 * Draws the font sheet into a texture and registers it as a bitmap font.
 *
 * Call once from a scene's `create()` before using `GB_FONT_KEY`. Safe to call
 * again: it returns early if the font is already in the cache.
 */
export function createGbFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.has(GB_FONT_KEY)) {
    return;
  }

  const entries = Object.entries(GLYPHS);
  const rows = Math.ceil(entries.length / CELLS_PER_ROW);
  const texture = scene.textures.createCanvas(
    GB_FONT_KEY,
    CELLS_PER_ROW * CELL_WIDTH,
    rows * CELL_HEIGHT,
  );

  if (!texture) {
    throw new Error(`could not create the '${GB_FONT_KEY}' texture`);
  }

  const context = texture.getContext();

  context.fillStyle = cssColor(shadeSource(SHADE_LIGHTEST));

  entries.forEach(([, pixels], index) => {
    const originX = (index % CELLS_PER_ROW) * CELL_WIDTH;
    const originY = Math.floor(index / CELLS_PER_ROW) * CELL_HEIGHT;

    pixels.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') {
          context.fillRect(originX + x, originY + y, 1, 1);
        }
      }
    });
  });

  texture.refresh();

  const font = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: GB_FONT_KEY,
    'offset.x': 0,
    'offset.y': 0,
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    chars: GB_FONT_CHARS,
    charsPerRow: CELLS_PER_ROW,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: 1,
  });

  scene.cache.bitmapFont.add(GB_FONT_KEY, font);
}
