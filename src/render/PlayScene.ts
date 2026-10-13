/**
 * The playable scene: a room, a player, a camera (GDD 4.1, 7, 8.1).
 *
 * This is where M1-1's question gets answered. Everything that decides how
 * movement behaves lives elsewhere and is tested there -- the controller in
 * `entities/player.ts`, collision in `dungeon/tileCollision.ts`, the camera in
 * `render/followCamera.ts`. This file owns only the things a test cannot have
 * an opinion about: which textures exist, where sprites are drawn, and the
 * bridge from a browser frame into the fixed-step simulation.
 *
 * The one rule it has to keep is GDD 11.3: no content in code. The species and
 * the room both come out of `data/`, chosen by a rule stated in engine terms,
 * and no name of either appears anywhere below.
 */

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/core/constants';
import { World } from '@/core/world';
import { content } from '@/content';
import type { RoomTemplate, Species } from '@/content/schema/index.ts';
import { PlayerController } from '@/entities/player';
import { playerStartPixel, tileGridFromRoom } from '@/dungeon/tileGrid';
import {
  AIM_DEADZONE,
  CAMERA_DEADZONE_HALF_HEIGHT,
  CAMERA_DEADZONE_HALF_WIDTH,
  PLAYER_BOX_OFFSET_Y,
} from '@/entities/tuning';
import { DeviceInput } from './deviceInput';
import { FollowCamera } from './followCamera';
import { GB_FONT_KEY, GLYPH_HEIGHT, createGbFont } from './gbFont';
import { quantizeScene } from './gameBoyScreen';
import { SHADE_LIGHTEST, cyclePalette, shadeSource } from './palette';
import {
  AIM_PIP_KEY,
  PLAYER_SPRITE_KEY,
  RETICLE_KEY,
  createAimPip,
  createPlayerArt,
  createReticle,
  playerFrame,
} from './playerArt';
import { ROOM_TILES_KEY, createRoomTiles, roomTilemapData } from './roomArt';

export const PLAY_SCENE_KEY = 'Play';

/** How far along the aim direction the facing pip is drawn, in world units. */
const AIM_PIP_DISTANCE = 13;

/**
 * The room to play in: the largest template in `data/`.
 *
 * A rule rather than an id, because naming a room template here would put
 * content in code (GDD 11.3). "Largest" is the right rule for this scene
 * specifically: M1-1 is about whether running around feels good, which needs
 * somewhere to run, and it has to be bigger than the 240x160 screen for the
 * camera to do anything at all.
 *
 * Ties break on id so the choice is stable from run to run.
 */
export function chooseRoom(rooms: readonly RoomTemplate[]): RoomTemplate {
  const sorted = [...rooms].sort((a, b) => {
    const byArea = b.width * b.height - a.width * a.height;

    return byArea === 0 ? a.id.localeCompare(b.id) : byArea;
  });
  const chosen = sorted[0];

  if (chosen === undefined) {
    throw new Error('data/rooms is empty; there is nowhere to play');
  }

  return chosen;
}

/**
 * The species to play as: the first in `data/`, in file order.
 *
 * A placeholder for a real choice -- picking your Pokemon is GDD 6.5's hub,
 * which is a later milestone. What matters now is that it comes from the data
 * and that this file does not know its name.
 */
export function chooseSpecies(species: readonly Species[]): Species {
  const chosen = species[0];

  if (chosen === undefined) {
    throw new Error('data/species.json is empty; there is nobody to play as');
  }

  return chosen;
}

export class PlayScene extends Phaser.Scene {
  private world: World | undefined;
  private player: PlayerController | undefined;
  private camera: FollowCamera | undefined;
  private device: DeviceInput | undefined;

  private sprite: Phaser.GameObjects.Image | undefined;
  private reticle: Phaser.GameObjects.Image | undefined;
  private aimPip: Phaser.GameObjects.Image | undefined;
  private readout: Phaser.GameObjects.BitmapText | undefined;

  constructor() {
    super(PLAY_SCENE_KEY);
  }

