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
import type { Move, RoomTemplate, Species } from '@/content/schema/index.ts';
import { PlayerController } from '@/entities/player';
import { playerStartPixel, tileGridFromRoom } from '@/dungeon/tileGrid';
import {
  AIM_DEADZONE,
  CAMERA_DEADZONE_HALF_HEIGHT,
  CAMERA_DEADZONE_HALF_WIDTH,
  PLAYER_BOX_OFFSET_Y,
} from '@/entities/tuning';
import { BUTTON_FIRE } from '@/entities/playerInput';
import { DODGE_PHASE_NAMES } from '@/entities/dodge';
import { MOVE_SLOTS, MoveCaster, fireHeld } from '@/combat/moves';
import { projectileOnlyShapes } from '@/combat/moveShapes';
import { ProjectilePool } from '@/combat/projectiles';
import { MAX_LIVE_PROJECTILES } from '@/combat/tuning';
import { CooldownHud } from './cooldownHud';
import { DeviceInput } from './deviceInput';
import { DodgeHud } from './dodgeHud';
import { ProjectileView } from './projectileView';
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
 * The level the player starts a run at. Placeholder for GDD 6.1's progression,
 * which is a later milestone; what it is used for here is deciding which of a
 * species' learnset entries are available, so that the equipped moves come out
 * of `data/` by a rule rather than by being named.
 */
const STARTING_LEVEL = 1;

/**
 * How many shots a tick the performance harness fires. Eight a tick is 480 a
 * second against a pool of 200 that drains in under one, which saturates the
 * cap and holds it there -- the condition GDD 9.4's budget is stated for.
 */
const STRESS_SHOTS_PER_TICK = 8;

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

/**
 * The moves the player has equipped: the species' own learnset, up to the four
 * slots of GDD 4.2.
 *
 * A rule over the data, like `chooseRoom` and `chooseSpecies`, so that no move
 * id appears in `src/` (GDD 11.3). Picking the move is GDD 6.3's mastery tree,
 * which is a later milestone; until then "everything it knows at its starting
 * level, in learnset order" is the rule.
 */
export function chooseMoves(species: Species, moves: readonly Move[]): Move[] {
  const byId = new Map(moves.map((move) => [move.id, move]));
  const equipped: Move[] = [];

  for (const entry of species.learnset) {
    if (entry.level > STARTING_LEVEL) {
      continue;
    }

    const move = byId.get(entry.moveId);

    if (move !== undefined && !equipped.includes(move)) {
      equipped.push(move);
    }
    if (equipped.length === MOVE_SLOTS) {
      break;
    }
  }

  if (equipped.length === 0) {
    throw new Error(
      `"${species.id}" knows no move at level ${STARTING_LEVEL}; there is nothing to fire`,
    );
  }

  return equipped;
}

export class PlayScene extends Phaser.Scene {
  private world: World | undefined;
  private player: PlayerController | undefined;
  private camera: FollowCamera | undefined;
  private device: DeviceInput | undefined;
  private caster: MoveCaster | undefined;
  private pool: ProjectilePool | undefined;
  private projectiles: ProjectileView | undefined;
  private hud: CooldownHud | undefined;
  private dodgeHud: DodgeHud | undefined;

  /**
   * Scaffolding for the GDD 9.4 performance gate, toggled with F.
   *
   * One player firing one move keeps two shots in the air, and the budget is
   * 200. There is no way to see whether 200 hold 60fps without a way to put
   * 200 on the screen, and a harness that fires the real move out of the real
   * data through the real pool is the only version of that which proves
   * anything.
   */
  private stressing = false;

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

    const equipped = chooseMoves(species, content.moves);

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

    const pool = new ProjectilePool(world, grid, MAX_LIVE_PROJECTILES);
    const caster = new MoveCaster({
      caster: player.entity,
      // The moves come out of `data/`; the caster reads cooldown, cast and the
      // shape block off them. Editing a number in the JSON is the whole of
      // retuning this, which is the acceptance criterion.
      moves: equipped,
      shapes: projectileOnlyShapes(pool),
      // GDD 4.4's second job for Speed: how fast a cooldown drains.
      speedStat: species.baseStats.speed,
      // The player's latched aim, by reference. Independent of movement, so
      // you can back away from something while still shooting at it.
      aim: player.aim,
    });

