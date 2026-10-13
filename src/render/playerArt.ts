/**
 * The placeholder player sprite: 16x16, four shades, four facings, three poses.
 *
 * Drawn here in code rather than loaded from a file, for the same two reasons
 * as `testArt.ts`. It is original by construction, which GDD 11.2 requires of
 * everything in this repository, and a glyph map in the source is something a
 * reviewer can read and correct without a paint program.
 *
 * It is a placeholder and it is meant to be replaced. What it is *not* is a
 * stand-in for any particular creature: it has no species, no type and no
 * name, because `src/` is not allowed to know about any of those (GDD 11.3).
 * It is a shape with four facings and legs that move.
 *
 * It does follow the one art rule that is not negotiable (GDD 8.2): a 1px
 * outline in the lightest shade, all the way round, so the silhouette reads
 * against a wall, against a floor and against a projectile.
 */

import type Phaser from 'phaser';
import {
  SHADE_DARK,
  SHADE_DARKEST,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
  cssColor,
  shadeSource,
  type ShadeIndex,
} from './palette';

/** Texture cache keys. */
export const PLAYER_SPRITE_KEY = 'player';
export const RETICLE_KEY = 'reticle';
export const AIM_PIP_KEY = 'aim-pip';

/** The plan's placeholder size. GDD 8.1's real sizes start at 24x24. */
export const PLAYER_SPRITE_SIZE = 16;

/** Poses per facing: contact/standing, left step, right step. */
export const PLAYER_POSE_COUNT = 3;

/** Rows of the sheet, one per facing, in `playerInput.ts`'s facing order. */
export const PLAYER_FACING_COUNT = 4;

/** How tall the body half of a glyph map is; the remaining rows are feet. */
export const BODY_ROWS = 13;

/**
 * The glyph alphabet for the maps below.
 *
 * `O` is the outline and uses the lightest shade (GDD 8.2). `M` is the body,
 * `L` is the light detail -- eyes, belly, muzzle -- and `D` is the darkest, for
 * pupils and for the back of a creature facing away. A dot is transparent.
 */
/**
 * The outline (GDD 8.2) and the body, named because the room art has to stay
 * clear of them. A creature whose body is the same shade as the floor it
 * stands on reads as a hollow outline rather than as a creature -- on a
 * four-shade screen there is no third tone to separate them, so the only fix
 * is for the two not to collide. `roomArt.test.ts` holds them apart.
 */
export const PLAYER_OUTLINE_SHADE = SHADE_LIGHTEST;
export const PLAYER_BODY_SHADE = SHADE_DARK;

const GLYPH_SHADES: Readonly<Record<string, ShadeIndex>> = {
  O: PLAYER_OUTLINE_SHADE,
  L: SHADE_LIGHT,
  M: PLAYER_BODY_SHADE,
  D: SHADE_DARKEST,
};

export const TRANSPARENT_GLYPH = '.';

/**
 * The body, rows 0..12, one map per facing.
 *
 * `LEFT` is not authored: it is `RIGHT` mirrored at draw time. A hand-drawn
 * mirror is a chance for the two profiles to disagree by a pixel, and nobody
 * would ever notice which of the two was wrong.
 */
export const BODY_DOWN: readonly string[] = [
  '................',
  '...OO......OO...',
  '..OMMO....OMMO..',
  '..OMMMOOOOMMMO..',
  '.OMMMMMMMMMMMMO.',
  '.OMMLLLMMLLLMMO.',
  '.OMMLDLMMLDLMMO.',
  '.OMMMMMMMMMMMMO.',
  '.OMMMMLLLLMMMMO.',
  '..OMMMLLLLMMMO..',
  '..OMMMMMMMMMMO..',
  '...OMMMMMMMMO...',
  '....OMMMMMMO....',
];

export const BODY_UP: readonly string[] = [
  '................',
  '...OO......OO...',
  '..OMMO....OMMO..',
  '..OMMMOOOOMMMO..',
  '.OMMMMMMMMMMMMO.',
  '.OMMMMMMMMMMMMO.',
  '.OMMMMMMMMMMMMO.',
  '.OMMMMDDDDMMMMO.',
  '.OMMMDDDDDDMMMO.',
  '..OMMMDDDDMMMO..',
  '..OMMMMMMMMMMO..',
  '...OMMMMMMMMO...',
  '....OMMMMMMO....',
];

export const BODY_RIGHT: readonly string[] = [
  '................',
  '.......OO.......',
  '......OMMO......',
  '...OOOMMMOOO....',
  '..OMMMMMMMMMO...',
  '.OMMMLLLMMMMMO..',
  '.OMMMLDLMMMMMMO.',
  '.OMMMMMMMMMMMMO.',
  '.OMMMMMMMLLLMMO.',
  '..OMMMMMMLLLMO..',
  '..OMMMMMMMMMMO..',
  '...OMMMMMMMMO...',
  '....OMMMMMMO....',
];

/**
 * The feet, rows 13..15, one map per pose.
 *
 * Pose 0 is the contact pose, with both feet level; it doubles as the standing
 * pose (see `WALK_CYCLE` in `entities/player.ts`). Poses 1 and 2 shift one foot
 * forward each, which at 16x16 is the whole of a readable walk -- a vertical
 * bob as well would cost a row the sprite does not have.
 */
