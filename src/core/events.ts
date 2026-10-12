/**
 * Typed synchronous event bus for the simulation.
 *
 * Two rules, both of which exist to keep the simulation deterministic and the
 * types honest:
 *
 * 1. Event names live in exactly one union type. There is no `emit('dmaage')`
 *    that silently goes nowhere - a typo is a compile error.
 * 2. Dispatch is synchronous and in registration order. Nothing is queued to
 *    a microtask, nothing waits for a frame, so the whole effect of a step is
 *    finished inside that step and the state hash afterwards is complete.
 *
 * Payloads carry entity handles and numbers only. No species or move names:
 * content lives in `data/` (GDD 11.3), and a numeric kind from the data layer
 * is what crosses this boundary.
 */

import type { EntityId } from './entity-registry';
import { hashInt32Array, hashUint32 } from './hash';

/**
 * Every event the simulation can raise, with its payload. Adding an event
 * means adding a line here and a name to `SIM_EVENT_NAMES`; the type check at
 * the bottom of this file fails if you forget the second half.
 */
export interface SimEventMap {
  /** An entity entered the world. */
  spawned: { entity: EntityId };
  /** An entity left the world. Raised before the slot is recycled. */
  despawned: { entity: EntityId };
  /** Damage was applied. `amount` is post-mitigation (GDD 4.3). */
  damaged: { target: EntityId; source: EntityId; amount: number };
  /** Hit points reached zero. */
  fainted: { entity: EntityId; source: EntityId };
  /** A pickup was collected. `kind` is a data-assigned id, never a name. */
  pickedUp: { item: EntityId; by: EntityId; kind: number };
}

export type SimEventName = keyof SimEventMap;

/** Stable order, used to index the per-event counters that feed the hash. */
export const SIM_EVENT_NAMES = [
  'spawned',
  'despawned',
  'damaged',
  'fainted',
  'pickedUp',
] as const satisfies readonly SimEventName[];

// Fails to compile if SimEventMap gains a key that SIM_EVENT_NAMES does not
// list, which would otherwise mean that event silently stops being hashed.
type MissingFromList = Exclude<SimEventName, (typeof SIM_EVENT_NAMES)[number]>;
const _everyEventIsListed: MissingFromList extends never ? true : never = true;
void _everyEventIsListed;

export type SimEventListener<N extends SimEventName> = (payload: Readonly<SimEventMap[N]>) => void;

type AnyListener = (payload: never) => void;

interface PendingOp {
  readonly add: boolean;
  readonly name: SimEventName;
  readonly listener: AnyListener;
}

export class EventBus {
  private readonly listeners = new Map<SimEventName, AnyListener[]>();

  /** Emits per event name, in `SIM_EVENT_NAMES` order. Folded into the hash. */
  private readonly counts = new Int32Array(SIM_EVENT_NAMES.length);

  /** Dispatch nesting depth. Non-zero means a listener is running. */
  private depth = 0;

  /** on/off calls made from inside a listener, applied when dispatch unwinds. */
  private readonly pending: PendingOp[] = [];

  /**
   * Subscribes. Listeners fire in subscription order; the same function
   * subscribed twice fires twice, which is almost always a leak, so it is
   * rejected instead.
   */
  on<N extends SimEventName>(name: N, listener: SimEventListener<N>): void {
    const op = listener as AnyListener;
    if (this.depth > 0) {
      this.pending.push({ add: true, name, listener: op });
      return;
    }
    this.applyAdd(name, op);
  }

  /** Unsubscribes. Safe to call from inside a listener and safe if absent. */
  off<N extends SimEventName>(name: N, listener: SimEventListener<N>): void {
    const op = listener as AnyListener;
    if (this.depth > 0) {
      this.pending.push({ add: false, name, listener: op });
      return;
    }
    this.applyRemove(name, op);
  }

  private applyAdd(name: SimEventName, listener: AnyListener): void {
    const list = this.listeners.get(name);
    if (list === undefined) {
      this.listeners.set(name, [listener]);
      return;
    }
    if (list.includes(listener)) {
      throw new Error(`listener already subscribed to "${name}"`);
    }
    list.push(listener);
  }

  private applyRemove(name: SimEventName, listener: AnyListener): void {
    const list = this.listeners.get(name);
    if (list === undefined) {
      return;
    }
    const at = list.indexOf(listener);
    if (at !== -1) {
      // splice, not swap-remove: subscription order is part of the contract.
      list.splice(at, 1);
    }
  }

  /**
   * Calls every listener for `name`, in order, right now. Returns how many ran.
   *
   * The payload is not retained after this call returns, so a hot-path caller
   * may pass the same mutable scratch object every frame and allocate nothing.
   * A listener that wants to keep a payload must copy the fields it needs.
   */
  emit<N extends SimEventName>(name: N, payload: Readonly<SimEventMap[N]>): number {
    const counterAt = SIM_EVENT_NAMES.indexOf(name);
    this.counts[counterAt] = (this.counts[counterAt] ?? 0) + 1;

    const list = this.listeners.get(name);
    if (list === undefined || list.length === 0) {
      return 0;
    }

    this.depth += 1;
    let called = 0;
    try {
      // Length is read each iteration on purpose: subscriptions made during
      // dispatch are deferred, so the list cannot grow under us, and this
      // stays correct if that ever changes.
      for (let i = 0; i < list.length; i += 1) {
        const listener = list[i];
        if (listener === undefined) {
          continue;
        }
        (listener as (p: Readonly<SimEventMap[N]>) => void)(payload);
        called += 1;
      }
    } finally {
      this.depth -= 1;
      if (this.depth === 0 && this.pending.length > 0) {
        this.flushPending();
      }
    }
    return called;
  }

  private flushPending(): void {
    for (const op of this.pending) {
      if (op.add) {
        this.applyAdd(op.name, op.listener);
      } else {
        this.applyRemove(op.name, op.listener);
      }
    }
    this.pending.length = 0;
  }

  /** How many times an event has been emitted since the last `reset`. */
  emitCount(name: SimEventName): number {
    return this.counts[SIM_EVENT_NAMES.indexOf(name)] ?? 0;
  }

  /** Number of listeners for an event. */
  listenerCount(name: SimEventName): number {
    return this.listeners.get(name)?.length ?? 0;
  }

  /** Drops every subscription. For tearing a run down. */
  clear(): void {
    if (this.depth > 0) {
      throw new Error('clear() called from inside a listener');
    }
    this.listeners.clear();
    this.pending.length = 0;
    this.counts.fill(0);
  }

  /** Zeroes the emit counters but keeps subscriptions. For restarting a run. */
  resetCounts(): void {
    this.counts.fill(0);
  }

  /**
   * Folds event traffic into the state hash. Two runs that produce the same
   * world but different event traffic are not the same run, and this is what
   * catches that.
   */
  hash(h: number): number {
    return hashInt32Array(hashUint32(h, this.counts.length), this.counts, this.counts.length);
  }
}
