import Phaser from 'phaser';
import { BOOT_SCENE_KEY, BootScene } from '@/render/BootScene';
import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';

// Scaffold entry point. It boots Phaser into one empty scene and nothing else.
// The Game Boy render pipeline (integer scaling, 4-shade palette) is M0-2;
// the fixed-step simulation loop is M0-3.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#000000',
  pixelArt: true,
  scene: [BootScene],
};

export const game = new Phaser.Game(config);

export { BOOT_SCENE_KEY };
