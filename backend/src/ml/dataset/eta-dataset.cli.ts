import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEtaDatasetExport, validateEtaExportOptions, writeEtaDatasetExport, type EtaDatasetExportOptions } from "./eta-dataset.export.js";

export interface EtaDatasetCliOptions {
  readonly outputDirectory: string;
  readonly exportOptions: EtaDatasetExportOptions;
}

/** Strict UTC ISO instants avoid locale parsing and silently normalized invalid calendar dates. */
function utcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new RangeError("Dates must be explicit UTC ISO instants");
  }
  const date = new Date(value);
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw new RangeError("Invalid UTC date");
  return date;
}

export function parseEtaDatasetCliArgs(args: readonly string[], generatedAt: Date): EtaDatasetCliOptions {
  const { values } = parseArgs({ args: [...args], strict: true, allowPositionals: false, options: {
    "confirm-read-only-export": { type: "boolean" },
    "output-directory": { type: "string" }, "placed-at-from": { type: "string" },
    "validation-start": { type: "string" }, "test-start": { type: "string" },
    "test-end": { type: "string" }, "outcome-cutoff": { type: "string" },
    "fallback-speed-kmh": { type: "string" }, "timezone-offset-minutes": { type: "string" },
    "git-commit": { type: "string" },
  } });
  if (!values["confirm-read-only-export"]) throw new RangeError("Explicit --confirm-read-only-export is required");
  function required(key: keyof typeof values): string {
    const value = values[key];
    if (typeof value !== "string" || !value.trim()) throw new RangeError(`Missing required --${key}`);
    return value;
  }
  const outputDirectory = required("output-directory");
  const trainStart = utcDate(required("placed-at-from"));
  const validationStart = utcDate(required("validation-start"));
  const testStart = utcDate(required("test-start"));
  const testEnd = utcDate(required("test-end"));
  const outcomeCutoff = utcDate(required("outcome-cutoff"));
  const exportOptions: EtaDatasetExportOptions = {
    dataProvenance: "REAL", // This CLI reads Prisma history; synthetic generation is separate.
    source: { placedAtFrom: trainStart, placedAtUntil: testEnd, outcomeCutoff },
    transformer: { trainStart, validationStart, testStart, testEnd, outcomeCutoff,
      fallbackSpeedKmh: Number(required("fallback-speed-kmh")),
      timezoneOffsetMinutes: Number(required("timezone-offset-minutes")) },
    generatedAt, gitCommit: required("git-commit"),
  };
  validateEtaExportOptions(exportOptions);
  return { outputDirectory, exportOptions };
}

export async function runEtaDatasetCli(args: readonly string[]): Promise<void> {
  const { outputDirectory, exportOptions } = parseEtaDatasetCliArgs(args, new Date());
  // Import only after argument validation; importing the CLI itself never initializes Prisma.
  const { prisma } = await import("../../lib/prisma.js");
  try {
    const artifact = await createEtaDatasetExport(prisma, exportOptions);
    const directory = resolve(outputDirectory);
    await mkdir(directory, { recursive: true });
    const paths = { jsonlPath: join(directory, "eta-dataset.jsonl"), manifestPath: join(directory, "eta-dataset.manifest.json") };
    await writeEtaDatasetExport(artifact, paths);
    console.log(JSON.stringify({ counts: artifact.manifest.counts, ...paths }));
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runEtaDatasetCli(process.argv.slice(2)).catch(() => {
    // Database errors may contain connection details; never print raw exceptions or records.
    console.error("ETA export failed. Check required arguments, database access and unused output paths. Partial files may remain.");
    process.exitCode = 1;
  });
}
