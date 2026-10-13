/**
 * The keyboard and the mouse, turned into one frame of simulation input
 * (GDD 7).
 *
 * This is the only file in the game that touches an input device, and it is
 * the device half of the seam described in `entities/playerInput.ts`. The
 * simulation never sees a Phaser key or a pointer -- it reads
 * `world.input.buttons` and an aim vector, both plain numbers. That is what
 * lets a run be replayed from a recorded log and lets the balance harness in
 * GDD 9.3 drive the player with no browser at all.
 *
 * Polled, not event-driven, and the distinction matters. A fixed-step loop can
 * run several simulation steps for one rendered frame (`core/loop.ts`), and
 * every one of those steps must see the same input or the same held key would
 * produce a different result depending on how long the browser took to paint.
 * Polling the device once per step gives exactly that.
 */

import Phaser from 'phaser';
import type { FrameInput } from '@/core/world';
import {
  BUTTON_DODGE,
  BUTTON_FIRE,
  BUTTON_MOVE_DOWN,
  BUTTON_MOVE_LEFT,
  BUTTON_MOVE_RIGHT,
  BUTTON_MOVE_UP,
} from '@/entities/playerInput';

/**
 * The default key map (GDD 7: WASD move, Space dodge).
 *
 * A table rather than a chain of `if`s because GDD 7 promises remappable keys
 * as an accessibility feature. Remapping is not built here -- it is not in
 * M1-1 -- but when it is, it replaces this array and touches nothing else.
 *
 * The arrow keys are bound alongside WASD from the start. It costs two lines
 * and it is the first thing a player with one hand on the mouse tries.
 */
export interface KeyBinding {
  readonly code: number;
  readonly button: number;
}

export const DEFAULT_KEY_BINDINGS: readonly KeyBinding[] = [
  { code: Phaser.Input.Keyboard.KeyCodes.W, button: BUTTON_MOVE_UP },
  { code: Phaser.Input.Keyboard.KeyCodes.A, button: BUTTON_MOVE_LEFT },
  { code: Phaser.Input.Keyboard.KeyCodes.S, button: BUTTON_MOVE_DOWN },
  { code: Phaser.Input.Keyboard.KeyCodes.D, button: BUTTON_MOVE_RIGHT },
  { code: Phaser.Input.Keyboard.KeyCodes.UP, button: BUTTON_MOVE_UP },
  { code: Phaser.Input.Keyboard.KeyCodes.LEFT, button: BUTTON_MOVE_LEFT },
  { code: Phaser.Input.Keyboard.KeyCodes.DOWN, button: BUTTON_MOVE_DOWN },
  { code: Phaser.Input.Keyboard.KeyCodes.RIGHT, button: BUTTON_MOVE_RIGHT },
  { code: Phaser.Input.Keyboard.KeyCodes.SPACE, button: BUTTON_DODGE },
];

/**
 * Mouse-button masks, as the DOM reports them in `MouseEvent.buttons` and as
 * Phaser forwards them on `Pointer.buttons`. Not the same numbering as
 * `MouseEvent.button`, which is an index rather than a mask.
 */
export const POINTER_LEFT = 1;
export const POINTER_RIGHT = 2;
export const POINTER_MIDDLE = 4;

/**
 * The mouse-button map (GDD 7). The same shape as `KeyBinding`, and for the
 * same reason: firing is a *binding* from a device button to a simulation bit,
 * so it is remappable and so the simulation never learns that a mouse exists.
 *
 * A raw `POINTER_DOWN` listener would have been two lines shorter and wrong in
 * two ways. It is an edge, so a held button fires once instead of repeating at
 * the cooldown; and it arrives on a browser event rather than on a simulation
 * step, so the same click would land on a different tick depending on how long
 * the frame took -- which breaks replay (see the polling note above).
 */
export interface PointerBinding {
  readonly mask: number;
  readonly button: number;
}

export const DEFAULT_POINTER_BINDINGS: readonly PointerBinding[] = [
  { mask: POINTER_LEFT, button: BUTTON_FIRE },
];

/** Where the cursor is, in world units. */
export interface PointerWorldPosition {
  x: number;
  y: number;
}

/**
 * Reads a scene's devices. Create one in `create()`, call `write` once per
 * simulation step.
 */
export class DeviceInput {
  private readonly scene: Phaser.Scene;
  private readonly keys: { readonly key: Phaser.Input.Keyboard.Key; readonly button: number }[] =
    [];
  private readonly pointerBindings: readonly PointerBinding[];

  /**
   * The last known cursor position in world units.
   *
   * Remembered rather than read fresh every step because a pointer that has
   * never moved reports (0, 0), which would aim the player at the top-left
   * corner of the room until the player first twitched the mouse. Seeded by
   * the scene to the player's own position instead, which reads as "no aim
   * yet" and holds the sprite's facing where it started.
   */
  readonly pointer: PointerWorldPosition = { x: 0, y: 0 };

  constructor(
    scene: Phaser.Scene,
    bindings = DEFAULT_KEY_BINDINGS,
    pointerBindings = DEFAULT_POINTER_BINDINGS,
  ) {
    this.scene = scene;
    this.pointerBindings = pointerBindings;

    const keyboard = scene.input.keyboard;

    if (keyboard) {
      bindings.forEach(({ code, button }) => {
        this.keys.push({ key: keyboard.addKey(code), button });
      });
    }

    // Stops WASD and the arrows from scrolling the page or jumping the caret
    // while the game has focus. Without it, holding S scrolls the browser
    // window down and the game appears to drift off screen.
    keyboard?.addCapture(bindings.map((binding) => binding.code));
  }

  /**
   * Follows the mouse. The scene calls this from its pointer handler rather
   * than this class subscribing, so the scene stays in charge of converting
   * screen coordinates into world ones -- that conversion needs the camera,
   * and the camera is the scene's.
   */
  setPointerWorld(x: number, y: number): void {
    this.pointer.x = x;
    this.pointer.y = y;
  }

  /**
   * Writes the current device state into `out` as one frame of intent.
   *
   * `aimX`/`aimY` are the offset from the player to the cursor, not a
   * normalised direction: normalising is the simulation's job
   * (`entities/playerInput.ts`), and the raw offset is what carries the
   * distance the aim deadzone needs.
   */
  write(out: FrameInput, playerX: number, playerY: number): void {
    let buttons = 0;

    for (let i = 0; i < this.keys.length; i += 1) {
      const binding = this.keys[i];

      if (binding !== undefined && binding.key.isDown) {
        buttons |= binding.button;
      }
    }

    // Polled from the active pointer's held-button mask, not from a down
    // event, so that several simulation steps inside one browser frame all see
    // the same button state.
    const pointerButtons = this.scene.input.activePointer?.buttons ?? 0;

    for (let i = 0; i < this.pointerBindings.length; i += 1) {
      const binding = this.pointerBindings[i];

      if (binding !== undefined && (pointerButtons & binding.mask) !== 0) {
        buttons |= binding.button;
      }
    }

    out.buttons = buttons;
    out.aimX = this.pointer.x - playerX;
    out.aimY = this.pointer.y - playerY;
  }

  /** Releases the keys this took capture of. */
  destroy(): void {
    const keyboard = this.scene.input.keyboard;

    this.keys.forEach(({ key }) => {
      keyboard?.removeKey(key);
    });
    this.keys.length = 0;
  }
}
