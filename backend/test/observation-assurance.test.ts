import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { acceptAssignmentOffer } from '../src/delivery-assignments/assignment.service.js';
import { failDelivery, transitionLifecycle } from '../src/delivery-lifecycle/lifecycle.service.js';
import { completeObservation, observationTime } from '../src/observation-assurance/observation.store.js';

const base = new Date('2026-09-16T10:00:00.000Z');
const at = (ms: number) => new Date(base.getTime() + ms);
const options = { now: () => base, offerTimeoutMs: 30000, freshnessThresholdMs: 60000 };

// Transactional injected store, not a claim to execute PostgreSQL triggers.
// Queued callbacks use explicit gates; no wall-clock sleeps. Every attempted
// callback snapshots business facts AND assurance, then restores both on error.
function fixture(status = 'OFFERED', assured = true) {
  let stamp = at(1), retries = 0, failEvent = false, tail = Promise.resolve();
  const state: any = {
    epoch: assured ? base : null, invalidated: false, observation: null,
    assignment: { id: 'assignment', orderId: 'order', riderId: 'rider', batchId: null, status,
      assignedAt: base, createdAt: base, offerExpiresAt: at(30000), acceptedAt: status === 'OFFERED' ? null : base,
      pickedUpAt: null, deliveredAt: null },
    order: { id: 'order', orderNumber: '1', pharmacyId: 'pharmacy', fulfillmentMethod: 'DELIVERY', status: status === 'OFFERED' ? 'READY_FOR_PICKUP' : 'OUT_FOR_DELIVERY' },
    rider: { id: 'rider', userId: 'user', availability: status === 'OFFERED' ? 'AVAILABLE' : 'BUSY', isActive: true, user: { isActive: true } }, events: [],
  };
  if (assured && status !== 'OFFERED') state.observation = { startedAt: base, horizonAt: at(3600000), certifiedAt: null, terminal: null };
  let onLock: (() => Promise<void>) | undefined;
  const sampled: Date[] = [];
  const store: any = {
    deliveryPartner: { findUnique: async () => state.rider, updateMany: async ({ data }: any) => { Object.assign(state.rider, data); return { count: 1 }; } },
    deliveryAssignment: {
      findFirst: async ({ where }: any) => where.id?.not ? null : { ...state.assignment, order: state.order },
      updateMany: async ({ data }: any) => { Object.assign(state.assignment, data); return { count: 1 }; }, count: async () => 0,
    },
    order: { updateMany: async ({ data }: any) => { Object.assign(state.order, data); return { count: 1 }; } },
    deliveryEvent: {
      createMany: async ({ data }: any) => { state.events.push(...data); return { count: data.length }; },
      create: async ({ data }: any) => {
        if (failEvent) throw new Error('event write failed');
        const event = { ...data, id: 'event' }; state.events.push(event);
        if (state.observation && !state.invalidated) state.observation.terminal = event;
        return event;
      }, findFirst: async () => null,
    },
    $queryRawUnsafe: async (query: string, _id: string, action: string, version?: string) => {
      if ((version ?? action) !== 'delivery-observation-v1') throw new Error('version mismatch');
      if (onLock) { const callback = onLock; onLock = undefined; await callback(); }
      if (query.includes('observation_complete')) {
        if (!state.observation) return [{ result: 'UNSUPPORTED' }];
        if (state.invalidated) return [{ result: 'INVALIDATED' }];
        if (state.observation.certifiedAt) return [{ result: 'COMPLETE' }];
        if (stamp <= state.observation.horizonAt) return [{ result: 'PENDING' }];
        state.observation.certifiedAt = stamp;
        return [{ result: 'COMPLETE' }];
      }
      if (action === 'ACCEPT' && state.epoch && !state.invalidated && state.assignment.createdAt >= state.epoch && state.assignment.offerExpiresAt) {
        state.observation = { startedAt: stamp, horizonAt: new Date(stamp.getTime() + 3600000), certifiedAt: null, terminal: null };
      }
      if (!state.observation || state.invalidated) return [{ occurredAt: null }];
      sampled.push(stamp);
      return [{ occurredAt: stamp }];
    },
    $transaction: async (callback: (tx: any) => Promise<any>) => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const saved = structuredClone(state);
      try {
        const result = await callback(store);
        if (retries > 0) { retries--; stamp = at(2); throw Object.assign(new Error('retry'), { code: 'P2034' }); }
        return result;
      } catch (error) { Object.assign(state, saved); throw error; }
      finally { release(); }
    },
  };
  return { store, state, sampled, time: (time: Date) => { stamp = time; }, retry: () => { retries = 1; }, fail: () => { failEvent = true; }, lock: (fn: () => Promise<void>) => { onLock = fn; } };
}

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}

