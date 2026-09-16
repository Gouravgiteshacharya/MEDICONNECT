import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { operationalRiskRules, evaluateAssignmentTimeout, evaluateDeliveryFailed, evaluateRiderLocationStale, type AssignmentTimeoutFacts, type DeliveryFailedFacts, type RiderLocationStaleFacts } from "../src/risk/risk.rules.js";
import { validateRiskDetection, validateRiskEvidence } from "../src/risk/risk.evidence.js";
import type { OperationalRiskRuleResult } from "../src/risk/risk.types.js";

const assignmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = (milliseconds: number) => new Date(Date.UTC(2026, 8, 13) + milliseconds); // Sunday; elapsed time only.
const timeout = (overrides: Partial<AssignmentTimeoutFacts> = {}): AssignmentTimeoutFacts => ({ assignmentId, status: "TIMED_OUT", assignedAt: at(0), offerExpiresAt: at(30_000), timedOutAt: at(31_000), evaluatedAt: at(60_000), ...overrides });
const failed = (overrides: Partial<DeliveryFailedFacts> = {}): DeliveryFailedFacts => ({ assignmentId, assignmentStatus: "FAILED", failureEvent: { id: eventId, eventType: "FAILED_DELIVERY", occurredAt: at(30_000), orderStatusAtFailure: "OUT_FOR_DELIVERY", requiresManualReview: true }, evaluatedAt: at(60_000), ...overrides });
const stale = (overrides: Partial<RiderLocationStaleFacts> = {}): RiderLocationStaleFacts => ({ assignmentId, assignmentStatus: "ACCEPTED", lastLocationAt: at(0), freshnessThresholdMs: 60_000, evaluatedAt: at(60_001), ...overrides });
function matched(result: OperationalRiskRuleResult) {
  expect(result.status).toBe("matched");
  if (result.status !== "matched") throw new Error("Expected matched test result");
  return result.detection;
}
const unavailable = (reason: string) => ({ status: "unavailable", reason });
const cases = [
  { name: "timeout", evaluate: (input: unknown) => evaluateAssignmentTimeout(input as AssignmentTimeoutFacts), facts: () => timeout(), statusKey: "status" },
  { name: "failed", evaluate: (input: unknown) => evaluateDeliveryFailed(input as DeliveryFailedFacts), facts: () => failed(), statusKey: "assignmentStatus" },
  { name: "stale", evaluate: (input: unknown) => evaluateRiderLocationStale(input as RiderLocationStaleFacts), facts: () => stale(), statusKey: "assignmentStatus" },
];

