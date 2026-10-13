/**
 * The cooldown bars: one per move slot, bottom-left, pinned to the screen.
 *
 * This is the half of "PP is gone" the player actually sees (GDD 4.4). A
 * cooldown the player cannot read is indistinguishable from a game that
 * ignored the click, so the bar is not decoration -- it is the feedback that
 * makes the rule legible.
 *
 * Two shades carry two different states, which is the most a four-shade screen
 * can do without resorting to text:
 *
 *   - **filling, lightest** -- the cooldown draining back to ready
 *   - **windup, light, filling from the middle out** -- a cast in progress
 *
 * The windup reads differently from the cooldown on purpose. They are opposite
 * things -- one is the game making you wait before the shot, the other after
 * it -- and a player who cannot tell them apart cannot tell why the click did
 * nothing.
 *
 * Drawn with one `Graphics` object cleared and refilled per frame rather than
 * with a sprite per bar: at this size the geometry is four rectangles, and a
 * texture would have to be rebuilt every frame anyway.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT } from '@/core/constants';
import type { MoveCaster } from '@/combat/moves';
import { SHADE_DARKEST, SHADE_LIGHT, SHADE_LIGHTEST, shadeSource } from './palette';

/** Bar geometry in screen pixels, on the 240x160 screen of GDD 8.1. */
export const BAR_WIDTH = 24;
export const BAR_HEIGHT = 5;
export const BAR_GAP = 2;
export const HUD_MARGIN = 3;

/** Baseline: clear of the readout line, which sits on the bottom margin. */
export const HUD_BOTTOM = GAME_HEIGHT - 13;

export class CooldownHud {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Above the world, below nothing: the HUD is the last thing drawn.
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(1000);
  }

  /** The left edge of the bar for a slot. */
  private barX(slot: number): number {
    return HUD_MARGIN + slot * (BAR_WIDTH + BAR_GAP);
  }

  /** Redraws every bar. Call once per rendered frame. */
  draw(caster: MoveCaster): void {
    const g = this.graphics;
    const y = HUD_BOTTOM - BAR_HEIGHT;

    g.clear();

    for (let slot = 0; slot < caster.moves.length; slot += 1) {
      const x = this.barX(slot);

      // The trough. Darkest, so an empty bar is still a bar: a slot drawn only
      // when it has something in it would read as the move having disappeared.
      g.fillStyle(shadeSource(SHADE_DARKEST), 1);
      g.fillRect(x, y, BAR_WIDTH, BAR_HEIGHT);

      const casting = caster.isCasting && caster.selectedSlot === slot;

      if (casting) {
        // Windup: a light block growing out of the centre. Growing outward
        // rather than left to right because it has to be unmistakable at a
        // glance against the cooldown bar immediately below it.
        const half = Math.round(((BAR_WIDTH - 2) / 2) * caster.castProgress());

        g.fillStyle(shadeSource(SHADE_LIGHT), 1);
        g.fillRect(
          x + 1 + Math.floor((BAR_WIDTH - 2) / 2) - half,
          y + 1,
          Math.max(1, half * 2),
          BAR_HEIGHT - 2,
        );
        continue;
      }

      const filled = Math.round((BAR_WIDTH - 2) * caster.readiness(slot));

      if (filled <= 0) {
        continue;
      }

      g.fillStyle(shadeSource(SHADE_LIGHTEST), 1);
      g.fillRect(x + 1, y + 1, filled, BAR_HEIGHT - 2);
    }
  }
}
