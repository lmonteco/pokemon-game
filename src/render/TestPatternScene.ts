/**
 * The M0-2 test scene: a sprite, a tilemap patch and text in the GB font,
 * drawn so that a look at the screen tells you whether the pipeline works.
 *
 * What to look for:
 * - the shade bars across the top, four of them, and the gradient under them
 *   reading as four hard steps rather than a ramp;
 * - the 1px checkerboard on the sprite staying as separate pixels at any
 *   window size, and the brick mortar lines staying 1px;
 * - P swapping the palette with everything on screen changing at once.
 *
 * This scene is scaffolding for M0-2 and is expected to go when M1 lands.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';
import { GB_FONT_KEY, GLYPH_HEIGHT, createGbFont } from './gbFont';
import { quantizeScene } from './gameBoyScreen';
import {
  SHADE_DARK,
  SHADE_LIGHT,
  SHADE_LIGHTEST,
  activePalette,
  cyclePalette,
  onPaletteChange,
  shadeSource,
} from './palette';
import {
  SHADE_BARS_KEY,
  TEST_SPRITE_KEY,
  TEST_SPRITE_SIZE,
  TEST_TILES_KEY,
  TILE_BRICK,
  TILE_FLOOR,
  TILE_FLOOR_DITHER,
  TILE_SIZE,
  TILE_WALL,
  createShadeBars,
  createTestSprite,
  createTestTiles,
} from './testArt';

export const TEST_PATTERN_SCENE_KEY = 'TestPattern';

const BAR_HEIGHT = 16;

/** A patch of floor with a wall across the top. Four tiles, laid out by hand. */
const TILEMAP: readonly number[][] = [
  [TILE_BRICK, TILE_BRICK, TILE_WALL, TILE_BRICK, TILE_BRICK, TILE_WALL],
  [TILE_FLOOR, TILE_FLOOR_DITHER, TILE_FLOOR, TILE_FLOOR_DITHER, TILE_FLOOR, TILE_FLOOR],
  [TILE_FLOOR_DITHER, TILE_FLOOR, TILE_FLOOR_DITHER, TILE_FLOOR, TILE_FLOOR_DITHER, TILE_FLOOR],
];

export class TestPatternScene extends Phaser.Scene {
  private label: Phaser.GameObjects.BitmapText | undefined;
  private fps: Phaser.GameObjects.BitmapText | undefined;
  private detachPalette: (() => void) | undefined;

  constructor() {
    super(TEST_PATTERN_SCENE_KEY);
  }

  // No `override`: Phaser's Scene type does not declare `create`, the Scene
  // Manager calls it by name if present. `update` *is* declared and needs it.
  create(): void {
    createGbFont(this);
    createTestSprite(this);
    createTestTiles(this);
    createShadeBars(this, GAME_WIDTH, BAR_HEIGHT);

    const { quantising } = quantizeScene(this);

    this.add.image(0, 0, SHADE_BARS_KEY).setOrigin(0, 0);

    const map = this.make.tilemap({
      data: TILEMAP.map((row) => [...row]),
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tiles = map.addTilesetImage(TEST_TILES_KEY);

    if (tiles) {
      const layer = map.createLayer(0, tiles, 0, BAR_HEIGHT + 8);

      layer?.setScale(1);
    }

    const sprite = this.add.image(
      GAME_WIDTH - TEST_SPRITE_SIZE,
      BAR_HEIGHT + 16,
      TEST_SPRITE_KEY,
    );

    sprite.setOrigin(0.5, 0);

    // Second copy at 2x, to show that a whole-number scale keeps the 1px
    // checkerboard readable while a fractional one would not.
    this.add
      .image(GAME_WIDTH - TEST_SPRITE_SIZE, BAR_HEIGHT + 16 + TEST_SPRITE_SIZE + 4, TEST_SPRITE_KEY)
      .setOrigin(0.5, 0)
      .setScale(2);

    this.label = this.add
      .bitmapText(4, GAME_HEIGHT - GLYPH_HEIGHT * 2 - 6, GB_FONT_KEY, '')
      .setTint(shadeSource(SHADE_LIGHTEST));

    this.fps = this.add
      .bitmapText(4, GAME_HEIGHT - GLYPH_HEIGHT - 2, GB_FONT_KEY, '')
      .setTint(shadeSource(quantising ? SHADE_LIGHT : SHADE_DARK));

    // Text in each shade, so a glance says whether all four reach the screen.
    this.add
      .bitmapText(4, BAR_HEIGHT + 2, GB_FONT_KEY, 'DEEPWILD 240X160')
      .setTint(shadeSource(SHADE_LIGHTEST));

    this.refreshLabel();
    this.detachPalette = onPaletteChange(() => this.refreshLabel());

    this.input.keyboard?.on('keydown-P', () => cyclePalette());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.detachPalette?.();
      this.detachPalette = undefined;
    });
  }

  private refreshLabel(): void {
    const scale = this.scale.zoom;
    const mode = this.game.renderer.type === Phaser.WEBGL ? 'WEBGL' : 'CANVAS';

    this.label?.setText(`${activePalette().name.toUpperCase()} - P SWAPS`);
    this.fps?.setText(`${mode} X${scale}`);
  }

  override update(): void {
    // Cheap enough at 240x160, and the point of the scene is to watch it.
    const scale = this.scale.zoom;
    const mode = this.game.renderer.type === Phaser.WEBGL ? 'WEBGL' : 'CANVAS';

    this.fps?.setText(`${mode} X${scale} ${Math.round(this.game.loop.actualFps)}FPS`);
  }
}
