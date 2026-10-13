/**
 * Placeholder projectile art: two travel frames and two impact frames, drawn
 * fresh in four shades (GDD 8.1, 8.2).
 *
 * Original pixels, authored here as glyph maps for the same reason the player
 * is (`playerArt.ts`): they are legible in a diff, and nothing in this
 * repository is ever traced from a Nintendo sprite (GDD 11.2).
 *
 * The shade choice is forced rather than aesthetic, and it is worth writing
 * down because a four-shade screen leaves no room to get it wrong. The floor
 * is `SHADE_DARKEST` and the walls are `SHADE_LIGHT` (`roomArt.ts`). A shot
 * crosses both, so it needs a light core to read against the floor *and* a dark
 * rim to read against the walls -- with only a light core it vanishes the
 * moment it flies over stone. That is why the sprite spends all four shades on
 * something eight pixels across.
 */

import Phaser from 'phaser';
import {
  SHADE_DARK,
  SHADE_DARKEST,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
  cssColor,
  shadeSource,
  type ShadeIndex,
} from './palette';

export const PROJECTILE_SPRITE_KEY = 'projectile';

/** Frame edge in pixels. Slightly wider than a 3-unit collision radius. */
export const PROJECTILE_SPRITE_SIZE = 8;

/** Travel frames, then impact frames, in sheet order. */
export const PROJECTILE_TRAVEL_FRAMES = 2;
export const PROJECTILE_IMPACT_FRAMES = 2;
export const PROJECTILE_FRAME_COUNT = PROJECTILE_TRAVEL_FRAMES + PROJECTILE_IMPACT_FRAMES;

/** Rendered frames each travel pose holds. Four at 60fps is a 7.5Hz shimmer. */
export const TRAVEL_FRAME_TICKS = 4;

export const TRANSPARENT_GLYPH = '.';

const GLYPH_SHADES: Readonly<Record<string, ShadeIndex>> = {
  '#': SHADE_DARKEST,
  o: SHADE_DARK,
  '+': SHADE_LIGHT,
  '*': SHADE_LIGHTEST,
};

/**
 * Travel pose 0: a round bolt, dark-rimmed, with a hot core.
 *
 * The rim is a full ring rather than a highlight on one side. A directional
 * highlight would have to be rotated to match the aim, and a rotated sprite on
 * a 240x160 screen is a blurred sprite (GDD 8.1 draws on whole pixels).
 */
export const TRAVEL_ROUND: readonly string[] = [
  '..####..',
  '.#+oo+#.',
  '#+o**o+#',
  '#o****o#',
  '#o****o#',
  '#+o**o+#',
  '.#+oo+#.',
  '..####..',
];

/** Travel pose 1: the same bolt pulled in a pixel, so the shot crackles. */
export const TRAVEL_TIGHT: readonly string[] = [
  '...##...',
  '..#++#..',
  '.#+**+#.',
  '#+****+#',
  '#+****+#',
  '.#+**+#.',
  '..#++#..',
  '...##...',
];

/** Impact pose 0: the flash, on the frame the shot stops. */
export const IMPACT_FLASH: readonly string[] = [
  '...**...',
  '..****..',
  '.******.',
  '********',
  '********',
  '.******.',
  '..****..',
  '...**...',
];

/** Impact pose 1: the flash blown open into a ring, on its way out. */
export const IMPACT_RING: readonly string[] = [
  '...##...',
  '..#++#..',
  '.#+..+#.',
  '##+..+##',
  '##+..+##',
  '.#+..+#.',
  '..#++#..',
  '...##...',
];

/** Every authored map, in sheet order. */
export const PROJECTILE_ART_MAPS: readonly (readonly string[])[] = [
  TRAVEL_ROUND,
  TRAVEL_TIGHT,
  IMPACT_FLASH,
  IMPACT_RING,
];

/** The travel frame to draw on a given simulation tick. */
export function travelFrame(tick: number): number {
  return Math.floor(tick / TRAVEL_FRAME_TICKS) % PROJECTILE_TRAVEL_FRAMES;
}

/**
 * The impact frame for an impact that has been on screen `age` rendered
 * frames, or -1 once it is finished.
 *
 * Driven by age rather than by a tween so that the mark lives exactly as long
 * as `IMPACT_FRAMES` says and a slow frame cannot stretch it.
 */
export function impactFrame(age: number, lifetime: number): number {
  if (age < 0 || age >= lifetime) {
    return -1;
  }

  const half = Math.ceil(lifetime / 2);

  return PROJECTILE_TRAVEL_FRAMES + (age < half ? 0 : 1);
}

/** Builds the sheet: `PROJECTILE_FRAME_COUNT` cells in one row. */
export function createProjectileArt(scene: Phaser.Scene): void {
  if (scene.textures.exists(PROJECTILE_SPRITE_KEY)) {
    return;
  }

  const size = PROJECTILE_SPRITE_SIZE;
  const texture = scene.textures.createCanvas(
    PROJECTILE_SPRITE_KEY,
    size * PROJECTILE_FRAME_COUNT,
    size,
  );

  if (!texture) {
    throw new Error(`could not create the '${PROJECTILE_SPRITE_KEY}' texture`);
  }

  const context = texture.getContext();

  PROJECTILE_ART_MAPS.forEach((map, frame) => {
    const originX = frame * size;

    map.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const glyph = row[x];

        if (glyph === undefined || glyph === TRANSPARENT_GLYPH) {
          continue;
        }

        const shade = GLYPH_SHADES[glyph];

        if (shade === undefined) {
          throw new Error(`unknown projectile glyph '${glyph}'`);
        }

        context.fillStyle = cssColor(shadeSource(shade));
        context.fillRect(originX + x, y, 1, 1);
      }
    });

    texture.add(frame, 0, originX, 0, size, size);
  });

  texture.refresh();
}