export const FEET_POSES: readonly (readonly string[])[] = [
  ['....OMMOOMMO....', '....OMO..OMO....', '....OOO..OOO....'],
  ['...OOMMOOMMO....', '...OMMO..OMO....', '...OOO...OOO....'],
  ['....OMMOOMMOO...', '....OMO..OMMO...', '....OOO...OOO...'],
];

/** Every authored map, for the test that checks their shape. */
export const PLAYER_ART_MAPS: readonly (readonly string[])[] = [
  BODY_DOWN,
  BODY_UP,
  BODY_RIGHT,
  ...FEET_POSES,
];

/**
 * The facings, in sprite-sheet row order, each as a body map and whether to
 * mirror it. Matches `FACING_DOWN/UP/LEFT/RIGHT` in `entities/playerInput.ts`,
 * so a facing index is a sheet row.
 */
const FACING_ROWS: readonly { readonly body: readonly string[]; readonly mirror: boolean }[] = [
  { body: BODY_DOWN, mirror: false },
  { body: BODY_UP, mirror: false },
  { body: BODY_RIGHT, mirror: true },
  { body: BODY_RIGHT, mirror: false },
];

/** The sheet frame index for a facing and a pose. */
export function playerFrame(facing: number, pose: number): number {
  return facing * PLAYER_POSE_COUNT + pose;
}

function createCanvas(
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

/** Paints one glyph map into a canvas at an offset, optionally mirrored. */
function drawMap(
  context: CanvasRenderingContext2D,
  rows: readonly string[],
  originX: number,
  originY: number,
  mirror: boolean,
): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const glyph = row[mirror ? row.length - 1 - x : x];

      if (glyph === undefined || glyph === TRANSPARENT_GLYPH) {
        continue;
      }

      const shade = GLYPH_SHADES[glyph];

      if (shade === undefined) {
        throw new Error(`unknown sprite glyph '${glyph}'`);
      }

      context.fillStyle = cssColor(shadeSource(shade));
      context.fillRect(originX + x, originY + y, 1, 1);
    }
  });
}

/**
 * Builds the player sheet: `PLAYER_POSE_COUNT` columns of poses by
 * `PLAYER_FACING_COUNT` rows of facings, and registers it as a spritesheet so
 * a frame index addresses a cell.
 */
export function createPlayerArt(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLAYER_SPRITE_KEY)) {
    return;
  }

  const size = PLAYER_SPRITE_SIZE;
  const texture = createCanvas(
    scene,
    PLAYER_SPRITE_KEY,
    size * PLAYER_POSE_COUNT,
    size * PLAYER_FACING_COUNT,
  );
  const context = texture.getContext();

  FACING_ROWS.forEach((facing, row) => {
    FEET_POSES.forEach((feet, pose) => {
      const originX = pose * size;
      const originY = row * size;

      drawMap(context, facing.body, originX, originY, facing.mirror);
      drawMap(context, feet, originX, originY + BODY_ROWS, facing.mirror);

      // Cut the cell out as a named frame, so `setFrame(playerFrame(f, p))`
      // addresses it. Added here rather than by re-registering the canvas as a
      // spritesheet: a second `addSpriteSheet` under the same key would have to
      // either collide with this texture or replace it, and adding the frames
      // to the texture that owns the canvas keeps one object in the cache.
      texture.add(playerFrame(row, pose), 0, originX, originY, size, size);
    });
  });

  texture.refresh();
}

/**
 * A 5x5 hollow crosshair for the mouse cursor, in the lightest shade.
 *
 * Hollow in the middle so it never hides the thing being aimed at, which on a
 * 240x160 screen could be the entire enemy.
 */
export function createReticle(scene: Phaser.Scene): void {
  if (scene.textures.exists(RETICLE_KEY)) {
    return;
  }

  const texture = createCanvas(scene, RETICLE_KEY, 5, 5);
  const context = texture.getContext();

  context.fillStyle = cssColor(shadeSource(SHADE_LIGHTEST));
  // Four arms, one pixel wide, with a one-pixel gap at the centre.
  context.fillRect(2, 0, 1, 2);
  context.fillRect(2, 3, 1, 2);
  context.fillRect(0, 2, 2, 1);
  context.fillRect(3, 2, 2, 1);

  texture.refresh();
}

/**
 * A 2x2 marker drawn between the player and the cursor: the facing indicator
 * the plan asks for.
 *
 * It exists because the four-direction sprite cannot show the difference
 * between aiming up-left and aiming down-left, and the player needs to see
 * where a move would go before there is a move to fire (GAM-9).
 */
export function createAimPip(scene: Phaser.Scene): void {
  if (scene.textures.exists(AIM_PIP_KEY)) {
    return;
  }

  const texture = createCanvas(scene, AIM_PIP_KEY, 2, 2);
  const context = texture.getContext();

  context.fillStyle = cssColor(shadeSource(SHADE_LIGHTEST));
  context.fillRect(0, 0, 2, 2);

  texture.refresh();
}