  // No `override`: Phaser's Scene type does not declare `create`; the Scene
  // Manager calls it by name if present. `update` *is* declared and needs it.
  create(): void {
    const room = chooseRoom(content.rooms);
    const species = chooseSpecies(content.species);
    const grid = tileGridFromRoom(room);
    const start = playerStartPixel(room);

    createGbFont(this);
    createRoomTiles(this);
    createPlayerArt(this);
    createReticle(this);
    createAimPip(this);

    quantizeScene(this);

    const world = new World({ seed: `m1-1-${room.id}` });
    const player = new PlayerController(world, grid, {
      // GDD 4.4: the Speed base stat is the only thing that decides how fast
      // the player moves, and it comes from the data file.
      speedStat: species.baseStats.speed,
      startX: start.x,
      startY: start.y,
    });

    world.addSystem('player', (w) => player.step(w));

    this.drawRoom(room);

    this.sprite = this.add.image(start.x, start.y - PLAYER_BOX_OFFSET_Y, PLAYER_SPRITE_KEY);
    this.aimPip = this.add.image(start.x, start.y, AIM_PIP_KEY);
    this.reticle = this.add.image(start.x, start.y, RETICLE_KEY);

    const camera = new FollowCamera({
      viewWidth: GAME_WIDTH,
      viewHeight: GAME_HEIGHT,
      worldWidth: grid.widthPx,
      worldHeight: grid.heightPx,
      deadzoneHalfWidth: CAMERA_DEADZONE_HALF_WIDTH,
      deadzoneHalfHeight: CAMERA_DEADZONE_HALF_HEIGHT,
    });

    camera.centreOn(start.x, start.y);
    this.cameras.main.setScroll(camera.left, camera.top);

    const device = new DeviceInput(this);

    // Seeded to the player's own position so the aim starts neutral rather
    // than pointing at the top-left corner of the room.
    device.setPointerWorld(start.x, start.y);

    world.setInputSource((_tick, out) => {
      device.write(out, player.x(world), player.y(world));
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      device.setPointerWorld(pointer.worldX, pointer.worldY);
    });

    // The reticle replaces the cursor, so the player has one thing to track
    // rather than two a few pixels apart.
    this.input.setDefaultCursor('none');

    // The readout is scaffolding for this task: the acceptance criteria
    // include 60fps and a speed that comes from `data/`, and both are easier
    // to confirm when the screen says what they are.
    this.readout = this.add
      .bitmapText(3, GAME_HEIGHT - GLYPH_HEIGHT - 3, GB_FONT_KEY, '')
      .setTint(shadeSource(SHADE_LIGHTEST))
      .setScrollFactor(0);

    this.input.keyboard?.on('keydown-P', () => cyclePalette());

    this.world = world;
    this.player = player;
    this.camera = camera;
    this.device = device;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.setDefaultCursor('default');
      this.device?.destroy();
      this.device = undefined;
    });
  }

  /** Lays the room out as a tilemap. Static, so it is built once. */
  private drawRoom(room: RoomTemplate): void {
    const map = this.make.tilemap({
      data: roomTilemapData(room),
      tileWidth: 16,
      tileHeight: 16,
    });
    const tileset = map.addTilesetImage(ROOM_TILES_KEY);

    if (tileset) {
      map.createLayer(0, tileset, 0, 0);
    }
  }

  override update(_time: number, delta: number): void {
    const world = this.world;
    const player = this.player;
    const camera = this.camera;
    const device = this.device;

    if (!world || !player || !camera || !device) {
      return;
    }

    // Real elapsed time in, whole simulation steps out. The loop decides how
    // many and caps the catch-up, so a tab that was in the background for a
    // minute does not run a minute of simulation in one frame.
    world.advance(delta);

    const x = player.x(world);
    const y = player.y(world);

    // The camera follows once per rendered frame rather than once per
    // simulation step: it is presentation, and following it per step would
    // make the scroll depend on how many steps a frame happened to buy.
    camera.follow(x, y);
    this.cameras.main.setScroll(camera.left, camera.top);

    this.sprite?.setPosition(x, player.spriteY(world));
    this.sprite?.setFrame(playerFrame(player.facing, player.animationPose()));

    // The pip sits between the player and the cursor, and shows the aim the
    // four-direction sprite cannot: facing up-left and down-left draw the same
    // frame. Hidden while the cursor is inside the aim deadzone, which is the
    // one time the aim direction is meaningless.
    const aimDistance = Math.hypot(device.pointer.x - x, device.pointer.y - y);

    if (aimDistance > AIM_DEADZONE) {
      this.aimPip?.setVisible(true);
      this.aimPip?.setPosition(
        Math.round(x + player.aim.x * AIM_PIP_DISTANCE),
        Math.round(player.spriteY(world) + player.aim.y * AIM_PIP_DISTANCE),
      );
    } else {
      this.aimPip?.setVisible(false);
    }

    this.reticle?.setPosition(Math.round(device.pointer.x), Math.round(device.pointer.y));

    this.readout?.setText(
      `${Math.round(this.game.loop.actualFps)}FPS ` +
        `SPD ${Math.round(player.topSpeed)} ` +
        `V ${Math.round(player.speed(world))}`,
    );
  }
}
