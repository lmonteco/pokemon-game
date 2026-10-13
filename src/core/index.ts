/**
 * The deterministic core (GDD 9.4, 9.5). Nothing in here imports Phaser or
 * touches the DOM, so the whole simulation runs headless for the balance
 * simulator in GDD 9.3.
 */

export { GAME_HEIGHT, GAME_WIDTH, TICK_HZ, TICK_MS, TILE_PX } from './constants';
export {
  DEFAULT_CAPACITY,
  EntityRegistry,
  NO_ENTITY,
  generationFromId,
  slotFromId,
  type EntityId,
} from './entity-registry';
export {
  EventBus,
  SIM_EVENT_NAMES,
  type SimEventListener,
  type SimEventMap,
  type SimEventName,
} from './events';
export {
  HASH_SEED,
  formatHash,
  hashFloat64,
  hashFloat64Array,
  hashInt32Array,
  hashString,
  hashUint32,
} from './hash';
export { DEFAULT_MAX_CATCH_UP_STEPS, FixedLoop, type FixedLoopOptions } from './loop';
export {
  RNG_STREAMS,
  Rng,
  createRngStreams,
  seedToWord,
  type RngState,
  type RngStream,
  type RngStreams,
} from './rng';
export {
  World,
  createWorld,
  type FrameInput,
  type InputSource,
  type SimSystem,
  type WorldOptions,
} from './world';
