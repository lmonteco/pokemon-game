import Phaser from 'phaser';
import { BOOT_SCENE_KEY, BootScene } from '@/render/BootScene';
import { gameBoyGameConfig, installGameBoyScreen } from '@/render/gameBoyScreen';
import { PLAY_SCENE_KEY, PlayScene } from '@/render/PlayScene';
import { TEST_PATTERN_SCENE_KEY, TestPatternScene } from '@/render/TestPatternScene';

// Entry point. Everything about how the screen looks -- 240x160, whole-number
// upscale, four shades, palette backdrop -- lives in `render/gameBoyScreen.ts`
// (M0-2), so this file only registers the scenes. Phaser starts the first one
// in the list; `BootScene` decides what follows.
export const game = new Phaser.Game(gameBoyGameConfig([BootScene, PlayScene, TestPatternScene]));

installGameBoyScreen(game);

export { BOOT_SCENE_KEY, PLAY_SCENE_KEY, TEST_PATTERN_SCENE_KEY };
