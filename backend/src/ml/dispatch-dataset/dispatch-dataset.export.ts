import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { extractDispatchDataset, validateDispatchDatasetOptions } from "./dispatch-dataset.extractor.js";
import { loadDispatchDataset, type DispatchDatasetDataSource } from "./dispatch-dataset.loader.js";
import { DISPATCH_DATASET_SCHEMA_VERSION, type DispatchDatasetOptions } from "./dispatch-dataset.types.js";

export interface DispatchExportOptions extends DispatchDatasetOptions {
  readonly generatedAt: Date; readonly gitCommit: string;
}
export function validateDispatchExportOptions(o: DispatchExportOptions): void {
  validateDispatchDatasetOptions(o);
  if (!(o.generatedAt instanceof Date) || !Number.isFinite(o.generatedAt.getTime()) || typeof o.gitCommit !== "string" || !o.gitCommit.trim()) throw new RangeError("Explicit generation timestamp and git commit required");
}
/** Prisma-backed export always declares REAL; tests inject fake records only. */
export async function createDispatchDatasetExport(source: DispatchDatasetDataSource, options: DispatchExportOptions) {
  validateDispatchExportOptions(options);
  const records = await loadDispatchDataset(source, { from: options.trainStart, until: options.testEnd });
  const result = extractDispatchDataset(records, options);
  const jsonl = result.rows.map(row => JSON.stringify(row) + "\n").join("");
  const manifest = {
    schemaVersion: DISPATCH_DATASET_SCHEMA_VERSION, dataProvenance: "REAL" as const,
    generatedAt: options.generatedAt.toISOString(), gitCommit: options.gitCommit,
    timezoneOffsetMinutes: options.timezoneOffsetMinutes, outcomeCutoff: options.outcomeCutoff.toISOString(),
    splits: { trainStart: options.trainStart.toISOString(), validationStart: options.validationStart.toISOString(), testStart: options.testStart.toISOString(), testEnd: options.testEnd.toISOString() },
    labelContract: { positive: "assignedAt <= acceptedAt < offerExpiresAt; consistent recorded acceptance",
      declineNegative: "assignedAt < declinedAt < offerExpiresAt; consistent decline without acceptance",
      timeoutNegative: "recorded TIMED_OUT without acceptance/decline; offerExpiresAt and processing timestamp mature by outcomeCutoff",
      immutableDeadlineRequired: true },
    featureContract: { rawFeatures: ["riderDistanceKm", "activeWorkload", "hourOfDay", "dayOfWeek"], predictionPoint: "DISPATCH_PRE_OFFER" },
    counts: result.counts,
    instrumentation: { requiredDispatchPolicyVersion: "deterministic-dispatch-v1", immutableDeadlineRequired: true,
      allowedSelectionPolicies: ["DETERMINISTIC_FALLBACK", "ML_ASSISTED"], sourceScope: "complete linked-offer chains for orders seeded in requested window" },
    jsonlSha256: createHash("sha256").update(jsonl, "utf8").digest("hex"),
  };
  return { jsonl, manifest };
}
export type DispatchDatasetExport = Awaited<ReturnType<typeof createDispatchDatasetExport>>;
export type DispatchDatasetManifest = DispatchDatasetExport["manifest"];
export interface DispatchExportWriter {
  open(path: string, flags: "wx"): Promise<{ writeFile(data: string, encoding: "utf8"): Promise<void>; close(): Promise<void> }>;
}
/** Exclusive writes; a failure may leave partial files. Retry in a fresh directory. */
export async function writeDispatchDatasetExport(artifact: DispatchDatasetExport, paths: { jsonlPath: string; manifestPath: string }, writer: DispatchExportWriter = { open }): Promise<void> {
  if (!paths.jsonlPath.trim() || !paths.manifestPath.trim() || resolve(paths.jsonlPath) === resolve(paths.manifestPath)) throw new RangeError("Distinct output files required");
  const data = await writer.open(paths.jsonlPath, "wx");
  try {
    const manifest = await writer.open(paths.manifestPath, "wx");
    try { await data.writeFile(artifact.jsonl, "utf8"); await manifest.writeFile(JSON.stringify(artifact.manifest, null, 2) + "\n", "utf8"); }
    finally { await manifest.close(); }
  } finally { await data.close(); }
}
