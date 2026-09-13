import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDispatchDatasetExport, validateDispatchExportOptions, writeDispatchDatasetExport } from "./dispatch-dataset.export.js";

function instant(value: string): Date {
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(date.getTime())
    || date.toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) throw new RangeError("Explicit valid UTC timestamp required");
  return date;
}
export function parseDispatchDatasetCliArgs(args: readonly string[]) {
  const { values } = parseArgs({ args: [...args], strict: true, allowPositionals: false, options: {
    "confirm-read-only-export": { type: "boolean" }, "output-directory": { type: "string" },
    "train-start": { type: "string" }, "validation-start": { type: "string" }, "test-start": { type: "string" },
    "test-end": { type: "string" }, "outcome-cutoff": { type: "string" }, "timezone-offset-minutes": { type: "string" },
    "git-commit": { type: "string" }, "generated-at": { type: "string" },
  } });
  if (!values["confirm-read-only-export"]) throw new RangeError("Explicit read-only confirmation required");
  const required = (key: keyof typeof values): string => { const value = values[key]; if (typeof value !== "string" || !value.trim()) throw new RangeError("Missing required argument"); return value; };
  const options = { trainStart: instant(required("train-start")), validationStart: instant(required("validation-start")), testStart: instant(required("test-start")),
    testEnd: instant(required("test-end")), outcomeCutoff: instant(required("outcome-cutoff")), timezoneOffsetMinutes: Number(required("timezone-offset-minutes")),
    generatedAt: instant(required("generated-at")), gitCommit: required("git-commit") };
  validateDispatchExportOptions(options);
  return { outputDirectory: required("output-directory"), options };
}
export async function runDispatchDatasetCli(args: readonly string[]): Promise<void> {
  const { options, outputDirectory } = parseDispatchDatasetCliArgs(args);
  // Never initialize a DB client on import or before all arguments validate.
  const { prisma } = await import("../../lib/prisma.js");
  try {
    const artifact = await createDispatchDatasetExport(prisma, options);
    const directory = resolve(outputDirectory);
    await mkdir(directory, { recursive: true });
    await writeDispatchDatasetExport(artifact, { jsonlPath: join(directory, "dispatch-dataset.jsonl"), manifestPath: join(directory, "dispatch-dataset.manifest.json") });
    console.log(JSON.stringify({ counts: artifact.manifest.counts, jsonlSha256: artifact.manifest.jsonlSha256 }));
  } finally { await prisma.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDispatchDatasetCli(process.argv.slice(2)).catch(() => {
    console.error("Dispatch export failed. Check arguments, authorized database access and unused output paths. Partial files may remain.");
    process.exitCode = 1;
  });
}
