import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { EtaDataProvenance } from "../eta-model.types.js";
import { extractEtaDataset } from "./eta-dataset.extractor.js";
import { loadEtaDataset, validateEtaLoadOptions, type EtaDatasetDataSource, type EtaDatasetLoadOptions } from "./eta-dataset.loader.js";
import { ETA_DATASET_SCHEMA_VERSION, type EtaDatasetOptions, type EtaDatasetExclusionReason } from "./eta-dataset.types.js";

export interface EtaDatasetExportOptions {
  readonly dataProvenance: EtaDataProvenance;
  readonly source: EtaDatasetLoadOptions;
  readonly transformer: EtaDatasetOptions;
  readonly generatedAt: Date;
  readonly gitCommit: string;
}

export interface EtaDatasetManifest {
  readonly dataProvenance: EtaDataProvenance;
  readonly schemaVersion: typeof ETA_DATASET_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly gitCommit: string;
  readonly source: { readonly placedAtFrom: string; readonly placedAtUntil: string; readonly outcomeCutoff: string };
  readonly splits: { readonly trainStart: string; readonly validationStart: string; readonly testStart: string; readonly testEnd: string };
  readonly baseline: { readonly source: "distance_speed_baseline"; readonly fallbackSpeedKmh: number };
  readonly timezoneOffsetMinutes: number;
  readonly counts: {
    readonly sourceRecords: number;
    readonly exportedRows: number;
    readonly excludedRows: number;
    readonly exclusionsByReason: Readonly<Record<EtaDatasetExclusionReason, number>>;
  };
  readonly jsonlSha256: string;
  readonly rowCount: number;
}

export interface EtaDatasetExport {
  readonly jsonl: string;
  readonly manifest: EtaDatasetManifest;
}

/** Validate every dataset-defining parameter before the first database read. */
export function validateEtaExportOptions(options: EtaDatasetExportOptions): void {
  if (!["REAL", "SYNTHETIC", "MIXED"].includes(options.dataProvenance)) {
    throw new RangeError("Explicit REAL, SYNTHETIC or MIXED provenance is required");
  }
  validateEtaLoadOptions(options.source);
  extractEtaDataset([], options.transformer);
  if (!Number.isFinite(options.transformer.fallbackSpeedKmh) || options.transformer.fallbackSpeedKmh <= 0) {
    throw new RangeError("A finite positive fallback speed is required");
  }
  if (!(options.generatedAt instanceof Date) || !Number.isFinite(options.generatedAt.getTime())
    || typeof options.gitCommit !== "string" || options.gitCommit.trim().length === 0) {
    throw new RangeError("Valid generatedAt and non-empty gitCommit metadata are required");
  }
  if (options.source.placedAtFrom.getTime() !== options.transformer.trainStart.getTime()
    || options.source.placedAtUntil.getTime() !== options.transformer.testEnd.getTime()
    || options.source.outcomeCutoff.getTime() !== options.transformer.outcomeCutoff.getTime()) {
    throw new RangeError("Source range and cutoff must match transformer boundaries");
  }
}

export async function createEtaDatasetExport(
  dataSource: EtaDatasetDataSource, options: EtaDatasetExportOptions,
): Promise<EtaDatasetExport> {
  validateEtaExportOptions(options);
  const records = await loadEtaDataset(dataSource, options.source);
  const result = extractEtaDataset(records, options.transformer);
  const jsonl = result.rows.map(row => JSON.stringify(row) + "\n").join("");
  const manifest: EtaDatasetManifest = {
    dataProvenance: options.dataProvenance,
    schemaVersion: ETA_DATASET_SCHEMA_VERSION,
    generatedAt: options.generatedAt.toISOString(), gitCommit: options.gitCommit,
    source: {
      placedAtFrom: options.source.placedAtFrom.toISOString(),
      placedAtUntil: options.source.placedAtUntil.toISOString(),
      outcomeCutoff: options.source.outcomeCutoff.toISOString(),
    },
    splits: {
      trainStart: options.transformer.trainStart.toISOString(),
      validationStart: options.transformer.validationStart.toISOString(),
      testStart: options.transformer.testStart.toISOString(), testEnd: options.transformer.testEnd.toISOString(),
    },
    baseline: { source: "distance_speed_baseline", fallbackSpeedKmh: options.transformer.fallbackSpeedKmh },
    timezoneOffsetMinutes: options.transformer.timezoneOffsetMinutes,
    counts: { sourceRecords: records.length, exportedRows: result.rows.length,
      excludedRows: result.exclusions.totalExcluded, exclusionsByReason: result.exclusions.byReason },
    jsonlSha256: createHash("sha256").update(jsonl, "utf8").digest("hex"), rowCount: result.rows.length,
  };
  return { jsonl, manifest };
}

export interface EtaExportWriter {
  open(path: string, flags: "wx"): Promise<{
    writeFile(data: string, encoding: "utf8"): Promise<void>;
    close(): Promise<void>;
  }>;
}

/** Always exclusive: existing destinations are never overwritten. Parent directories must exist.
 * This is not a two-file transaction; failure can leave a partial export. Use a fresh directory to retry.
 */
export async function writeEtaDatasetExport(
  artifact: EtaDatasetExport, paths: { readonly jsonlPath: string; readonly manifestPath: string },
  writer: EtaExportWriter = { open },
): Promise<void> {
  if (!paths.jsonlPath.trim() || !paths.manifestPath.trim()
    || resolve(paths.jsonlPath) === resolve(paths.manifestPath)) {
    throw new RangeError("Two distinct non-empty output paths are required");
  }
  const jsonlFile = await writer.open(paths.jsonlPath, "wx");
  try {
    const manifestFile = await writer.open(paths.manifestPath, "wx");
    try {
      await jsonlFile.writeFile(artifact.jsonl, "utf8");
      await manifestFile.writeFile(JSON.stringify(artifact.manifest, null, 2) + "\n", "utf8");
    } finally { await manifestFile.close(); }
  } finally { await jsonlFile.close(); }
}
