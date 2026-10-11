import Phaser from 'phaser';

export const BOOT_SCENE_KEY = 'Boot';

/**
 * Deliberately empty. It exists so the scaffold has a scene to start and
 * later milestones have somewhere to land. No gameplay, no assets.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(BOOT_SCENE_KEY);
  }

  // No `override` modifier: Phaser's Scene type does not declare `create`,
  // the Scene Manager calls it by name if present. `update` *is* declared and
  // does need `override`.
  create(): void {
    // Intentionally blank.
  }
}
