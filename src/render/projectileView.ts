/**
 * Drawing the projectile pool: a pool of sprites to match the pool of shots.
 *
 * Pre-allocated and hidden, never created or destroyed in play, for the same
 * reason the simulation pool is (GDD 9.4). Creating a Phaser image per shot
 * would be 200 object allocations and 200 display-list inserts in a second of
 * sustained fire, and the garbage collector would arrive in the middle of a
 * fight.
 *
 * This file owns no gameplay. It reads the pool's live list and the registry's
 * positions, and it decides nothing -- which is why the pool can be tested
 * headlessly and why nothing in `src/combat` imports Phaser.
 */

import Phaser from 'phaser';
import type { World } from '@/core/world';
import type { ProjectilePool } from '@/combat/projectiles';
import { IMPACT_FRAMES } from '@/combat/tuning';
import {
  PROJECTILE_SPRITE_KEY,
  createProjectileArt,
  impactFrame,
  travelFrame,
} from './projectileArt';

/**
 * Impact marks on screen at once.
 *
 * Far below the projectile cap on purpose: marks live four frames, so the only
 * way to need more than this many is for dozens of shots to land in the same
 * four frames, and at that point the screen is already a wall of white and the
 * missing mark cannot be seen. Sized to be the thing that runs out rather than
 * the thing that allocates.
 */
export const MAX_IMPACT_MARKS = 24;

export class ProjectileView {
  private readonly sprites: Phaser.GameObjects.Image[] = [];
  private readonly marks: Phaser.GameObjects.Image[] = [];

  /** Rendered frames each mark has been on screen. -1 means the slot is free. */
  private readonly markAge: Int32Array;

  /** Round-robin cursor, so a burst overwrites the oldest mark, not the newest. */
  private nextMark = 0;

  constructor(scene: Phaser.Scene, capacity: number) {
    createProjectileArt(scene);

    this.markAge = new Int32Array(MAX_IMPACT_MARKS).fill(-1);

    for (let i = 0; i < capacity; i += 1) {
      this.sprites.push(scene.add.image(0, 0, PROJECTILE_SPRITE_KEY, 0).setVisible(false));
    }
    for (let i = 0; i < MAX_IMPACT_MARKS; i += 1) {
      this.marks.push(scene.add.image(0, 0, PROJECTILE_SPRITE_KEY, 0).setVisible(false));
    }
  }

  /**
   * Installs itself as the pool's impact listener. Separate from the
   * constructor so that the pool does not have to exist first, and so a
   * headless test can run the pool with no listener at all.
   */
  listenTo(pool: ProjectilePool): void {
    pool.onImpact = (x, y) => {
      this.addMark(x, y);
    };
  }

  /** Marks an impact at a world position. Called from the simulation step. */
  addMark(x: number, y: number): void {
    const index = this.nextMark;
    const mark = this.marks[index];

    this.nextMark = (index + 1) % MAX_IMPACT_MARKS;

    if (mark === undefined) {
      return;
    }

    this.markAge[index] = 0;
    mark.setPosition(Math.round(x), Math.round(y));
    mark.setFrame(impactFrame(0, IMPACT_FRAMES));
    mark.setVisible(true);
  }

  /**
   * Draws one frame: every live shot, then every impact mark.
   *
   * Positions are rounded to whole pixels. GDD 8.1 draws on a pixel grid, and
   * a sprite at a fractional coordinate on a 240x160 screen is a smear across
   * two pixels rather than a crisp one.
   */
  draw(world: World, pool: ProjectilePool): void {
    const frame = travelFrame(world.tick);
    const entities = world.entities;
    const live = Math.min(pool.count, this.sprites.length);

    for (let i = 0; i < live; i += 1) {
      const sprite = this.sprites[i];
      const slot = entities.slotOf(pool.idAt(i));

      if (sprite === undefined) {
        continue;
      }
      if (slot === -1) {
        sprite.setVisible(false);
        continue;
      }

      sprite.setPosition(
        Math.round(entities.posX[slot] ?? 0),
        Math.round(entities.posY[slot] ?? 0),
      );
      sprite.setFrame(frame);
      sprite.setVisible(true);
    }

    for (let i = live; i < this.sprites.length; i += 1) {
      this.sprites[i]?.setVisible(false);
    }

    this.ageMarks();
  }

  /** Advances the impact marks by one rendered frame and retires the finished. */
  private ageMarks(): void {
    for (let i = 0; i < MAX_IMPACT_MARKS; i += 1) {
      const age = this.markAge[i] ?? -1;

      if (age < 0) {
        continue;
      }

      const next = impactFrame(age, IMPACT_FRAMES);
      const mark = this.marks[i];

      if (next === -1) {
        this.markAge[i] = -1;
        mark?.setVisible(false);
        continue;
      }

      mark?.setFrame(next);
      this.markAge[i] = age + 1;
    }
  }
}
