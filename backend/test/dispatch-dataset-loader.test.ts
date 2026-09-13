import { describe, expect, it, vi } from "vitest";
import { DISPATCH_DATASET_SELECT, loadDispatchDataset, type DispatchDatasetDataSource } from "../src/ml/dispatch-dataset/dispatch-dataset.loader.js";
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

function databaseRecord() { const s=source(); const { candidateId, riderDistanceKm, workloadAtDispatch, orderStatus, orderCancelledAt, ...rest }=s; return { ...rest, id:candidateId,riderDistanceToPharmacyKm:riderDistanceKm,workloadSignal:workloadAtDispatch,order:{status:orderStatus,cancelledAt:orderCancelledAt}, privateUnexpected:"SECRET" }; }
describe("dispatch read-only loader",()=>{
  it("queries an explicit window then complete offered chains with only the exact projection",async()=>{
    const record=databaseRecord(); const findMany=vi.fn().mockResolvedValue([record]);
    const result=await loadDispatchDataset({dispatchAttempt:{findMany}}, {from:options.trainStart,until:options.testEnd});
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0]).toEqual({where:{attemptedAt:{gte:options.trainStart,lt:options.testEnd},assignmentId:{not:null}},select:DISPATCH_DATASET_SELECT,orderBy:[{attemptedAt:"asc"},{id:"asc"}]});
    expect(findMany.mock.calls[1][0].where).toEqual({OR:[{orderId:{in:[record.orderId]},assignmentId:{not:null}},{assignmentId:{in:[record.assignmentId]}}]});
    expect(result).toEqual([source()]);expect(result[0]).not.toBe(record);expect(result[0].assignment).not.toBe(record.assignment);expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(Object.keys(DISPATCH_DATASET_SELECT).sort()).toEqual(["id","orderId","riderId","assignmentId","dispatchRoundId","status","attemptedAt","riderDistanceToPharmacyKm","workloadSignal","deterministicRank","dispatchPolicyVersion","selectionPolicy","workloadPenaltyKm","shortlistSize","searchRadiusKm","freshnessThresholdMs","order","assignment"].sort());
    expect(DISPATCH_DATASET_SELECT.order).toEqual({select:{status:true,cancelledAt:true}});
    expect(DISPATCH_DATASET_SELECT.assignment).toEqual({select:{id:true,orderId:true,riderId:true,assignedAt:true,offerExpiresAt:true,status:true,acceptedAt:true,declinedAt:true,timedOutAt:true,cancelledAt:true,reassignedAt:true}});
    for(const forbidden of ["customer","address","latitude","longitude","user","phone","email","prescription","items"]) expect(JSON.stringify(DISPATCH_DATASET_SELECT)).not.toContain(forbidden);
  });
  it("does not expand an empty range result",async()=>{const findMany=vi.fn().mockResolvedValue([]);expect(await loadDispatchDataset({dispatchAttempt:{findMany}},{from:options.trainStart,until:options.testEnd})).toEqual([]);expect(findMany).toHaveBeenCalledTimes(1);});
  it("validates before reading",async()=>{const findMany=vi.fn();await expect(loadDispatchDataset({dispatchAttempt:{findMany}},{from:options.testEnd,until:options.trainStart})).rejects.toThrow();expect(findMany).not.toHaveBeenCalled();});
});
