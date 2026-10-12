import { describe, expect, it } from 'vitest';
import { EntityRegistry, NO_ENTITY, type EntityId } from './entity-registry';
import { EventBus, SIM_EVENT_NAMES } from './events';

function anyEntity(): EntityId {
  return new EntityRegistry(1).spawn();
}

describe('event bus', () => {
  it('delivers synchronously, in subscription order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('fainted', () => order.push('first'));
    bus.on('fainted', () => order.push('second'));
    bus.on('fainted', () => order.push('third'));

    const called = bus.emit('fainted', { entity: anyEntity(), source: NO_ENTITY });

    // Synchronous means the whole effect is already done here, not after a
    // microtask - which is why a state hash taken at the end of a step is
    // complete.
    expect(order).toEqual(['first', 'second', 'third']);
    expect(called).toBe(3);
  });

  it('passes the payload through unchanged', () => {
    const bus = new EventBus();
    const target = anyEntity();
    let seen = 0;
    bus.on('damaged', (payload) => {
      seen = payload.amount;
      expect(payload.target).toBe(target);
    });
    bus.emit('damaged', { target, source: NO_ENTITY, amount: 17 });
    expect(seen).toBe(17);
  });

  it('lets a hot-path caller reuse one payload object', () => {
    // The contract that keeps emit allocation-free: the bus does not retain
    // the payload, so a system may emit the same scratch struct every frame.
    const bus = new EventBus();
    const amounts: number[] = [];
    bus.on('damaged', (payload) => amounts.push(payload.amount));

    const scratch = { target: anyEntity(), source: NO_ENTITY, amount: 0 };
    for (let i = 1; i <= 3; i += 1) {
      scratch.amount = i;
      bus.emit('damaged', scratch);
    }
    expect(amounts).toEqual([1, 2, 3]);
  });

  it('emits to nobody without complaining', () => {
    const bus = new EventBus();
    expect(bus.emit('spawned', { entity: anyEntity() })).toBe(0);
    expect(bus.emitCount('spawned')).toBe(1);
  });

  it('unsubscribes', () => {
    const bus = new EventBus();
    let count = 0;
    const listener = (): void => {
      count += 1;
    };
    bus.on('spawned', listener);
    bus.emit('spawned', { entity: anyEntity() });
    bus.off('spawned', listener);
    bus.emit('spawned', { entity: anyEntity() });
    expect(count).toBe(1);
    expect(bus.listenerCount('spawned')).toBe(0);
  });

  it('ignores an unsubscribe for a listener that was never added', () => {
    const bus = new EventBus();
    expect(() => bus.off('spawned', () => undefined)).not.toThrow();
  });

  it('rejects the same listener twice, because that is always a leak', () => {
    const bus = new EventBus();
    const listener = (): void => undefined;
    bus.on('spawned', listener);
    expect(() => bus.on('spawned', listener)).toThrow(/already subscribed/);
  });

  // The crash this prevents: a listener that reacts to a faint by
  // unsubscribing itself, mutating the array the dispatch loop is walking.
  it('defers subscription changes made from inside a listener', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const late = (): void => {
      calls.push('late');
    };
    const self = (): void => {
      calls.push('self');
      bus.off('spawned', self);
      bus.on('spawned', late);
    };
    bus.on('spawned', self);
    bus.on('spawned', () => calls.push('other'));

    bus.emit('spawned', { entity: anyEntity() });
    expect(calls).toEqual(['self', 'other']);

    calls.length = 0;
    bus.emit('spawned', { entity: anyEntity() });
    expect(calls).toEqual(['other', 'late']);
  });

  it('handles an event raised from inside a listener', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.on('damaged', () => {
      calls.push('damaged');
      bus.emit('fainted', { entity: NO_ENTITY, source: NO_ENTITY });
    });
    bus.on('fainted', () => calls.push('fainted'));

    bus.emit('damaged', { target: NO_ENTITY, source: NO_ENTITY, amount: 1 });
    expect(calls).toEqual(['damaged', 'fainted']);
    expect(bus.emitCount('fainted')).toBe(1);
  });

  it('still applies deferred changes when a listener throws', () => {
    const bus = new EventBus();
    const boom = (): void => {
      bus.off('spawned', boom);
      throw new Error('listener failed');
    };
    bus.on('spawned', boom);
    expect(() => bus.emit('spawned', { entity: anyEntity() })).toThrow('listener failed');
    expect(bus.listenerCount('spawned')).toBe(0);
  });

  it('refuses to be cleared from inside a listener', () => {
    const bus = new EventBus();
    bus.on('spawned', () => bus.clear());
    expect(() => bus.emit('spawned', { entity: anyEntity() })).toThrow(/inside a listener/);
  });

  it('counts every event name it knows about', () => {
    const bus = new EventBus();
    const entity = anyEntity();
    bus.emit('spawned', { entity });
    bus.emit('spawned', { entity });
    bus.emit('damaged', { target: entity, source: NO_ENTITY, amount: 3 });
    bus.emit('fainted', { entity, source: NO_ENTITY });
    bus.emit('despawned', { entity });
    bus.emit('pickedUp', { item: entity, by: entity, kind: 4 });

    expect(bus.emitCount('spawned')).toBe(2);
    expect(SIM_EVENT_NAMES.map((name) => bus.emitCount(name))).toEqual([2, 1, 1, 1, 1]);
  });

  it('folds event traffic into the hash', () => {
    const quiet = new EventBus();
    const busy = new EventBus();
    expect(busy.hash(0)).toBe(quiet.hash(0));

    busy.emit('spawned', { entity: anyEntity() });
    expect(busy.hash(0)).not.toBe(quiet.hash(0));

    // Same number of events, different events: still a different run.
    const other = new EventBus();
    other.emit('despawned', { entity: anyEntity() });
    expect(other.hash(0)).not.toBe(busy.hash(0));
  });

  it('resets counters without dropping subscriptions', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('spawned', () => {
      count += 1;
    });
    bus.emit('spawned', { entity: anyEntity() });
    bus.resetCounts();
    expect(bus.emitCount('spawned')).toBe(0);
    expect(bus.listenerCount('spawned')).toBe(1);
    bus.emit('spawned', { entity: anyEntity() });
    expect(count).toBe(2);
  });
});
