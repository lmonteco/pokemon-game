/**
 * The Game Boy screen: 240x160 internal, whole-number upscale, four shades.
 *
 * Everything about "how the game looks" lives here so that no later task has
 * to think about it. A scene calls `quantizeScene(this)` in `create()` and is
 * done; the rest is set up once by `gameBoyGameConfig()` and
 * `installGameBoyScreen()`.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';
import {
  SHADE_DARKEST,
  activePalette,
  cssColor,
  onPaletteChange,
  shade,
  shadeSource,
  type Palette,
} from './palette';
import { integerZoom } from './integerZoom';
import { LUMA_B, LUMA_G, LUMA_R, paletteRampBands } from './quantize';

/**
 * The game config for the handheld screen.
 *
 * The scale mode is `NONE` with an integer zoom rather than `FIT`. `FIT`
 * scales by whatever fraction fills the window, so a game pixel lands on 3.4
 * screen pixels and the browser renders some of them 3 wide and some 4 -- the
 * pixels stop being square and the art looks subtly wrong at most window
 * sizes. `MAX_ZOOM` is the largest whole multiple that fits, and
 * `keepIntegerZoom()` keeps it whole through every resize. What is left over
 * is letterboxing, which is honest.
 */
export function gameBoyGameConfig(
  scene: Phaser.Types.Scenes.SceneType[],
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    // Shows only where nothing is drawn at all. Keeping it a palette shade
    // means even an empty frame cannot put a fifth colour on screen.
    backgroundColor: shade(SHADE_DARKEST),
    // Phaser only reads this once, so it does not follow a palette swap. It
    // is covered by the camera backdrop on every frame the game draws.
    // Turns off texture smoothing and sets the canvas to
    // `image-rendering: pixelated`, so the CSS upscale is nearest-neighbour
    // too. Without this the whole screen is bilinear mush.
    pixelArt: true,
    // Sub-pixel movement is allowed and rounded at draw time (GDD 8.1): free
    // movement without the art landing between pixels.
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.ScaleModes.NONE,
      zoom: Phaser.Scale.Zoom.MAX_ZOOM,
      // The page centres the canvas with a CSS grid. Phaser's autoCenter
      // writes margins, which would fight it.
      autoCenter: Phaser.Scale.Center.NO_CENTER,
    },
    scene,
  };
}

/**
 * Keeps the canvas at a whole-number multiple of 240x160 as the window
 * changes size. Returns a function that stops watching.
 *
 * `MAX_ZOOM` in the config is only read once at boot, so without this the
 * canvas would keep its launch zoom forever.
 */
export function keepIntegerZoom(scale: Phaser.Scale.ScaleManager): () => void {
  const update = (): void => {
    // Our own `integerZoom` rather than Phaser's `getMaxZoom`, which computes
    // the same thing: this is the one number that decides whether pixels come
    // out square, and `integerZoom.test.ts` sweeps it over window sizes that
    // no screenshot could cover.
    const zoom = integerZoom(scale.parentSize.width, scale.parentSize.height);

    // Guarded because `setZoom` refreshes, which emits RESIZE again. One
    // extra pass settles it; without the guard it would not stop.
    if (scale.zoom !== zoom) {
      scale.setZoom(zoom);
    }
  };

  scale.on(Phaser.Scale.Events.RESIZE, update);
  update();

  return () => {
    scale.off(Phaser.Scale.Events.RESIZE, update);
  };
}

/**
 * Paints the page behind the canvas in the darkest shade, so the letterbox
 * bars belong to the palette instead of being a colour of their own.
 */
function paintPage(palette: Palette): void {
  if (typeof document === 'undefined') {
    return;
  }

  const color = cssColor(palette.shades[SHADE_DARKEST]);

  document.documentElement.style.background = color;
  document.body.style.background = color;
}

/**
 * Sets up everything that belongs to the game rather than to a scene: integer
 * scaling and the page backdrop. Call once, right after `new Phaser.Game`.
 * Returns a function that undoes it.
 */
export function installGameBoyScreen(game: Phaser.Game): () => void {
  const detachZoom = keepIntegerZoom(game.scale);

  paintPage(activePalette());
  const detachPalette = onPaletteChange(paintPage);

  return () => {
    detachZoom();
    detachPalette();
  };
}

export interface QuantizeHandle {
  /**
   * Whether the quantise pass is running. `false` means the browser gave us
   * no WebGL and the scene is drawing straight to a Canvas context, so colours
   * come out as drawn rather than snapped to the palette.
   */
  readonly quantising: boolean;
  /** Stops following palette changes and removes the filter. */
  readonly detach: () => void;
}

/**
 * Quantises a scene's main camera to the four shades of the active palette,
 * and keeps it on the active palette from then on.
 *
 * The pass is Phaser's GradientMap filter over a ColorRamp of four flat bands
 * (see `quantize.ts`). It is an internal camera filter, so it costs one
 * full-screen pass over a 240x160 texture -- about 38k pixels, which is
 * nothing against the budget in GDD 9.4.
 *
 * If WebGL is unavailable the filter is skipped rather than failing to boot:
 * the scene still runs and still uses palette colours, it just does not snap
 * anything that was drawn off-palette. GDD 8.1 is a look, not a reason to show
 * the player a blank page.
 */
export function quantizeScene(scene: Phaser.Scene): QuantizeHandle {
  const camera = scene.cameras.main;

  if (scene.game.renderer.type !== Phaser.WEBGL) {
    // No quantise pass, so nothing remaps the source greys. Paint the backdrop
    // in the palette's real darkest shade so at least the frame and the
    // letterbox around it agree.
    const paintCamera = (palette: Palette): void => {
      camera.setBackgroundColor(palette.shades[SHADE_DARKEST]);
    };

    paintCamera(activePalette());

    const detachPalette = onPaletteChange(paintCamera);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, detachPalette);

    return { quantising: false, detach: detachPalette };
  }

  // Opaque, so every pixel reaching the filter has alpha and the pass never
  // has to deal with a transparent sample. Drawn in the darkest source grey
  // rather than a palette colour, because it goes through the quantiser like
  // everything else and comes out as the palette's darkest shade.
  camera.setBackgroundColor(shadeSource(SHADE_DARKEST));

  const filter = camera.filters.internal.addGradientMap({
    ramp: paletteRampBands(activePalette()),
    // Brightness weights. These must match `quantize.ts` or the tested
    // function stops describing what the GPU actually does.
    colorFactor: [LUMA_R, LUMA_G, LUMA_B, 0],
    color: [0, 0, 0, 0],
    // The camera is opaque, so there is nothing to unpremultiply, and leaving
    // it on would divide by a zero alpha on any pixel that slipped through.
    unpremultiply: false,
    // Dithering would blend between shades, which is the one thing a 4-shade
    // screen must not do.
    dither: false,
    alpha: 1,
  });

  const repaint = (palette: Palette): void => {
    // Rewrites the ramp's data texture in place. Same band count, so no
    // shader recompile: the swap costs nothing and needs no reload. The
    // camera backdrop needs no change -- it is a source grey, and the new
    // ramp remaps it along with everything else.
    filter.ramp.setBands(paletteRampBands(palette));
  };

  const detachPalette = onPaletteChange(repaint);

  const detach = (): void => {
    detachPalette();
    camera.filters.internal.remove(filter);
  };

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, detachPalette);

  return { quantising: true, detach };
}
