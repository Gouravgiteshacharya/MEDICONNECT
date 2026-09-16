import { describe, expect, it, vi } from "vitest";
import { createRiskReconciler, type ReconciliationOptions, type ReconciliationSource } from "../src/risk/risk.reconciliation.js";
import { createPrismaRiskReconciliationSource, type ReconciliationDelegates } from "../src/risk/risk.reconciliation.repository.js";
import { createRiskHooks } from "../src/risk/risk.hooks.js";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { RiskTestStore, entityId, orderId, actorId, secondActorId, time } from "./risk-test-store.js";

const at = (ms: number) => new Date(time.getTime() + ms);
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const timeout = () => ({ assignmentId: entityId, orderId, status: "TIMED_OUT", assignedAt: at(-100_000), offerExpiresAt: at(-50_000), timedOutAt: at(-1), evaluatedAt: time });
const failure = () => ({ assignmentId: entityId, orderId, assignmentStatus: "FAILED", evaluatedAt: time,
  failureEvent: { id: actorId, eventType: "FAILED_DELIVERY", occurredAt: at(-1), requiresManualReview: true, orderStatusAtFailure: "OUT_FOR_DELIVERY" } });
const stale = () => ({ assignmentId: entityId, orderId, assignmentStatus: "ACCEPTED", lastLocationAt: at(-60_001), freshnessThresholdMs: 60_000, evaluatedAt: time });
function assignment(status = "ACCEPTED", key = entityId) {
  return { id: key, orderId, status, assignedAt: at(-100_000), updatedAt: at(-10),
    offerExpiresAt: at(-50_000) as Date | null, timedOutAt: at(-1) as Date | null, rider: { lastLocationAt: at(-60_001) as Date | null } };
}
type Assignment = ReturnType<typeof assignment>;
type Event = { id: string; assignmentId: string | null; orderId: string; eventType: string; occurredAt: Date; metadata: unknown };
function setup() {
  const store = new RiskTestStore(), service = new OperationalRiskService(store.repository());
  const assignments: Assignment[] = [], events: Event[] = [], queries: any[] = [];
  function page(rows: any[], q: any, field: string) {
    queries.push(structuredClone(q));
    const range = q.where[field];
    return structuredClone(rows.filter(r => r[field] <= range.lte && (!range.gte || r[field] >= range.gte))
      .sort((a, b) => a[field].getTime() - b[field].getTime() || a.id.localeCompare(b.id)).slice(q.skip, q.skip + q.take));
  }
  const delegates = {
    assignments: {
      findMany: vi.fn(async (q: any) => page(assignments.filter(a => typeof q.where.status === "string" ? a.status === q.where.status : q.where.status.in.includes(a.status)), q, "assignedAt")),
      findUnique: vi.fn(async (q: any) => structuredClone(assignments.find(a => a.id === q.where.id) ?? null)),
    },
    events: { findMany: vi.fn(async (q: any) => page(events.filter(e => e.eventType === q.where.eventType).map(e => ({ ...e, assignment: assignments.find(a => a.id === e.assignmentId) ?? null })), q, "occurredAt")) },
    assessments: { findMany: vi.fn(async (q: any) => page([...store.rows.values()].filter(r => r.ruleCode === q.where.ruleCode && r.entityType === q.where.entityType), q, "detectedAt")) },
  };
  const source = createPrismaRiskReconciliationSource(delegates as unknown as ReconciliationDelegates);
  const run = createRiskReconciler(source, service);
  const hooks = createRiskHooks({ riskService: service });
  const options = (lane: ReconciliationOptions["lane"], extra: Partial<ReconciliationOptions> = {}): ReconciliationOptions => ({ lane, evaluatedAt: time, freshnessThresholdMs: 60_000, ...extra });
  async function seedStale(key = entityId) {
    await hooks.observeLocation({ ...stale(), assignmentId: key });
    return [...store.rows.values()].find(r => r.entityId === key)!;
  }
  function seedFailure() {
    assignments.push(assignment("FAILED"));
    events.push({ id: actorId, orderId, assignmentId: entityId, eventType: "FAILED_DELIVERY", occurredAt: at(-1), metadata: { requiresManualReview: true, orderStatusAtFailure: "OUT_FOR_DELIVERY" } });
  }
  return { store, service, assignments, events, queries, delegates, source, run, hooks, options, seedStale, seedFailure };
}

