import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEtaDatasetExport, writeEtaDatasetExport, type EtaDatasetExportOptions } from "../src/ml/dataset/eta-dataset.export.js";
import { parseEtaDatasetCliArgs } from "../src/ml/dataset/eta-dataset.cli.js";

const trainStart = new Date("2026-01-01T00:00:00Z");
const validationStart = new Date("2026-02-01T00:00:00Z");
const testStart = new Date("2026-03-01T00:00:00Z");
const testEnd = new Date("2026-04-01T00:00:00Z");
const outcomeCutoff = new Date("2026-04-02T00:00:00Z");
const options: EtaDatasetExportOptions = {
  source: { placedAtFrom: trainStart, placedAtUntil: testEnd, outcomeCutoff },
  transformer: { trainStart, validationStart, testStart, testEnd, outcomeCutoff, fallbackSpeedKmh: 20, timezoneOffsetMinutes: 330 },
  generatedAt: new Date("2026-04-03T00:00:00Z"), gitCommit: "fixed-test-commit",
};
function raw(id = "private-order", distance = 5) {
  const deliveredAt = new Date("2026-01-01T00:30:30Z");
  return { id, fulfillmentMethod: "DELIVERY", status: "DELIVERED", placedAt: trainStart, completedAt: deliveredAt,
    deliveryDistanceKm: distance, quotedEtaMinutes: 20, _count: { items: 2 },
    deliveryAssignments: [{ status: "DELIVERED", deliveredAt }],
    customerId: "private-customer", phone: "private-phone", latitude: 123, prescription: "private-file" };
}
function fake(records = [raw()]) { return { order: { findMany: vi.fn().mockResolvedValue(records) } }; }

