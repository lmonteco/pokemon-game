import Phaser from 'phaser';
import { BOOT_SCENE_KEY, BootScene } from '@/render/BootScene';
import { gameBoyGameConfig, installGameBoyScreen } from '@/render/gameBoyScreen';

// Entry point. Everything about how the screen looks -- 240x160, whole-number
// upscale, four shades, palette backdrop -- lives in `render/gameBoyScreen.ts`
// (M0-2), so this file only chooses which scene boots.
export const game = new Phaser.Game(gameBoyGameConfig([BootScene]));

installGameBoyScreen(game);

export { BOOT_SCENE_KEY };