describe("pure risk shared contracts", () => {
  it("registers exactly three immutable rules with exact metadata", () => {
    expect(Object.keys(operationalRiskRules)).toEqual(["ASSIGNMENT_OFFER_TIMED_OUT", "DELIVERY_FAILED", "RIDER_LOCATION_STALE"]);
    const policies = [["INFO", "HISTORICAL_EVENT_ONLY"], ["HIGH", "MANUAL_RESOLUTION"], ["LOW", "AUTO_RESOLVABLE"]];
    Object.entries(operationalRiskRules).forEach(([ruleCode, rule], index) => {
      expect(rule.metadata).toEqual({ ruleCode, ruleVersion: "1", evidenceSchemaVersion: 1, entityType: "DELIVERY_ASSIGNMENT", severity: policies[index][0], resolutionPolicy: policies[index][1] });
      expect(Object.isFrozen(rule)).toBe(true); expect(Object.isFrozen(rule.metadata)).toBe(true);
    });
    expect(Object.isFrozen(operationalRiskRules)).toBe(true);
  });
  it.each(["risk.rules.ts", "rules/assignment-timeout.rule.ts", "rules/delivery-failed.rule.ts", "rules/rider-location-stale.rule.ts"])("%s imports only pure modules and never reads clock/environment", file => {
    const source = readFileSync(new URL(`../src/risk/${file}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) expect(path).toMatch(/(?:risk\.(?:types|evidence)|location\/freshness|rules\/(?:assignment-timeout|delivery-failed|rider-location-stale)\.rule)\.js$/);
    expect(source).not.toMatch(/Date\.now\s*\(|new\s+Date\s*\(\s*\)|process\.env|import\s*\(|require\s*\(/);
  });
  it.each(cases)("$name is deterministic, detached and passes Phase 13A validation", ({ facts, evaluate }) => {
    const input = facts(); const before = structuredClone(input);
    const first = evaluate(input); const second = evaluate(input);
    expect(first).toEqual(second); expect(input).toEqual(before); expect(first).not.toBe(second);
    const a = matched(first); const b = matched(second);
    expect(a.evidence).not.toBe(b.evidence);
    expect(validateRiskEvidence(a.ruleCode, a.evidenceSchemaVersion, a.evidence)).toEqual(a.evidence);
    expect(validateRiskDetection(a)).toEqual(a);
    a.detectedAt.setTime(0); a.evaluatedAt.setTime(0);
    a.sourceOccurredAt?.setTime(0); Object.assign(a.evidence, { note: "caller mutation" });
    expect(input).toEqual(before); expect(evaluate(input)).toEqual(second);
  });
  it.each(cases)("$name does not read wall-clock time even through dependencies", ({ facts, evaluate }) => {
    const input = facts(); const expected = evaluate(input); const OriginalDate = Date;
    vi.stubGlobal("Date", new Proxy(OriginalDate, {
      construct(target, args) { if (!args.length) throw new Error("Wall clock forbidden"); return Reflect.construct(target, args); },
      get(target, key) { if (key === "now") return () => { throw new Error("Wall clock forbidden"); }; return Reflect.get(target, key); },
    }));
    try { expect(evaluate(input)).toEqual(expected); } finally { vi.unstubAllGlobals(); }
  });
  it.each(cases)("$name excludes broad private fields from every result", ({ facts, evaluate }) => {
    const privateFields = Object.fromEntries(["riderId", "customerId", "userId", "phone", "email", "address", "latitude", "longitude", "medicine", "prescription", "note", "message", "cause", "blame"].map(key => [key, "private"]));
    const input = { ...facts(), ...privateFields };
    if ("failureEvent" in input) input.failureEvent = { ...input.failureEvent!, ...privateFields };
    const result = matched(evaluate(input));
    const keys = (value: unknown): string[] => typeof value === "object" && value !== null ? Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]) : [];
    expect(keys(result).filter(key => key in privateFields)).toEqual([]);
    expect(JSON.stringify(result.evidence)).not.toContain(assignmentId);
    expect(JSON.stringify(result.evidence)).not.toContain(eventId);
  });
  it.each(cases)("$name normalizes UUIDs and optional trusted linkage", ({ facts, evaluate }) => {
    const input = { ...facts(), assignmentId: assignmentId.toUpperCase(), orderId: orderId.toUpperCase() };
    if ("failureEvent" in input) input.failureEvent = { ...input.failureEvent!, id: eventId.toUpperCase() };
    expect(matched(evaluate(input))).toMatchObject({ entityId: assignmentId, orderId });
    expect(matched(evaluate(facts())).orderId).toBeNull();
    expect(evaluate({ ...facts(), orderId: "invalid" })).toEqual(unavailable("invalid_required_fact"));
  });
  it.each(cases)("$name safely rejects malformed containers, identities and explicit times", ({ facts, evaluate }) => {
    for (const input of [null, undefined]) expect(evaluate(input)).toEqual(unavailable("missing_required_fact"));
    for (const input of [12, "raw note", []]) expect(evaluate(input)).toEqual(unavailable("invalid_required_fact"));
    for (const field of ["assignmentId", "evaluatedAt"]) {
      expect(evaluate({ ...facts(), [field]: null })).toEqual(unavailable("missing_required_fact"));
      expect(evaluate({ ...facts(), [field]: undefined })).toEqual(unavailable("missing_required_fact"));
      expect(evaluate({ ...facts(), [field]: "bad" })).toEqual(unavailable("invalid_required_fact"));
    }
    expect(evaluate({ ...facts(), evaluatedAt: new Date(NaN) })).toEqual(unavailable("invalid_required_fact"));
  });
  it.each(cases)("$name distinguishes unsupported/missing/invalid states", ({ facts, evaluate, statusKey }) => {
    expect(evaluate({ ...facts(), [statusKey]: "FUTURE_STATE" })).toEqual(unavailable("unsupported_state"));
    expect(evaluate({ ...facts(), [statusKey]: null })).toEqual(unavailable("missing_required_fact"));
    expect(evaluate({ ...facts(), [statusKey]: 3 })).toEqual(unavailable("invalid_required_fact"));
    expect(evaluate({ ...facts(), [statusKey]: "" })).toEqual(unavailable("invalid_required_fact"));
  });
});

describe("assignment timeout rule", () => {
  it("matches processing time after deadline with exact evidence and assignment occurrence", () => {
    const result = matched(evaluateAssignmentTimeout(timeout()));
    expect(result.occurrenceKey).toBe(assignmentId);
    expect(result.evidence).toEqual({ assignmentStatus: "TIMED_OUT", offerExpiresAt: at(30_000).toISOString(), timedOutAt: at(31_000).toISOString() });
    expect(result.sourceOccurredAt).toEqual(at(31_000));
    expect(result.detectedAt).toEqual(at(60_000));
  });
  it.each(["OFFERED", "ACCEPTED", "DECLINED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "CANCELLED", "REASSIGNED"])("%s never infers timeout from elapsed deadline", status => {
    expect(evaluateAssignmentTimeout(timeout({ status, timedOutAt: null }))).toEqual({ status: "not_matched" });
  });
  it("matches a legacy null deadline without reconstruction", () => {
    expect(matched(evaluateAssignmentTimeout(timeout({ offerExpiresAt: null }))).evidence).toEqual({ assignmentStatus: "TIMED_OUT", offerExpiresAt: null, timedOutAt: at(31_000).toISOString() });
  });
  it.each([30_000, 30_001, 50_000])("matches timeout at/after the persisted deadline: %d", ms => {
    expect(evaluateAssignmentTimeout(timeout({ timedOutAt: at(ms) })).status).toBe("matched");
  });
  it.each(["assignedAt", "timedOutAt", "offerExpiresAt"])("rejects malformed %s without throwing", field => {
    expect(evaluateAssignmentTimeout({ ...timeout(), [field]: undefined })).toEqual(unavailable("missing_required_fact"));
    for (const value of [new Date(NaN), "2026-09-13", 0]) expect(evaluateAssignmentTimeout({ ...timeout(), [field]: value } as AssignmentTimeoutFacts)).toEqual(unavailable("invalid_required_fact"));
  });
  it("requires recorded timedOutAt", () => {
    expect(evaluateAssignmentTimeout(timeout({ timedOutAt: null }))).toEqual(unavailable("missing_required_fact"));
  });
  it.each([
    { timedOutAt: at(29_999) }, { timedOutAt: at(60_001) }, { assignedAt: at(32_000), offerExpiresAt: null }, { offerExpiresAt: at(-1) },
  ])("rejects inconsistent chronology %j", overrides => {
    expect(evaluateAssignmentTimeout(timeout(overrides))).toEqual(unavailable("inconsistent_facts"));
  });
  it("retains occurrence identity under later evaluation", () => {
    const first = matched(evaluateAssignmentTimeout(timeout())); const later = matched(evaluateAssignmentTimeout(timeout({ evaluatedAt: at(100_000) })));
    expect(later.occurrenceKey).toBe(first.occurrenceKey); expect(later.evidence).toEqual(first.evidence);
  });
});

describe("delivery failed rule", () => {
  it("uses durable event identity and preserves recorded order state", () => {
    const result = matched(evaluateDeliveryFailed(failed()));
    expect(result.occurrenceKey).toBe(eventId); expect(result.occurrenceKey).not.toBe(assignmentId);
    expect(result.evidence).toEqual({ assignmentStatus: "FAILED", eventType: "FAILED_DELIVERY", occurredAt: at(30_000).toISOString(), orderStatusAtFailure: "OUT_FOR_DELIVERY", requiresManualReview: true });
    expect(result.sourceOccurredAt).toEqual(at(30_000));
  });
  it.each(["OFFERED", "ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REASSIGNED", "TIMED_OUT", "DECLINED"])("%s does not infer failure", assignmentStatus => {
    expect(evaluateDeliveryFailed(failed({ assignmentStatus, failureEvent: null }))).toEqual({ status: "not_matched" });
  });
  it("requires durable failure event", () => {
    expect(evaluateDeliveryFailed(failed({ failureEvent: null }))).toEqual(unavailable("missing_required_fact"));
    expect(evaluateDeliveryFailed({ ...failed(), failureEvent: [] } as unknown as DeliveryFailedFacts)).toEqual(unavailable("invalid_required_fact"));
  });
  it("rejects wrong event type", () => {
    const input = failed();
    expect(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, eventType: "DELIVERED" } })).toEqual(unavailable("inconsistent_facts"));
  });
  it("does not match when manual review is explicitly false", () => {
    const input = failed();
    expect(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, requiresManualReview: false } })).toEqual({ status: "not_matched" });
  });
  it.each(["id", "eventType", "occurredAt", "orderStatusAtFailure", "requiresManualReview"])("requires valid event %s", field => {
    const input = failed();
    expect(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, [field]: undefined } })).toEqual(unavailable("missing_required_fact"));
    const invalid = field === "eventType" ? 3 : "private note";
    expect(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, [field]: invalid } } as DeliveryFailedFacts)).toEqual(unavailable("invalid_required_fact"));
  });
  it("rejects invalid/future event timestamps", () => {
    const input = failed();
    expect(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, occurredAt: new Date(NaN) } })).toEqual(unavailable("invalid_required_fact"));
    expect(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, occurredAt: at(60_001) } })).toEqual(unavailable("inconsistent_facts"));
  });
  it("uses separate occurrence keys for distinct durable events", () => {
    const input = failed(); const first = matched(evaluateDeliveryFailed(input));
    const second = matched(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, id: orderId } }));
    expect(second.entityId).toBe(first.entityId); expect(second.occurrenceKey).not.toBe(first.occurrenceKey);
  });
  it.each(["RIDER_ASSIGNED", "PICKED_UP", "CANCELLED"])("preserves recorded %s without interpreting failure cause", orderStatusAtFailure => {
    const input = failed();
    expect(matched(evaluateDeliveryFailed({ ...input, failureEvent: { ...input.failureEvent!, orderStatusAtFailure } })).evidence).toHaveProperty("orderStatusAtFailure", orderStatusAtFailure);
  });
});

describe("rider location stale rule", () => {
  it.each(["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"])("matches stale location on %s", assignmentStatus => {
    expect(evaluateRiderLocationStale(stale({ assignmentStatus })).status).toBe("matched");
  });
  it.each(["OFFERED", "DECLINED", "TIMED_OUT", "FAILED", "DELIVERED", "CANCELLED", "REASSIGNED"])("does not match inactive state %s", assignmentStatus => {
    expect(evaluateRiderLocationStale(stale({ assignmentStatus, lastLocationAt: null }))).toEqual({ status: "not_matched" });
  });
  it.each([[0, "not_matched"], [59_999, "not_matched"], [60_000, "not_matched"], [60_001, "matched"]])("age %d preserves exact freshness boundary", (age, status) => {
    expect(evaluateRiderLocationStale(stale({ evaluatedAt: at(age as number) })).status).toBe(status);
  });
  it.each([[0, "not_matched"], [1, "matched"]])("zero threshold at age %d", (age, status) => {
    const result = evaluateRiderLocationStale(stale({ freshnessThresholdMs: 0, evaluatedAt: at(age as number) }));
    expect(result.status).toBe(status);
    if (result.status === "matched") expect(validateRiskDetection(result.detection).evidence).toHaveProperty("freshnessThresholdMs", 0);
  });
  it.each([null, undefined])("missing location %s is unavailable, not stale", value => {
    expect(evaluateRiderLocationStale({ ...stale(), lastLocationAt: value } as RiderLocationStaleFacts)).toEqual(unavailable("missing_required_fact"));
  });
  it.each([new Date(NaN), "2026-09-13", 0])("invalid location %s is unavailable", value => {
    expect(evaluateRiderLocationStale({ ...stale(), lastLocationAt: value } as RiderLocationStaleFacts)).toEqual(unavailable("invalid_required_fact"));
  });
  it("rejects future location before calling freshness helper", () => {
    expect(evaluateRiderLocationStale(stale({ lastLocationAt: at(60_002) }))).toEqual(unavailable("inconsistent_facts"));
  });
  it("zero threshold still distinguishes missing and future location", () => {
    expect(evaluateRiderLocationStale(stale({ freshnessThresholdMs: 0, lastLocationAt: null }))).toEqual(unavailable("missing_required_fact"));
    expect(evaluateRiderLocationStale(stale({ freshnessThresholdMs: 0, lastLocationAt: at(60_002) }))).toEqual(unavailable("inconsistent_facts"));
  });
  it("valid extended-year Dates also produce valid bounded occurrence keys", () => {
    const date = new Date("+010000-01-01T00:00:00.000Z");
    const result = matched(evaluateRiderLocationStale(stale({ lastLocationAt: date, evaluatedAt: new Date(date.getTime() + 1), freshnessThresholdMs: 0 })));
    expect(result.occurrenceKey).toBe(`${assignmentId}:010000-01-01T00:00:00.000Z`);
    expect(validateRiskDetection(result)).toEqual(result);
    expect(result.evidence).toHaveProperty("lastLocationAt", date.toISOString());
  });
  it.each([-1, NaN, Infinity, -Infinity, "0", false])("rejects invalid threshold %s", value => {
    expect(evaluateRiderLocationStale({ ...stale(), freshnessThresholdMs: value } as RiderLocationStaleFacts)).toEqual(unavailable("invalid_required_fact"));
  });
  it("accepts fractional nonnegative thresholds just like the authoritative helper", () => {
    expect(evaluateRiderLocationStale(stale({ freshnessThresholdMs: 0.5, evaluatedAt: at(1) })).status).toBe("matched");
  });
  it("uses the same occurrence for a later evaluation but retains explainable evaluation time", () => {
    const a = matched(evaluateRiderLocationStale(stale())); const b = matched(evaluateRiderLocationStale(stale({ evaluatedAt: at(70_000) })));
    expect(a.occurrenceKey).toBe(`${assignmentId}:${at(0).toISOString()}`);
    expect(b.occurrenceKey).toBe(a.occurrenceKey); expect(b.evidence).not.toEqual(a.evidence);
    expect(b.sourceOccurredAt).toBeNull(); // No fabricated condition-entry timestamp.
    expect(b.evidence).toEqual({ assignmentStatus: "ACCEPTED", locationFreshness: "STALE", lastLocationAt: at(0).toISOString(), freshnessThresholdMs: 60_000, evaluatedAt: at(70_000).toISOString() });
  });
  it("new location anchor produces a new stale episode", () => {
    const first = matched(evaluateRiderLocationStale(stale()));
    expect(evaluateRiderLocationStale(stale({ lastLocationAt: at(60_001) })).status).toBe("not_matched");
    const second = matched(evaluateRiderLocationStale(stale({ lastLocationAt: at(60_001), evaluatedAt: at(120_002) })));
    expect(second.occurrenceKey).not.toBe(first.occurrenceKey);
  });
  it("uses elapsed instants only, independent of Sunday and timezone representation", () => {
    expect(at(0).getUTCDay()).toBe(0);
    const local = stale({ lastLocationAt: new Date("2026-09-13T05:30:00.000+05:30"), evaluatedAt: new Date("2026-09-13T05:31:00.001+05:30") });
    expect(evaluateRiderLocationStale(local)).toEqual(evaluateRiderLocationStale(stale()));
    expect(evaluateRiderLocationStale(stale({ lastLocationAt: new Date("2026-09-14T00:00:00.000Z"), evaluatedAt: new Date("2026-09-14T00:01:00.001Z") })).status).toBe("matched");
  });
});