describe("ETA JSONL and manifest", () => {
  it("serializes one allowlisted object with a final newline, no BOM, and no IDs or exact row timestamps", async () => {
    const artifact = await createEtaDatasetExport(fake(), options);
    expect(artifact.jsonl.endsWith("\n")).toBe(true);
    expect(artifact.jsonl.split("\n")).toHaveLength(2);
    expect(artifact.jsonl.charCodeAt(0)).not.toBe(0xfeff);
    expect(Object.keys(JSON.parse(artifact.jsonl))).toEqual([
      "schemaVersion", "rowKey", "predictionPoint", "split", "distanceKm", "itemCount", "hourOfDay", "dayOfWeek",
      "quotedEtaMinutes", "distanceBaselineMinutes", "actualDurationMinutes",
    ]);
    for (const forbidden of ["private-", "orderId", "customerId", "riderId", "pharmacyId", "latitude", "longitude", "address", "phone", "prescription", "placedAt", "deliveredAt", "completedAt"]) expect(artifact.jsonl).not.toContain(forbidden);
    for (const forbidden of ["private-", "orderId", "customerId", "riderId", "pharmacyId", "latitude", "longitude", "address", "phone", "prescription"]) expect(JSON.stringify(artifact.manifest)).not.toContain(forbidden);
  });
  it("preserves deterministic sorting, bytes and SHA-256 across source ordering", async () => {
    const first = await createEtaDatasetExport(fake([raw("z", 9), raw("a", 3)]), options);
    const second = await createEtaDatasetExport(fake([raw("a", 3), raw("z", 9)]), options);
    expect(first).toEqual(second);
    expect(Buffer.from(first.jsonl, "utf8")).toEqual(Buffer.from(second.jsonl, "utf8"));
    expect(first.jsonl.trimEnd().split("\n").map(line => JSON.parse(line).distanceKm)).toEqual([3, 9]);
    expect(first.manifest.jsonlSha256).toBe(createHash("sha256").update(Buffer.from(first.jsonl, "utf8")).digest("hex"));
  });
  it("emits exact injected metadata, counts, source windows and baseline configuration", async () => {
    const artifact = await createEtaDatasetExport(fake([raw("good"), { ...raw("bad"), status: "CANCELLED" }]), options);
    expect(artifact.manifest).toMatchObject({
      schemaVersion: "eta-checkout-v1", generatedAt: "2026-04-03T00:00:00.000Z", gitCommit: "fixed-test-commit",
      source: { placedAtFrom: trainStart.toISOString(), placedAtUntil: testEnd.toISOString(), outcomeCutoff: outcomeCutoff.toISOString() },
      splits: { trainStart: trainStart.toISOString(), validationStart: validationStart.toISOString(), testStart: testStart.toISOString(), testEnd: testEnd.toISOString() },
      baseline: { source: "distance_speed_baseline", fallbackSpeedKmh: 20 }, timezoneOffsetMinutes: 330,
      counts: { sourceRecords: 2, exportedRows: 1, excludedRows: 1, exclusionsByReason: { not_delivered: 1 } }, rowCount: 1,
    });
    expect(Object.values(artifact.manifest.counts.exclusionsByReason).reduce((a, b) => a + b, 0)).toBe(1);
  });
  it("exports empty JSONL with a manifest for both empty and all-excluded sources", async () => {
    for (const records of [[], [{ ...raw(), status: "CANCELLED" }]]) {
      const artifact = await createEtaDatasetExport(fake(records), options);
      expect(artifact.jsonl).toBe("");
      expect(artifact.manifest.rowCount).toBe(0);
      expect(artifact.manifest.counts.excludedRows).toBe(records.length);
      expect(artifact.manifest.jsonlSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
  });
  it.each<Partial<EtaDatasetExportOptions>>([
    { generatedAt: new Date(NaN) }, { gitCommit: " " },
    { transformer: { ...options.transformer, fallbackSpeedKmh: 0 } },
    { transformer: { ...options.transformer, timezoneOffsetMinutes: 999 } },
    { transformer: { ...options.transformer, trainStart: validationStart } },
    { source: { ...options.source, outcomeCutoff: testEnd } },
  ])("rejects invalid metadata/configuration before DB access: %j", async overrides => {
    const dataSource = fake();
    await expect(createEtaDatasetExport(dataSource, { ...options, ...overrides })).rejects.toThrow(RangeError);
    expect(dataSource.order.findMany).not.toHaveBeenCalled();
  });
  it("writes exact UTF-8 bytes and rejects existing JSONL without overwriting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eta-export-test-"));
    try {
      const paths = { jsonlPath: join(directory, "rows.jsonl"), manifestPath: join(directory, "manifest.json") };
      const artifact = await createEtaDatasetExport(fake(), options);
      await writeEtaDatasetExport(artifact, paths);
      expect(await readFile(paths.jsonlPath)).toEqual(Buffer.from(artifact.jsonl, "utf8"));
      expect(JSON.parse(await readFile(paths.manifestPath, "utf8"))).toEqual(artifact.manifest);
      await expect(writeEtaDatasetExport(artifact, paths)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(paths.jsonlPath, "utf8")).toBe(artifact.jsonl);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("protects an existing manifest even when the JSONL path is new", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eta-export-test-"));
    try {
      const paths = { jsonlPath: join(directory, "rows.jsonl"), manifestPath: join(directory, "manifest.json") };
      await writeFile(paths.manifestPath, "keep", "utf8");
      await expect(writeEtaDatasetExport(await createEtaDatasetExport(fake(), options), paths)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(paths.manifestPath, "utf8")).toBe("keep");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("supports an injected exclusive writer and closes handles", async () => {
    const handle = () => ({ writeFile: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) });
    const jsonl = handle(), manifest = handle();
    const writer = { open: vi.fn().mockResolvedValueOnce(jsonl).mockResolvedValueOnce(manifest) };
    const artifact = await createEtaDatasetExport(fake(), options);
    await writeEtaDatasetExport(artifact, { jsonlPath: "rows.jsonl", manifestPath: "manifest.json" }, writer);
    expect(writer.open).toHaveBeenNthCalledWith(1, "rows.jsonl", "wx");
    expect(writer.open).toHaveBeenNthCalledWith(2, "manifest.json", "wx");
    expect(jsonl.writeFile).toHaveBeenCalledWith(artifact.jsonl, "utf8");
    expect(jsonl.close).toHaveBeenCalledOnce(); expect(manifest.close).toHaveBeenCalledOnce();
  });
  it("rejects identical or empty paths before opening files", async () => {
    const writer = { open: vi.fn() };
    const artifact = await createEtaDatasetExport(fake(), options);
    for (const paths of [{ jsonlPath: "same", manifestPath: "same" }, { jsonlPath: "", manifestPath: "other" }]) {
      await expect(writeEtaDatasetExport(artifact, paths, writer)).rejects.toThrow(RangeError);
    }
    expect(writer.open).not.toHaveBeenCalled();
  });
});

describe("ETA CLI parser without database or subprocess", () => {
  const flags: Record<string, string> = {
    "output-directory": "exports", "placed-at-from": trainStart.toISOString(), "validation-start": validationStart.toISOString(),
    "test-start": testStart.toISOString(), "test-end": testEnd.toISOString(), "outcome-cutoff": outcomeCutoff.toISOString(),
    "fallback-speed-kmh": "20", "timezone-offset-minutes": "330", "git-commit": "fixed-test-commit",
  };
  const args = (values = flags) => ["--confirm-read-only-export", ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value])];
  it("parses explicit dataset configuration and injected generatedAt", () => {
    expect(parseEtaDatasetCliArgs(args(), options.generatedAt)).toEqual({ outputDirectory: "exports", exportOptions: options });
  });
  it.each(Object.keys(flags))("rejects missing --%s", key => {
    const values = { ...flags }; delete values[key];
    expect(() => parseEtaDatasetCliArgs(args(values), options.generatedAt)).toThrow();
  });
  it.each([
    ["placed-at-from", "not-a-date"], ["placed-at-from", "2026-02-30T00:00:00Z"],
    ["placed-at-from", "2026-01-01"], ["fallback-speed-kmh", "0"], ["fallback-speed-kmh", "-1"],
    ["fallback-speed-kmh", "Infinity"], ["timezone-offset-minutes", "841"], ["timezone-offset-minutes", "1.5"],
    ["test-start", trainStart.toISOString()], ["output-directory", " "],
  ])("rejects invalid --%s=%s", (key, value) => {
    expect(() => parseEtaDatasetCliArgs(args({ ...flags, [key]: value }), options.generatedAt)).toThrow();
  });
  it("requires explicit read-only confirmation", () => {
    expect(() => parseEtaDatasetCliArgs(args().slice(1), options.generatedAt)).toThrow(/confirm-read-only-export/);
  });
});