describe("bounded reconciliation source and options", () => {
  it("defaults to 25 and processes only the bounded page, with deterministic ID-free continuation", async () => {
    const s = setup(); for (let n = 1; n <= 30; n++) s.assignments.push(assignment("TIMED_OUT", id(n)));
    const a = await s.run(s.options("timeouts")); const b = await s.run(s.options("timeouts"));
    expect(a).toEqual(b); expect(a.scanned).toBe(25); expect(a.recorded).toBe(25);
    expect(a.continuation).toEqual({ at: at(-100_000).toISOString(), consumedAtTime: 25 });
    expect(s.queries[0].take).toBe(26); expect(s.delegates.assignments.findMany).toHaveBeenCalledTimes(2);
    const last = await s.run(s.options("timeouts", { cursor: a.continuation }));
    expect(last.scanned).toBe(5); expect(last.more).toBe(false); expect(last.continuation).toBeNull();
    expect(s.store.rows.size).toBe(30);
  });
  it("advances the time key and resets only the tie offset", async () => {
    const s = setup(); for (let n = 1; n <= 5; n++) s.assignments.push({ ...assignment("TIMED_OUT", id(n)), assignedAt: at(-100_000 + Math.floor(n / 2)) });
    const first = await s.run(s.options("timeouts", { batchSize: 3 }));
    expect(first.continuation).toEqual({ at: at(-99_999).toISOString(), consumedAtTime: 2 });
    const next = await s.run(s.options("timeouts", { batchSize: 3, cursor: first.continuation }));
    expect(next.scanned).toBe(2); expect(s.store.rows.size).toBe(5);
  });
  it.each([0, -1, 101, 1.5, NaN, Infinity])("rejects invalid batch size %s before reads", async batchSize => {
    const s = setup(); await expect(s.run(s.options("timeouts", { batchSize }))).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    expect(s.queries).toEqual([]);
  });
  it.each([-1, NaN, Infinity])("rejects invalid threshold %s", async freshnessThresholdMs => {
    const s = setup(); await expect(s.run(s.options("locations", { freshnessThresholdMs }))).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  });
  it("rejects malformed time, unknown options and future/invalid cursors", async () => {
    const s = setup();
    for (const extra of [{ evaluatedAt: new Date(NaN) }, { unexpected: "secret" }, { cursor: { at: at(1).toISOString(), consumedAtTime: 1 } }, { cursor: { at: time.toISOString(), consumedAtTime: -1 } }]) {
      await expect(s.run({ ...s.options("timeouts"), ...extra })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    }
  });
  it.each(["timeouts", "failures", "locations", "recovery"] as const)("empty %s page terminates without work", async lane => {
    const s = setup(); expect(await s.run(s.options(lane))).toMatchObject({ scanned: 0, more: false, continuation: null });
    expect(s.queries).toHaveLength(1); expect(s.store.creates + s.store.updates).toBe(0);
  });
  it("enforces maximum 100 and rejects an oversized source result", async () => {
    const s = setup(); for (let n = 1; n <= 102; n++) s.assignments.push(assignment("TIMED_OUT", id(n)));
    expect((await s.run(s.options("timeouts", { batchSize: 100 }))).scanned).toBe(100);
    const source = { ...s.source, readPage: vi.fn(async () => Array(102).fill({ at: time, lane: "timeouts", facts: timeout() })) } as ReconciliationSource;
    await expect(createRiskReconciler(source, s.service)(s.options("timeouts"))).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
  it("sanitizes source query failure with no cause or identifiers", async () => {
    const s = setup(); s.delegates.assignments.findMany.mockRejectedValueOnce(new Error(`private ${entityId}`));
    await expect(s.run(s.options("timeouts"))).rejects.toMatchObject({ message: "Risk reconciliation source unavailable", code: "SOURCE_UNAVAILABLE" });
    expect(s.store.creates).toBe(0);
  });
  it("reports a bounded continuation ceiling without skipping the remaining ties", async () => {
    const s = setup();
    const source: ReconciliationSource = { ...s.source, readPage: async () => Array.from({ length: 3 }, () => ({ lane: "timeouts" as const, at: at(-100_000), facts: timeout() })) };
    const result = await createRiskReconciler(source, s.service)(s.options("timeouts", { batchSize: 2, cursor: { at: at(-100_000).toISOString(), consumedAtTime: 1_000_000 } }));
    expect(result).toMatchObject({ scanned: 2, more: true, continuation: null, continuationLimitReached: true });
  });
  it("selects no location coordinates, identities beyond internal linkage, or contact details", async () => {
    const s = setup(); s.assignments.push(assignment()); await s.run(s.options("locations"));
    expect(s.queries[0].select).toEqual({ id: true, orderId: true, status: true, assignedAt: true, updatedAt: true, rider: { select: { lastLocationAt: true } } });
  });
});

describe("timeout and durable failure recovery", () => {
  it.each([true, false])("timeout hook/reconciliation ordering converges: hook first %s", async hookFirst => {
    const s = setup(); s.assignments.push(assignment("TIMED_OUT"));
    if (hookFirst) await s.hooks.assignmentTimedOut(timeout());
    expect((await s.run(s.options("timeouts"))).recorded).toBe(1);
    await s.hooks.assignmentTimedOut(timeout()); await s.run(s.options("timeouts"));
    expect(s.store.rows.size).toBe(1); expect([...s.store.rows.values()][0]).toMatchObject({ status: "OPEN", revision: 0, occurrenceKey: entityId });
    expect(s.store.updates).toBe(0);
  });
  it("preserves legacy null deadlines and never expires merely overdue offers", async () => {
    const s = setup(); s.assignments.push({ ...assignment("TIMED_OUT"), offerExpiresAt: null }, assignment("OFFERED", id(2)));
    expect((await s.run(s.options("timeouts"))).recorded).toBe(1);
    expect([...s.store.rows.values()][0]!.evidence).toMatchObject({ offerExpiresAt: null });
    expect(s.assignments[1]!.status).toBe("OFFERED");
  });
  it.each([null, at(-200_000), at(1)])("unavailable timeout facts stay isolated (%s)", async timedOutAt => {
    const s = setup(); s.assignments.push({ ...assignment("TIMED_OUT"), timedOutAt }, assignment("TIMED_OUT", id(2)));
    expect(await s.run(s.options("timeouts"))).toMatchObject({ scanned: 2, unavailable: 1, recorded: 1 });
  });
  it.each([true, false])("failure hook/reconciliation ordering converges: hook first %s", async hookFirst => {
    const s = setup(); s.seedFailure(); if (hookFirst) await s.hooks.deliveryFailed(failure());
    await s.run(s.options("failures")); await s.hooks.deliveryFailed(failure()); await s.run(s.options("failures"));
    expect(s.store.rows.size).toBe(1); expect([...s.store.rows.values()][0]).toMatchObject({ status: "OPEN", occurrenceKey: actorId, resolutionPolicy: "MANUAL_RESOLUTION" });
    expect(s.store.updates).toBe(0);
  });
  it("uses durable metadata, preserves false, and never substitutes current order state or notes", async () => {
    const s = setup(); s.seedFailure();
    s.events[0]!.metadata = { requiresManualReview: false, orderStatusAtFailure: "OUT_FOR_DELIVERY", note: "FORBIDDEN" };
    expect(await s.run(s.options("failures"))).toMatchObject({ skipped: 1, recorded: 0 });
    s.events[0]!.metadata = { requiresManualReview: true, orderStatusAtFailure: "OUT_FOR_DELIVERY", note: "FORBIDDEN" };
    const result = await s.run(s.options("failures"));
    expect(result.recorded).toBe(1); expect(JSON.stringify(result)).not.toContain("FORBIDDEN");
    expect(s.queries[0].select).not.toHaveProperty("note");
    expect([...s.store.rows.values()][0]!.evidence).not.toHaveProperty("note");
  });
  it.each([null, {}, { requiresManualReview: "true", orderStatusAtFailure: "OUT_FOR_DELIVERY" }, { requiresManualReview: true, orderStatusAtFailure: "SECRET" }])("missing/malformed durable metadata is unavailable: %j", async metadata => {
    const s = setup(); s.seedFailure(); s.events[0]!.metadata = metadata;
    expect(await s.run(s.options("failures"))).toMatchObject({ unavailable: 1, recorded: 0 });
  });
  it("rejects broken event linkage and malformed event identities", async () => {
    const s = setup(); s.seedFailure(); s.events[0]!.orderId = secondActorId;
    expect((await s.run(s.options("failures"))).unavailable).toBe(1);
    s.events[0]!.orderId = orderId; s.events[0]!.id = "invalid";
    expect((await s.run(s.options("failures"))).unavailable).toBe(1);
  });
  it("excludes future failure events and never assumes a missing assignment is FAILED", async () => {
    const s = setup(); s.seedFailure(); s.events[0]!.occurredAt = at(1);
    expect((await s.run(s.options("failures"))).scanned).toBe(0);
    s.events[0]!.occurredAt = at(-1); s.events[0]!.assignmentId = null;
    expect((await s.run(s.options("failures"))).unavailable).toBe(1);
  });
  it("does not reopen terminal detections and concurrent runs converge", async () => {
    const s = setup(); s.seedFailure(); await Promise.all([s.run(s.options("failures")), s.run(s.options("failures"))]);
    const r = [...s.store.rows.values()][0]!;
    await s.service.dismissAssessment({ id: r.id, expectedRevision: 0, actorId, at: time, reason: "FALSE_POSITIVE" });
    const snapshot = structuredClone([...s.store.rows.values()]); await s.run(s.options("failures"));
    expect([...s.store.rows.values()]).toEqual(snapshot);
  });
});

describe("stale detection and recovery", () => {
  it.each([
    { age: 60_000, threshold: 60_000, recorded: 0, unavailable: 0 },
    { age: 60_001, threshold: 60_000, recorded: 1, unavailable: 0 },
    { age: 0, threshold: 0, recorded: 0, unavailable: 0 },
    { age: 1, threshold: 0, recorded: 1, unavailable: 0 },
    { age: -1, threshold: 0, recorded: 0, unavailable: 1 },
  ])("preserves freshness boundary %j", async c => {
    const s = setup(); s.assignments.push({ ...assignment(), rider: { lastLocationAt: at(-c.age) } });
    expect(await s.run(s.options("locations", { freshnessThresholdMs: c.threshold }))).toMatchObject({ recorded: c.recorded, unavailable: c.unavailable });
  });
  it("missing location is unavailable and inactive assignments never detect", async () => {
    const s = setup(); s.assignments.push({ ...assignment(), rider: { lastLocationAt: null } }, assignment("DELIVERED", id(2)), assignment("OFFERED", id(3)));
    expect(await s.run(s.options("locations"))).toMatchObject({ scanned: 1, unavailable: 1, recorded: 0 });
  });
  it.each([true, false])("stale hook/reconciliation convergence with hook first %s", async hookFirst => {
    const s = setup(); s.assignments.push(assignment()); if (hookFirst) await s.hooks.observeLocation(stale());
    await s.run(s.options("locations")); await s.hooks.observeLocation(stale()); await s.run(s.options("locations"));
    expect(s.store.rows.size).toBe(1); expect([...s.store.rows.values()][0]!.occurrenceKey).toBe(`${entityId}:${at(-60_001).toISOString()}`);
  });
  it.each([false, true])("fresh recovery closes open/acknowledged episodes: acknowledged %s", async acknowledged => {
    const s = setup(); const row = await s.seedStale(); s.assignments.push({ ...assignment(), rider: { lastLocationAt: time } });
    if (acknowledged) await s.service.acknowledgeAssessment({ id: row.id, expectedRevision: 0, actorId, at: time });
    expect((await s.run(s.options("recovery", { freshnessThresholdMs: 0 }))).resolved).toBe(1);
    expect(s.store.rows.get(row.id)).toMatchObject({ status: "RESOLVED", resolutionReason: "CONDITION_CLEARED", resolvedByAdminId: null,
      acknowledgedByAdminId: acknowledged ? actorId : null, detectedAt: row.detectedAt, lastEvaluatedAt: row.lastEvaluatedAt, evidence: row.evidence });
    const snapshot = structuredClone([...s.store.rows.values()]); await s.run(s.options("recovery")); expect([...s.store.rows.values()]).toEqual(snapshot);
  });
  it.each([null, at(1), at(-60_001)])("missing/future/stale locations cannot establish recovery %s", async lastLocationAt => {
    const s = setup(); await s.seedStale(); s.assignments.push({ ...assignment(), rider: { lastLocationAt } });
    expect((await s.run(s.options("recovery"))).resolved).toBe(0); expect(s.store.updates).toBe(0);
  });
  it("older recovery cannot clear equal/newer anchors or later observations", async () => {
    const s = setup(); await s.seedStale(); s.assignments.push({ ...assignment(), rider: { lastLocationAt: at(-60_001) } });
    expect((await s.run(s.options("recovery", { freshnessThresholdMs: 100_000 }))).resolved).toBe(0);
    const row = [...s.store.rows.values()][0]!; row.lastEvaluatedAt = at(1); s.assignments[0]!.rider.lastLocationAt = time;
    expect((await s.run(s.options("recovery"))).resolved).toBe(0);
  });
  it.each(["DELIVERED", "FAILED", "TIMED_OUT", "DECLINED", "CANCELLED", "REASSIGNED"])("terminal %s clears open and acknowledged stale episodes only", async status => {
    const s = setup(); const first = await s.seedStale(); const second = await s.seedStale(id(2));
    s.assignments.push(assignment(status), assignment(status, id(2)));
    await s.service.acknowledgeAssessment({ id: second.id, expectedRevision: 0, actorId, at: time });
    await s.hooks.assignmentTimedOut(timeout()); await s.hooks.deliveryFailed(failure());
    expect((await s.run(s.options("recovery"))).resolved).toBe(2);
    expect(s.store.rows.size).toBe(4);
    for (const row of [first, second]) expect(s.store.rows.get(row.id)).toMatchObject({ status: "RESOLVED", resolvedByAdminId: null, resolutionReason: "CONDITION_CLEARED", evidence: row.evidence, occurrenceKey: row.occurrenceKey, detectedAt: row.detectedAt, lastEvaluatedAt: row.lastEvaluatedAt });
    expect([...s.store.rows.values()].filter(r => r.ruleCode !== "RIDER_LOCATION_STALE").every(r => r.status === "OPEN")).toBe(true);
  });
  it.each(["OFFERED", "UNKNOWN"])("does not treat %s as terminal cleanup proof", async status => {
    const s = setup(); await s.seedStale(); s.assignments.push(assignment(status));
    expect((await s.run(s.options("recovery"))).resolved).toBe(0);
  });
  it.each(["resolve", "dismiss"])("terminal cleanup preserves existing ADMIN %s", async action => {
    const s = setup(); const r = await s.seedStale(); s.assignments.push(assignment("DELIVERED"));
    if (action === "resolve") await s.service.resolveAssessment({ id: r.id, expectedRevision: 0, actorId, at: time, reason: "OPERATOR_RESOLVED" });
    else await s.service.dismissAssessment({ id: r.id, expectedRevision: 0, actorId, at: time, reason: "FALSE_POSITIVE" });
    const snapshot = structuredClone([...s.store.rows.values()]); await s.run(s.options("recovery")); expect([...s.store.rows.values()]).toEqual(snapshot);
  });
  it("recovery pagination includes terminal rows so its own writes cannot shift ties", async () => {
    const s = setup(); for (let n = 1; n <= 5; n++) { await s.seedStale(id(n)); s.assignments.push(assignment("DELIVERED", id(n))); }
    const first = await s.run(s.options("recovery", { batchSize: 2 }));
    const second = await s.run(s.options("recovery", { batchSize: 2, cursor: first.continuation }));
    const third = await s.run(s.options("recovery", { batchSize: 2, cursor: second.continuation }));
    expect([first.resolved, second.resolved, third.resolved]).toEqual([2, 2, 1]); expect(third.more).toBe(false);
    expect(s.queries.every(q => q.where.status === undefined)).toBe(true);
  });
  it("rejects scope/occurrence/policy/version inconsistencies", async () => {
    for (const patch of [{ orderId: actorId }, { occurrenceKey: "other" }, { resolutionPolicy: "MANUAL_RESOLUTION" }, { ruleVersion: "2" }]) {
      const s = setup(); const r = await s.seedStale(); Object.assign(s.store.rows.get(r.id)!, patch); s.assignments.push(assignment("DELIVERED"));
      expect((await s.run(s.options("recovery"))).resolved).toBe(0);
    }
  });
  it("future assignment state is unavailable instead of reconstructing historical state", async () => {
    const s = setup(); await s.seedStale(); s.assignments.push({ ...assignment("DELIVERED"), updatedAt: at(1) });
    expect(await s.run(s.options("recovery"))).toMatchObject({ unavailable: 1, resolved: 0 });
  });
});

describe("reconciliation races, isolation and privacy", () => {
  it.each(["resolve", "dismiss", "acknowledge"])("concurrent ADMIN %s preserves winning metadata", async action => {
    const s = setup(); const r = await s.seedStale(); s.assignments.push(assignment("DELIVERED"));
    s.store.beforeUpdate = async () => {
      const input = { id: r.id, expectedRevision: 0, actorId: secondActorId, at: time };
      if (action === "resolve") await s.service.resolveAssessment({ ...input, reason: "OPERATOR_RESOLVED" });
      else if (action === "dismiss") await s.service.dismissAssessment({ ...input, reason: "FALSE_POSITIVE" });
      else await s.service.acknowledgeAssessment(input);
    };
    await s.run(s.options("recovery"));
    const row = s.store.rows.get(r.id)!; expect(row.revision).toBe(1);
    expect(row.status).toBe(action === "resolve" ? "RESOLVED" : action === "dismiss" ? "DISMISSED" : "ACKNOWLEDGED");
    expect(action === "resolve" ? row.resolvedByAdminId : action === "dismiss" ? row.dismissedByAdminId : row.acknowledgedByAdminId).toBe(secondActorId);
  });
  it("one recording failure does not stop unrelated candidates or leak details", async () => {
    const s = setup(); s.assignments.push(assignment("TIMED_OUT"), assignment("TIMED_OUT", id(2)));
    vi.spyOn(s.service, "recordDetection").mockRejectedValueOnce(new Error(`SECRET ${entityId}`));
    expect(await s.run(s.options("timeouts"))).toMatchObject({ scanned: 2, failures: 1, recorded: 1 });
  });
  it("malformed evidence, point-read failure and resolution failure are candidate-isolated", async () => {
    const s = setup(); const corrupt = await s.seedStale(id(1));
    for (let n = 2; n <= 4; n++) await s.seedStale(id(n));
    for (let n = 1; n <= 4; n++) s.assignments.push(assignment("DELIVERED", id(n)));
    s.store.rows.get(corrupt.id)!.evidence = { secret: "FORBIDDEN" };
    s.delegates.assignments.findUnique.mockRejectedValueOnce(new Error("FORBIDDEN"));
    vi.spyOn(s.service, "resolveAssessment").mockRejectedValueOnce(new Error("FORBIDDEN"));
    const result = await s.run(s.options("recovery"));
    expect(result).toMatchObject({ scanned: 4, failures: 3, resolved: 1 });
    expect(JSON.stringify(result)).not.toMatch(/FORBIDDEN|10000000|11111111/);
  });
  it("concurrent hook and reconciliation detection converge", async () => {
    const s = setup(); s.assignments.push(assignment());
    await Promise.all([s.hooks.observeLocation(stale()), s.run(s.options("locations")), s.run(s.options("locations"))]);
    expect(s.store.rows.size).toBe(1);
  });
  it("a domain transition racing a stale scan converges on the next recovery pass", async () => {
    const s = setup(); s.assignments.push(assignment());
    const record = s.service.recordDetection.bind(s.service);
    vi.spyOn(s.service, "recordDetection").mockImplementationOnce(async detection => {
      s.assignments[0]!.status = "DELIVERED"; s.assignments[0]!.updatedAt = time;
      return record(detection);
    });
    await s.run(s.options("locations"));
    expect((await s.run(s.options("recovery"))).resolved).toBe(1);
    expect(s.assignments[0]!.status).toBe("DELIVERED");
  });
  it("concurrent recovery passes converge without incrementing revision twice", async () => {
    const s = setup(); const r = await s.seedStale(); s.assignments.push(assignment("DELIVERED"));
    await Promise.all([s.run(s.options("recovery")), s.run(s.options("recovery"))]);
    expect(s.store.rows.get(r.id)).toMatchObject({ status: "RESOLVED", revision: 1, resolvedByAdminId: null });
  });
  it("same facts/time produce identical aggregates without mutating source inputs", async () => {
    const s = setup(); s.seedFailure(); const snapshot = structuredClone([s.assignments, s.events]);
    const first = await s.run(s.options("failures")); const second = await s.run(s.options("failures"));
    expect(first).toEqual(second); expect([s.assignments, s.events]).toEqual(snapshot);
    const serialized = JSON.stringify(first);
    for (const forbidden of [entityId, orderId, actorId, "evidence", "metadata", "assignmentId", "assessmentId", "riderId"]) expect(serialized).not.toContain(forbidden);
    expect(s.queries[0].select.assignment.select).toEqual({ id: true, orderId: true, status: true });
  });
  it("core logic needs no wall clock", async () => {
    const s = setup(); s.assignments.push(assignment());
    const spy = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("wall clock"); });
    try { expect((await s.run(s.options("locations"))).recorded).toBe(1); } finally { spy.mockRestore(); }
  });
});