describe('prospective assurance writer integration', () => {
  it('commits acceptance and anchor together without changing DTO keys', async () => {
    const f = fixture(); const legacy = fixture('OFFERED', false);
    const result = await acceptAssignmentOffer(f.store, 'user', 'assignment', options);
    const old = await acceptAssignmentOffer(legacy.store, 'user', 'assignment', options);
    expect(Object.keys(result).sort()).toEqual(Object.keys(old).sort());
    expect(f.state.assignment.acceptedAt).toEqual(at(1));
    expect(f.state.observation.startedAt).toEqual(at(1));
    expect(f.state.events.every((e: any) => e.occurredAt.getTime() === at(1).getTime())).toBe(true);
    expect(legacy.state.observation).toBeNull(); expect(old.acceptedAt).toEqual(base);
    await expect(acceptAssignmentOffer(f.store, 'user', 'assignment', options)).rejects.toMatchObject({ code: 'OFFER_NOT_ACTIONABLE' });
    expect(f.state.events).toHaveLength(2);
  });
  it('rolls back acceptance and anchor if event persistence fails', async () => {
    const f = fixture(); f.store.deliveryEvent.createMany = async () => { throw new Error('write failed'); };
    await expect(acceptAssignmentOffer(f.store, 'user', 'assignment', options)).rejects.toThrow('write failed');
    expect(f.state.assignment.status).toBe('OFFERED'); expect(f.state.assignment.acceptedAt).toBeNull(); expect(f.state.observation).toBeNull();
  });
  it('acceptance retry commits T2 only; abandoned T1 leaves no facts', async () => {
    const f = fixture(); f.retry(); await acceptAssignmentOffer(f.store, 'user', 'assignment', options);
    expect(f.sampled).toEqual([at(1), at(2)]); expect(f.state.assignment.acceptedAt).toEqual(at(2));
    expect(f.state.observation.startedAt).toEqual(at(2)); expect(f.state.events.map((e: any) => e.occurredAt)).toEqual([at(2), at(2)]);
  });
  for (const kind of ['failure', 'success'] as const) {
    const run = (f: ReturnType<typeof fixture>) => kind === 'failure'
      ? failDelivery(f.store, 'user', 'assignment', 'existing private note', options)
      : transitionLifecycle(f.store, 'user', 'assignment', 'DELIVER', options);
    it(`${kind} samples after lock and resamples after rollback`, async () => {
      const f = fixture('OUT_FOR_DELIVERY'); f.retry(); await run(f);
      expect(f.sampled).toEqual([at(1), at(2)]); expect(f.state.events).toHaveLength(1);
      expect(f.state.events[0].occurredAt).toEqual(at(2)); expect(f.state.observation.terminal.occurredAt).toEqual(at(2));
      if (kind === 'success') { expect(f.state.assignment.deliveredAt).toEqual(at(2)); expect(f.state.order.completedAt).toEqual(at(2)); }
      const snapshot = structuredClone(f.state); await run(f); expect(f.state).toEqual(snapshot);
    });
    it(`${kind} rollback leaves no terminal assurance or business outcome`, async () => {
      const f = fixture('OUT_FOR_DELIVERY'); f.fail(); await expect(run(f)).rejects.toThrow('event write failed');
      expect(f.state.assignment.status).toBe('OUT_FOR_DELIVERY'); expect(f.state.events).toEqual([]); expect(f.state.observation.terminal).toBeNull();
    });
    it(`${kind} waiting behind completion uses a post-horizon timestamp`, async () => {
      const f = fixture('OUT_FOR_DELIVERY'); const entered = gate(), hold = gate(); f.time(at(3600001));
      f.lock(async () => { entered.release(); await hold.wait; });
      const closing = f.store.$transaction((tx: any) => completeObservation(tx, 'assignment'));
      await entered.wait; const writing = run(f); hold.release();
      expect(await closing).toBe('COMPLETE'); await writing;
      expect(f.state.events[0].occurredAt.getTime()).toBeGreaterThan(f.state.observation.horizonAt.getTime());
      expect(f.state.events[0].occurredAt).not.toEqual(base);
    });
    it(`${kind} acquiring serialization first is retained before completion`, async () => {
      const f = fixture('OUT_FOR_DELIVERY'); const entered = gate(), hold = gate();
      f.lock(async () => { entered.release(); await hold.wait; });
      const writing = run(f); await entered.wait;
      const closing = f.store.$transaction((tx: any) => { f.time(at(3600001)); return completeObservation(tx, 'assignment'); });
      hold.release(); await writing; expect(await closing).toBe('COMPLETE');
      expect(f.state.observation.terminal.occurredAt).toEqual(at(1));
    });
    it(`${kind} legacy invocation time and duplicate behavior remain unchanged`, async () => {
      const f = fixture('OUT_FOR_DELIVERY', false); f.retry(); await run(f); await run(f);
      expect(f.state.events).toHaveLength(1); expect(f.state.events[0].occurredAt).toEqual(base); expect(f.state.observation).toBeNull();
    });
  }
  it.each([0, 1, 3599999, 3600000, 3600001])('preserves serialized event boundary offset %i without labeling', async offset => {
    const f = fixture('OUT_FOR_DELIVERY'); f.time(at(offset));
    await failDelivery(f.store, 'user', 'assignment', 'reason', options);
    expect(f.state.events[0].occurredAt).toEqual(at(offset));
    expect(f.state.observation.terminal.occurredAt).toEqual(at(offset));
  });
  it.each([3599999, 3600000, 3600001])('completion requires strictly later than H: %i', async offset => {
    const f = fixture('OUT_FOR_DELIVERY'); f.time(at(offset));
    expect(await f.store.$transaction((tx: any) => completeObservation(tx, 'assignment'))).toBe(offset > 3600000 ? 'COMPLETE' : 'PENDING');
  });
  it.each([-1, 0, 1])('creation relative to explicit epoch: %i', async offset => {
    const f = fixture(); f.state.assignment.createdAt = at(offset);
    await acceptAssignmentOffer(f.store, 'user', 'assignment', options);
    expect(Boolean(f.state.observation)).toBe(offset >= 0);
  });
  it('legacy null deadline is not reconstructed', async () => {
    const f = fixture(); f.state.assignment.offerExpiresAt = null;
    await acceptAssignmentOffer(f.store, 'user', 'assignment', options);
    expect(f.state.observation).toBeNull(); expect(f.state.assignment.offerExpiresAt).toBeNull();
  });
  it('missing historical acceptance is not inferred on failure', async () => {
    const f = fixture('OUT_FOR_DELIVERY', false); f.state.assignment.acceptedAt = null;
    await failDelivery(f.store, 'user', 'assignment', 'reason', options);
    expect(f.state.assignment.acceptedAt).toBeNull(); expect(f.state.observation).toBeNull();
  });
  it('already failed historical metadata is never repaired', async () => {
    const f = fixture('FAILED', false); f.state.events.push({ eventType: 'FAILED_DELIVERY', metadata: null });
    await failDelivery(f.store, 'user', 'assignment', 'reason', options);
    expect(f.state.events).toEqual([{ eventType: 'FAILED_DELIVERY', metadata: null }]); expect(f.state.observation).toBeNull();
  });
  it('invalidation leaves existing business facts intact and blocks certification', async () => {
    const f = fixture('OUT_FOR_DELIVERY'); await failDelivery(f.store, 'user', 'assignment', 'reason', options);
    const events = structuredClone(f.state.events); f.state.invalidated = true;
    expect(await f.store.$transaction((tx: any) => completeObservation(tx, 'assignment'))).toBe('INVALIDATED'); expect(f.state.events).toEqual(events);
  });
  it('duplicate completion is stable across adapter calls', async () => {
    const f = fixture('OUT_FOR_DELIVERY'); f.time(at(3600001));
    await f.store.$transaction((tx: any) => completeObservation(tx, 'assignment')); const saved = structuredClone(f.state.observation);
    f.time(at(3700000)); await f.store.$transaction((tx: any) => completeObservation(tx, 'assignment')); expect(f.state.observation).toEqual(saved);
  });
  it('rejects malformed adapter time and unsupported completion store', async () => {
    await expect(observationTime({ $queryRawUnsafe: async () => [{ occurredAt: 'bad' }] as any }, 'assignment', 'FAIL', base)).rejects.toThrow('Invalid observation clock');
    await expect(completeObservation({}, 'assignment')).rejects.toThrow('requires PostgreSQL');
  });
  it.each(['40001', '40P01'])('normalizes raw PostgreSQL conflict %s for the existing domain retry loop', async code => {
    const tx = { $queryRawUnsafe: async () => { throw { code: 'P2010', meta: { code } }; } };
    await expect(observationTime(tx, 'assignment', 'FAIL', base)).rejects.toMatchObject({ code: 'P2034' });
  });
  it('does not retry unrelated SQL failures or accept a mismatched capability version', async () => {
    const error = { code: 'P2010', meta: { code: '23514' } };
    await expect(observationTime({ $queryRawUnsafe: async () => { throw error; } }, 'assignment', 'FAIL', base)).rejects.toBe(error);
    const f = fixture();
    await expect(f.store.$queryRawUnsafe('observation_begin', 'assignment', 'ACCEPT', 'wrong')).rejects.toThrow('version mismatch');
  });
  it.each([true, false])('invalidation and completion serialize without changing business facts (invalidation first: %s)', async first => {
    const f = fixture('OUT_FOR_DELIVERY'); f.time(at(3600001));
    const saved = structuredClone({ assignment: f.state.assignment, order: f.state.order, events: f.state.events });
    const invalidate = () => f.store.$transaction(async () => { f.state.invalidated = true; });
    const complete = () => f.store.$transaction((tx: any) => completeObservation(tx, 'assignment'));
    if (first) { await Promise.all([invalidate(), complete()]); } else { await Promise.all([complete(), invalidate()]); }
    expect(await complete()).toBe('INVALIDATED');
    expect({ assignment: f.state.assignment, order: f.state.order, events: f.state.events }).toEqual(saved);
  });
});

describe('migration enforcement review checks (not database execution)', () => {
  const sql = readFileSync(new URL('../prisma/migrations/20260916000000_observation_assurance/migration.sql', import.meta.url), 'utf8');
  it('has deferred atomicity, protected events, explicit epoch controls and no activation call', () => {
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED'); expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "DeliveryEvent"');
    expect(sql).toContain('REVOKE ALL ON FUNCTION observation_activate'); expect(sql).not.toMatch(/SELECT\s+observation_activate/i);
  });
  it('rejects unsupported censor writes instead of fabricating a censor workflow', () => {
    expect(sql).toContain('No supported assured censor writer'); expect(sql).toContain('Unsupported assured intervention');
  });
  it('versions the contract and uses post-lock current time, never transaction-start now', () => {
    expect(sql).toContain("version <> 'delivery-observation-v1'"); expect(sql).toContain('clock_timestamp()'); expect(sql).not.toMatch(/\bnow\(\)/);
  });
});
