import { describe, expect, it } from "vitest";
import { extractDispatchDataset as extract } from "../src/ml/dispatch-dataset/dispatch-dataset.extractor.js";
import type { DispatchDatasetSource } from "../src/ml/dispatch-dataset/dispatch-dataset.types.js";
const d = (value: string) => new Date(value);
const options = { trainStart: d("2026-01-01T00:00:00Z"), validationStart: d("2026-02-01T00:00:00Z"), testStart: d("2026-03-01T00:00:00Z"), testEnd: d("2026-04-01T00:00:00Z"), outcomeCutoff: d("2026-04-02T00:00:00Z"), timezoneOffsetMinutes: 330 };
function source(id = "1", overrides: Partial<DispatchDatasetSource> = {}): DispatchDatasetSource {
  return { candidateId: "candidate-private-" + id, orderId: "order-private-" + id, riderId: "rider-private-" + id,
    dispatchRoundId: "round-private-" + id, assignmentId: "assignment-private-" + id, status: "ACCEPTED",
    attemptedAt: d("2026-01-04T20:00:00Z"), riderDistanceKm: 0.125, workloadAtDispatch: 0,
    deterministicRank: 1, dispatchPolicyVersion: "deterministic-dispatch-v1", selectionPolicy: "DETERMINISTIC_FALLBACK",
    workloadPenaltyKm: 2, shortlistSize: 10, searchRadiusKm: 15, freshnessThresholdMs: 60000,
    orderStatus: "DELIVERED", orderCancelledAt: null,
    assignment: { id: "assignment-private-" + id, orderId: "order-private-" + id, riderId: "rider-private-" + id,
      assignedAt: d("2026-01-04T20:00:00Z"), offerExpiresAt: d("2026-01-04T20:00:30Z"), status: "DELIVERED",
      acceptedAt: d("2026-01-04T20:00:10Z"), declinedAt: null, timedOutAt: null, cancelledAt: null, reassignedAt: null }, ...overrides };
}

