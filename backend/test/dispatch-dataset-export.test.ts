import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDispatchDatasetExport, writeDispatchDatasetExport } from "../src/ml/dispatch-dataset/dispatch-dataset.export.js";
import { parseDispatchDatasetCliArgs } from "../src/ml/dispatch-dataset/dispatch-dataset.cli.js";
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

const exportOptions={...options,generatedAt:d("2026-04-03T00:00:00Z"),gitCommit:"explicit-test-commit"};
function db(records: DispatchDatasetSource[] = [source()]) { return {dispatchAttempt:{findMany:vi.fn().mockResolvedValue(records.map(s=>({id:s.candidateId,orderId:s.orderId,riderId:s.riderId,assignmentId:s.assignmentId,dispatchRoundId:s.dispatchRoundId,status:s.status,attemptedAt:s.attemptedAt,riderDistanceToPharmacyKm:s.riderDistanceKm,workloadSignal:s.workloadAtDispatch,deterministicRank:s.deterministicRank,dispatchPolicyVersion:s.dispatchPolicyVersion,selectionPolicy:s.selectionPolicy,workloadPenaltyKm:s.workloadPenaltyKm,shortlistSize:s.shortlistSize,searchRadiusKm:s.searchRadiusKm,freshnessThresholdMs:s.freshnessThresholdMs,order:{status:s.orderStatus,cancelledAt:s.orderCancelledAt},assignment:s.assignment})))}}; }
describe("dispatch export",()=>{
 it("writes deterministic private JSONL and complete REAL manifest",async()=>{
  const artifact=await createDispatchDatasetExport(db(),exportOptions);expect(await createDispatchDatasetExport(db(),exportOptions)).toEqual(artifact);
  expect(artifact.jsonl.endsWith("\n")).toBe(true);expect(artifact.jsonl.charCodeAt(0)).not.toBe(0xfeff);
  expect(artifact.manifest.jsonlSha256).toBe(createHash("sha256").update(artifact.jsonl,"utf8").digest("hex"));
  expect(artifact.manifest).toMatchObject({schemaVersion:"dispatch-acceptance-v1",dataProvenance:"REAL",generatedAt:"2026-04-03T00:00:00.000Z",gitCommit:"explicit-test-commit",timezoneOffsetMinutes:330,outcomeCutoff:options.outcomeCutoff.toISOString(),splits:{trainStart:options.trainStart.toISOString(),validationStart:options.validationStart.toISOString(),testStart:options.testStart.toISOString(),testEnd:options.testEnd.toISOString()},labelContract:{immutableDeadlineRequired:true},counts:{sourceCandidates:1,offeredCandidates:1,exportedRows:1,acceptedRows:1,declinedRows:0,timedOutRows:0,train:1,validation:0,test:0,uniqueOrderGroups:1,rowsBySelectionPolicy:{DETERMINISTIC_FALLBACK:1,ML_ASSISTED:0}}});
  expect(Object.keys(JSON.parse(artifact.jsonl)).sort()).toEqual(["schemaVersion","rowKey","orderGroupKey","split","predictionPoint","riderDistanceKm","activeWorkload","hourOfDay","dayOfWeek","accepted"].sort());
  expect(JSON.stringify(artifact)).not.toContain("private-");expect(artifact.jsonl).not.toContain("2026-");
 });
 it("accounts for classes, policies and exclusions",async()=>{
  const a=source("2"),b=source("3");const artifact=await createDispatchDatasetExport(db([source(),{...a,status:"DECLINED",selectionPolicy:"ML_ASSISTED",assignment:{...a.assignment!,status:"DECLINED",acceptedAt:null,declinedAt:d("2026-01-04T20:00:15Z")}}, {...b,status:"TIMED_OUT",assignment:{...b.assignment!,status:"TIMED_OUT",acceptedAt:null,timedOutAt:d("2026-01-04T20:00:31Z")}},source("4",{workloadAtDispatch:-1})]),exportOptions);
  expect(artifact.manifest.counts).toMatchObject({sourceCandidates:4,exportedRows:3,acceptedRows:1,declinedRows:1,timedOutRows:1,uniqueOrderGroups:3,rowsBySelectionPolicy:{DETERMINISTIC_FALLBACK:2,ML_ASSISTED:1},exclusionsByReason:{invalid_workload:1}});
 });
 it("produces empty data and a zero-row manifest",async()=>{const a=await createDispatchDatasetExport(db([]),exportOptions);expect(a.jsonl).toBe("");expect(a.manifest.counts.exportedRows).toBe(0);expect(a.manifest.jsonlSha256).toBe(createHash("sha256").update("").digest("hex"));});
 it.each([{generatedAt:d("bad")},{gitCommit:""},{timezoneOffsetMinutes:999}])("rejects metadata before reads %j",async override=>{const store=db();await expect(createDispatchDatasetExport(store,{...exportOptions,...override})).rejects.toThrow();expect(store.dispatchAttempt.findMany).not.toHaveBeenCalled();});
 it("opens both destinations exclusively and writes LF manifest",async()=>{const a=await createDispatchDatasetExport(db(),exportOptions);const files=new Map<string,{writeFile:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}>();const open=vi.fn(async(path:string,flags:string)=>{expect(flags).toBe("wx");if(files.has(path))throw new Error("exists");const f={writeFile:vi.fn().mockResolvedValue(undefined),close:vi.fn().mockResolvedValue(undefined)};files.set(path,f);return f;});const paths={jsonlPath:"data.jsonl",manifestPath:"manifest.json"};await writeDispatchDatasetExport(a,paths,{open});expect(files.get("data.jsonl")!.writeFile).toHaveBeenCalledWith(a.jsonl,"utf8");expect(files.get("manifest.json")!.writeFile).toHaveBeenCalledWith(JSON.stringify(a.manifest,null,2)+"\n","utf8");await expect(writeDispatchDatasetExport(a,paths,{open})).rejects.toThrow("exists");});
 it("closes first file if second destination exists",async()=>{const a=await createDispatchDatasetExport(db(),exportOptions);const close=vi.fn();const open=vi.fn().mockResolvedValueOnce({writeFile:vi.fn(),close}).mockRejectedValueOnce(new Error("exists"));await expect(writeDispatchDatasetExport(a,{jsonlPath:"a",manifestPath:"b"},{open})).rejects.toThrow();expect(close).toHaveBeenCalled();});
 it("requires explicit CLI confirmation and timestamps",()=>{
  const args=["--confirm-read-only-export","--output-directory","unused","--train-start","2026-01-01T00:00:00Z","--validation-start","2026-02-01T00:00:00Z","--test-start","2026-03-01T00:00:00Z","--test-end","2026-04-01T00:00:00Z","--outcome-cutoff","2026-04-02T00:00:00Z","--timezone-offset-minutes","330","--git-commit","explicit-test-commit","--generated-at","2026-04-03T00:00:00Z"];
  expect(parseDispatchDatasetCliArgs(args).options).toEqual(exportOptions);expect(()=>parseDispatchDatasetCliArgs(args.slice(1))).toThrow();expect(()=>parseDispatchDatasetCliArgs(args.slice(0,-2))).toThrow();expect(()=>parseDispatchDatasetCliArgs([...args,"--unknown"])).toThrow();
 });
});
