import Phaser from 'phaser';
import { TEST_PATTERN_SCENE_KEY } from './TestPatternScene';

export const BOOT_SCENE_KEY = 'Boot';

/**
 * The scene the game starts in. It holds no gameplay and no assets; it only
 * decides what runs next, which is where later milestones land.
 *
 * Until there is a game to show, that is M0-2's render test pattern -- an
 * empty screen would prove nothing about the pipeline.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(BOOT_SCENE_KEY);
  }

  // No `override` modifier: Phaser's Scene type does not declare `create`,
  // the Scene Manager calls it by name if present. `update` *is* declared and
  // does need `override`.
  create(): void {
    this.scene.start(TEST_PATTERN_SCENE_KEY);
  }
}
