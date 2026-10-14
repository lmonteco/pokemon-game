/**
 * The stamina pips: three blocks above the cooldown bars (GDD 4.4, 7).
 *
 * The meter is the resource that replaced PP, and a resource the player cannot
 * see is not a resource -- it is the game refusing a button for reasons of its
 * own. So the pips have to answer two questions at a glance, from the corner
 * of the eye, mid-fight:
 *
 *   - **how many dashes do I have?** -- solid blocks, lightest shade
 *   - **when does the next one land?** -- the leftmost empty block fills from
 *     the bottom up, in the mid shade
 *
 * A column fill rather than a left-to-right one, and in a different shade from
 * a full pip, because the two states have to be distinguishable at 5x5 pixels
 * on a four-shade screen. A partial pip drawn in the same shade as a full one
 * reads as a full pip that someone drew badly, and the player commits to a
 * dash they do not have.
 *
 * Geometry is derived from `cooldownHud.ts` rather than restated, so the two
 * rows of HUD cannot drift apart when either is nudged.
 *
 * One `Graphics` cleared and refilled per frame, like the cooldown bars: the
 * whole thing is six rectangles.
 */

import Phaser from 'phaser';
import type { DodgeMeter } from '@/entities/dodge';
import { DODGE_PIP_MAX } from '@/entities/tuning';
import { BAR_HEIGHT, HUD_BOTTOM, HUD_MARGIN } from './cooldownHud';
import { SHADE_DARKEST, SHADE_LIGHT, SHADE_LIGHTEST, shadeSource } from './palette';

/** Pip geometry in screen pixels, on the 240x160 screen of GDD 8.1. */
export const PIP_SIZE = 5;
export const PIP_GAP = 2;

/** Pixels between the pip row and the cooldown bars below it. */
export const PIP_ROW_GAP = 2;

/** Top of the pip row: clear of the cooldown bars, which sit on HUD_BOTTOM. */
export const PIP_ROW_Y = HUD_BOTTOM - BAR_HEIGHT - PIP_ROW_GAP - PIP_SIZE;

export class DodgeHud {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Same depth band as the cooldown bars: the HUD is the last thing drawn.
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(1000);
  }

  /** The left edge of a pip. */
  private pipX(index: number): number {
    return HUD_MARGIN + index * (PIP_SIZE + PIP_GAP);
  }

  /** Redraws the row. Call once per rendered frame. */
  draw(dodge: DodgeMeter): void {
    const g = this.graphics;
    const pips = dodge.pips;

    g.clear();

    for (let index = 0; index < DODGE_PIP_MAX; index += 1) {
      const x = this.pipX(index);

      // The socket. Drawn under every pip, full or empty, so the row is always
      // three things: a pip that vanished when spent would read as the meter
      // having shrunk rather than as a dash having been used.
      g.fillStyle(shadeSource(SHADE_DARKEST), 1);
      g.fillRect(x, PIP_ROW_Y, PIP_SIZE, PIP_SIZE);

      if (index < pips) {
        g.fillStyle(shadeSource(SHADE_LIGHTEST), 1);
        g.fillRect(x + 1, PIP_ROW_Y + 1, PIP_SIZE - 2, PIP_SIZE - 2);
        continue;
      }

      // Only the next pip in line is recharging -- that is what "one at a
      // time" means (`entities/dodge.ts`) -- so every socket past it stays
      // empty. Drawing them all filling together would promise the whole
      // meter back at once.
      if (index > pips || pips >= DODGE_PIP_MAX) {
        continue;
      }

      const inner = PIP_SIZE - 2;
      const filled = Math.round(inner * dodge.rechargeProgress());

      if (filled <= 0) {
        continue;
      }

      g.fillStyle(shadeSource(SHADE_LIGHT), 1);
      g.fillRect(x + 1, PIP_ROW_Y + 1 + (inner - filled), inner, filled);
    }
  }
}
