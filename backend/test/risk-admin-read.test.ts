import { describe, expect, it } from "vitest";
import { OperationalRiskService } from "../src/risk/risk.service.js";
import { RiskTestStore, detection, orderId, actorId, later } from "./risk-test-store.js";

describe("isolated admin risk read contract", () => {
  async function setup() {
    const store = new RiskTestStore(); const service = new OperationalRiskService(store.repository());
    const record = await service.recordDetection(detection());
    return { store, service, record, persisted: store.rows.get(record.id)! };
  }
  it("strict reads still reject malformed evidence; admin reads redact without writes", async () => {
    const { store, service, record, persisted } = await setup(); persisted.evidence = { phone: "PRIVATE_SENTINEL", note: "PRIVATE_SENTINEL" };
    const snapshot = structuredClone([...store.rows.values()]);
    await expect(service.getById(record.id)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await expect(service.listOpen()).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await expect(service.listByOrder(orderId)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    const admin = await service.getAdminById(record.id);
    expect(admin).toMatchObject({ id: record.id, status: "OPEN", evidence: { status: "unavailable", reason: "invalid_evidence" } });
    expect(JSON.stringify(admin)).not.toContain("PRIVATE_SENTINEL");
    const list = await service.listAdminOpen(); expect(list).toHaveLength(1); expect(list[0]).not.toHaveProperty("evidence");
    expect(store.lastQuery?.select).not.toHaveProperty("evidence");
    expect([...store.rows.values()]).toEqual(snapshot); expect(store.creates).toBe(1); expect(store.updates).toBe(0);
  });
  it("known valid evidence stays strict, detached and available to admin detail", async () => {
    const { service, record } = await setup(); expect(await service.getById(record.id)).toEqual(record);
    const admin = (await service.getAdminById(record.id))!;
    expect(admin.evidence).toEqual({ status: "available", evidence: record.evidence });
    expect(admin).not.toHaveProperty("entityId"); expect(admin).not.toHaveProperty("orderId"); expect(admin).not.toHaveProperty("occurrenceKey");
    admin.detectedAt.setTime(0); Object.assign(admin.evidence, { private: true });
    expect((await service.getAdminById(record.id))?.detectedAt).toEqual(record.detectedAt);
    expect((await service.getAdminById(record.id))?.evidence).not.toHaveProperty("private");
  });
  it("unknown historical rules stay visible in admin queue/detail, never in strict reads or creation", async () => {
    const { service, record, persisted, store } = await setup(); persisted.ruleCode = "RETIRED_RULE"; persisted.evidence = { note: "UNKNOWN_SECRET" };
    expect(await service.getAdminById(record.id)).toMatchObject({ ruleCode: "RETIRED_RULE", evidence: { status: "unavailable", reason: "unknown_rule" } });
    const list = await service.listAdminOpen(); expect(list).toHaveLength(1); expect(JSON.stringify(list)).not.toContain("UNKNOWN_SECRET"); expect(list[0]).not.toHaveProperty("evidence");
    await expect(service.getById(record.id)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    await expect(service.recordDetection(detection({ ruleCode: "RETIRED_RULE" }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(store.creates).toBe(1); expect(store.updates).toBe(0);
  });
  it("unknown evidence versions redact rather than relax the schema", async () => {
    const { service, record, persisted } = await setup(); persisted.evidenceSchemaVersion = 2;
    expect((await service.getAdminById(record.id))?.evidence).toEqual({ status: "unavailable", reason: "invalid_evidence" });
  });
  it.each([{ severity: "PRIVATE_SENTINEL" }, { ruleCode: "raw narrative" }, { revision: -1 }, { detectedAt: new Date(NaN) }, { status: "UNKNOWN" }, { resolutionReason: "PRIVATE_SENTINEL" }])("core corruption fails safely: %j", async corruption => {
    const { service, record, persisted } = await setup(); Object.assign(persisted, corruption);
    await expect(service.getAdminById(record.id)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    // Unknown statuses are excluded by the queue's authoritative filter.
    if (!("status" in corruption)) await expect(service.listAdminOpen()).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
  });
  it("strict lifecycle still rejects malformed evidence without writes", async () => {
    const { service, store, record, persisted } = await setup(); persisted.evidence = { phone: "PRIVATE_SENTINEL" };
    await expect(service.acknowledgeAssessment({ id: record.id, expectedRevision: 0, at: later, actorId })).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(store.updates).toBe(0);
  });
  it("admin missing records return null", async () => {
    const { service } = await setup(); expect(await service.getAdminById(actorId)).toBeNull();
  });
});