    // Order matters and is the reason these are three systems rather than one.
    // Movement settles the position the shot leaves from; the caster releases;
    // the pool then flies every shot, including the one just released, so a
    // click and its first pixel of travel land on the same tick.
    world.addSystem('player', (w) => player.step(w));
    world.addSystem('moves', (w) => caster.step(w, fireHeld(w, BUTTON_FIRE)));
    world.addSystem('stress', (w) => this.stressStep(w, pool, player, equipped));
    world.addSystem('projectiles', (w) => pool.step(w));

    this.drawRoom(room);

    this.sprite = this.add.image(start.x, start.y - PLAYER_BOX_OFFSET_Y, PLAYER_SPRITE_KEY);

    // Added after the player and before the cursor, which is the whole of the
    // depth sorting this scene needs: shots pass in front of the body and the
    // reticle stays on top of everything.
    const projectiles = new ProjectileView(this, MAX_LIVE_PROJECTILES);
    projectiles.listenTo(pool);

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

    // Right-click dodges (`deviceInput.ts`), so the browser must not open its
    // menu over the game when it does.
    this.input.mouse?.disableContextMenu();

    // The readout is scaffolding for this task: the acceptance criteria
    // include 60fps and a speed that comes from `data/`, and both are easier
    // to confirm when the screen says what they are.
    this.readout = this.add
      .bitmapText(3, GAME_HEIGHT - GLYPH_HEIGHT - 3, GB_FONT_KEY, '')
      .setTint(shadeSource(SHADE_LIGHTEST))
      .setScrollFactor(0);

    this.input.keyboard?.on('keydown-P', () => cyclePalette());
    this.input.keyboard?.on('keydown-F', () => {
      this.stressing = !this.stressing;
    });

    this.world = world;
    this.player = player;
    this.camera = camera;
    this.device = device;
    this.caster = caster;
    this.pool = pool;
    this.projectiles = projectiles;
    this.hud = new CooldownHud(this);
    this.dodgeHud = new DodgeHud(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.setDefaultCursor('default');
      this.device?.destroy();
      this.device = undefined;
    });
  }

  /**
   * The performance harness: a fountain of the real move, fired straight into
   * the pool with no cooldown, while F is toggled on.
   *
   * It goes through `pool.fire` with the move's own `projectile` block rather
   * than inventing numbers, so what it measures is the shot the game actually
   * fires -- same speed, same radius, same wall sweep, same broadphase. The
   * only thing it skips is the cooldown, which is the only thing standing
   * between one player and 200 live shots.
   *
   * Directions are spread by tick so the fountain sweeps the room instead of
   * stacking every shot on one line, which would leave most of the spatial
   * hash empty and flatter the measurement.
   */
  private stressStep(
    world: World,
    pool: ProjectilePool,
    player: PlayerController,
    equipped: readonly Move[],
  ): void {
    if (!this.stressing) {
      return;
    }

    const move = equipped[0];
    const params = move?.projectile;

    if (move === undefined || params === undefined) {
      return;
    }

    const originX = player.x(world);
    const originY = player.y(world);

    for (let i = 0; i < STRESS_SHOTS_PER_TICK; i += 1) {
      const angle =
        ((world.tick * STRESS_SHOTS_PER_TICK + i) / 97) * Math.PI * 2 +
        (i / STRESS_SHOTS_PER_TICK) * Math.PI * 2;

      pool.fire(world, {
        owner: player.entity,
        x: originX,
        y: originY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        speed: params.speed,
        radius: params.radius,
        range: params.range,
        pierce: params.pierce,
        moveIndex: 0,
      });
    }
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

    const caster = this.caster;
    const pool = this.pool;
    const projectiles = this.projectiles;

    if (!world || !player || !camera || !device || !caster || !pool || !projectiles) {
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

    projectiles.draw(world, pool);
    this.hud?.draw(caster);
    this.dodgeHud?.draw(player.dodge);

    // The readout is scaffolding for the acceptance criteria: the frame time
    // and the live shot count are exactly the two numbers GDD 9.4's budget is
    // stated in, so the gate is read off the screen rather than guessed at.
    // The dodge phase is on the readout for the same reason the frame time is:
    // "the i-frames are a window inside the dash" is the acceptance criterion,
    // and the only way to check it by playing rather than by reading a test is
    // for the screen to say which third of the dash you are in. The font has
    // no lower case (`gbFont.ts`).
    const phase = DODGE_PHASE_NAMES[player.dodge.phase] ?? '';

    this.readout?.setText(
      `${Math.round(this.game.loop.actualFps)}F ` +
        `${this.game.loop.delta.toFixed(1)}MS ` +
        `P${pool.count} ` +
        `V ${Math.round(player.speed(world))} ` +
        `D${player.dodge.pips} ${phase.toUpperCase()}`,
    );
  }
}