const exclude = (s: DispatchDatasetSource, reason: string, o = options) => {
  const result = extract([s], o); expect(result.rows).toEqual([]); expect(result.counts.exclusionsByReason).toMatchObject({ [reason]: 1 });
  expect(Object.values(result.counts.exclusionsByReason).reduce((a,b)=>a+b,0)).toBe(1);
};
describe("dispatch dataset transformer", () => {
  it("exports exact allowed features and no identities/timestamps, immutably", () => {
    const input = source(), before = structuredClone(input); const result = extract([input], options);
    expect(result.rows).toEqual([{ schemaVersion: "dispatch-acceptance-v1", rowKey: "row-000001", orderGroupKey: "order-group-000001", split: "train", predictionPoint: "DISPATCH_PRE_OFFER", riderDistanceKm: 0.125, activeWorkload: 0, hourOfDay: 1, dayOfWeek: 1, accepted: true }]);
    expect(input).toEqual(before); expect(extract([input], options)).toEqual(result);
  });
  it.each(["DECLINED", "TIMED_OUT"])("labels %s false", status => {
    const s = source(); const a = { ...s.assignment!, status, acceptedAt: null, declinedAt: status === "DECLINED" ? d("2026-01-04T20:00:15Z") : null, timedOutAt: status === "TIMED_OUT" ? d("2026-01-04T21:00:00Z") : null };
    const result = extract([{ ...s, status, assignment: a }], options); expect(result.rows[0].accepted).toBe(false);
    expect(result.counts[status === "DECLINED" ? "declinedRows" : "timedOutRows"]).toBe(1);
  });
  it.each(["CANDIDATE", "SKIPPED"])("does not label %s negative", status => exclude(source("1", { status, assignment: null, assignmentId: null }), "unoffered_candidate"));
  it.each([null, "other"])("rejects round/policy %s", value => exclude(source("1", value === null ? { dispatchRoundId: null } : { dispatchPolicyVersion: value }), value === null ? "missing_round_id" : "invalid_policy"));
  it.each(["workloadPenaltyKm", "shortlistSize", "searchRadiusKm", "freshnessThresholdMs", "deterministicRank", "selectionPolicy", "dispatchPolicyVersion"])("requires metadata %s", key => exclude(source("1", { [key]: null }), "instrumentation_incomplete"));
  it.each(["2026-01-04T20:00:30Z", "2026-01-04T20:00:31Z", "2026-01-04T19:59:59Z", "bad"])("rejects acceptance %s", value => { const s=source(); exclude({ ...s, assignment: { ...s.assignment!, acceptedAt: d(value) } }, "invalid_acceptance"); });
  it.each([null, d("bad"), d("2026-01-04T20:00:00Z")])("rejects deadline %s", value => { const s=source(); exclude({ ...s, assignment: { ...s.assignment!, offerExpiresAt: value } }, value === null ? "missing_offer_deadline" : "invalid_offer_deadline"); });
  it.each(["2026-01-04T20:00:00Z", "2026-01-04T20:00:30Z", "bad"])("rejects decline %s", value => { const s=source(); exclude({ ...s, status: "DECLINED", assignment: { ...s.assignment!, status: "DECLINED", acceptedAt: null, declinedAt: d(value) } }, "invalid_decline"); });
  it("requires recorded mature timeout, not just an expired offer", () => {
    const s=source(); const unresolved={ ...s, status: "OFFERED", assignment: { ...s.assignment!, status: "OFFERED", acceptedAt: null } };
    exclude(unresolved, "outcome_not_mature");
    const timeout={ ...unresolved, status: "TIMED_OUT", assignment: { ...unresolved.assignment, status: "TIMED_OUT", timedOutAt: d("2026-01-04T21:00:00Z") } };
    exclude(timeout, "outcome_not_mature", { ...options, outcomeCutoff: d("2026-01-04T20:00:29Z") });
    exclude(timeout, "outcome_not_mature", { ...options, outcomeCutoff: d("2026-01-04T20:30:00Z") });
    expect(extract([timeout], options).rows[0].accepted).toBe(false);
    exclude({ ...timeout, assignment: { ...timeout.assignment, timedOutAt: d("2026-01-04T20:00:29Z") } }, "invalid_timeout");
  });
  it("does not use a decision after cutoff", () => exclude(source(), "outcome_not_mature", { ...options, outcomeCutoff: d("2026-01-04T20:00:09Z") }));
  it("later failure leaves acceptance positive", () => { const s=source(); expect(extract([{ ...s, assignment: { ...s.assignment!, status: "FAILED" } }], options).rows[0].accepted).toBe(true); });
  it("rejects contradictory decisions", () => { const s=source(); exclude({ ...s, assignment: { ...s.assignment!, declinedAt: d("2026-01-04T20:00:05Z") } }, "conflicting_outcome"); });
  it.each(["cancelledAt", "reassignedAt"])("excludes pre-decision intervention %s", key => { const s=source(); exclude({ ...s, assignment: { ...s.assignment!, [key]: d("2026-01-04T20:00:05Z") } }, "administrative_outcome_ambiguous"); });
  it("excludes missing cancellation evidence", () => exclude(source("1", { orderStatus: "CANCELLED" }), "administrative_outcome_ambiguous"));
  it.each([null, -1, NaN, Infinity])("rejects distance %s", riderDistanceKm => exclude(source("1", { riderDistanceKm }), "invalid_distance"));
  it.each([null, -1, 0.1, NaN, Infinity])("rejects workload %s", workloadAtDispatch => exclude(source("1", { workloadAtDispatch }), "invalid_workload"));
  it.each([0, 0.49, 10.123456789])("preserves distance %s", riderDistanceKm => expect(extract([source("1", { riderDistanceKm })], options).rows[0].riderDistanceKm).toBe(riderDistanceKm));
  it("groups repeated offers without hashing identities and excludes boundary crossing", () => {
    const a=source(), b=source("2"); const same={ ...b, orderId: a.orderId, assignment: { ...b.assignment!, orderId: a.orderId } };
    const result=extract([same,a],options); expect(result.rows.map(r=>r.orderGroupKey)).toEqual(["order-group-000001","order-group-000001"]); expect(extract([a,same],options)).toEqual(result);
    const next={ ...same, attemptedAt: d("2026-02-01T00:00:00Z"), assignment: { ...same.assignment, assignedAt: d("2026-02-01T00:00:00Z"), offerExpiresAt: d("2026-02-01T00:00:30Z"), acceptedAt: d("2026-02-01T00:00:05Z") } };
    expect(extract([a,next],options).counts.exclusionsByReason.cross_split_order_group).toBe(2);
  });
  it.each(["candidate", "round+rider", "assignment"])("excludes duplicate %s mapping", kind => {
    const a=source(), b=source("2"); const duplicate=kind === "candidate" ? { ...b, candidateId: a.candidateId } : kind === "round+rider" ? { ...b, dispatchRoundId: a.dispatchRoundId, riderId: a.riderId } : { ...b, assignmentId: a.assignmentId };
    expect(extract([a,duplicate],options).counts.exclusionsByReason.duplicate_offer_mapping).toBe(2);
  });
  it("rejects missing/mismatched assignment", () => { exclude(source("1", { assignment:null }),"missing_assignment"); const s=source(); exclude({ ...s,assignment:{ ...s.assignment!, riderId:"wrong" } },"invalid_offer_mapping"); });
  it.each(["attemptedAt","assignedAt"])("rejects invalid %s", key => { const s=source(); exclude(key === "attemptedAt" ? { ...s, attemptedAt:d("bad") } : { ...s,assignment:{ ...s.assignment!,assignedAt:d("bad") } }, key === "attemptedAt" ? "invalid_attempted_at" : "invalid_assigned_at"); });
  it("uses half-open windows and deterministic earliest-group ordering", () => {
    const at=(id:string,stamp:string)=>{const s=source(id),t=d(stamp);return {...s,attemptedAt:t,assignment:{...s.assignment!,assignedAt:t,offerExpiresAt:new Date(t.getTime()+30000),acceptedAt:new Date(t.getTime()+1)}};};
    const a=at("z","2026-01-01T00:00:00Z"),b=at("b","2026-02-01T00:00:00Z"),c=at("a","2026-03-01T00:00:00Z"),outside=at("x","2026-04-01T00:00:00Z");
    const result=extract([c,outside,b,a],options);expect(result.rows.map(r=>r.split)).toEqual(["train","validation","test"]);expect(result.rows.map(r=>r.orderGroupKey)).toEqual(["order-group-000001","order-group-000002","order-group-000003"]);expect(result.counts.exclusionsByReason.outside_split_window).toBe(1);
    expect(extract([a,b,c,outside],options)).toEqual(result);
    const same={...outside,orderId:a.orderId,assignment:{...outside.assignment,orderId:a.orderId}};
    expect(extract([a,same],options).counts.exclusionsByReason.cross_split_order_group).toBe(2);
  });
  it("counts both selection policies without exporting them", () => { const r=extract([source(),source("2",{selectionPolicy:"ML_ASSISTED"})],options);expect(r.counts.rowsBySelectionPolicy).toEqual({DETERMINISTIC_FALLBACK:1,ML_ASSISTED:1});expect(r.rows[1]).not.toHaveProperty("selectionPolicy"); });
  it.each([-721,841,0.5,NaN])("rejects invalid timezone %s", timezoneOffsetMinutes => expect(()=>extract([],{ ...options,timezoneOffsetMinutes })).toThrow());
  it("rejects unordered split boundaries",()=>expect(()=>extract([],{ ...options,validationStart:options.trainStart })).toThrow());
});
