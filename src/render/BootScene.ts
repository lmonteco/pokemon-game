import Phaser from 'phaser';
import { PLAY_SCENE_KEY } from './PlayScene';

export const BOOT_SCENE_KEY = 'Boot';

/**
 * The scene the game starts in. It holds no gameplay and no assets; it only
 * decides what runs next, which is where later milestones land.
 *
 * From M1-1 on, that is the playable scene. M0-2's render test pattern is
 * still registered and still worth keeping -- it is the only thing that shows
 * the palette and the integer upscale on their own -- but there is now a game
 * to boot into, and booting into a test card instead would be odd.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(BOOT_SCENE_KEY);
  }

  // No `override` modifier: Phaser's Scene type does not declare `create`,
  // the Scene Manager calls it by name if present. `update` *is* declared and
  // does need `override`.
  create(): void {
    this.scene.start(PLAY_SCENE_KEY);
  }
}
