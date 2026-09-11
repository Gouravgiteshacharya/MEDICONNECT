import assert from "node:assert/strict";
import { InventoryStatus } from "../generated/prisma/client.js";
import { describe, test } from "vitest";
import {
  composeIntelligenceModule,
  createPharmacyDiscoveryAdapter,
  createTrustedAssistantContext,
  createUnavailableIntelligenceDependencies,
  type PharmacyDiscoveryDependencies,
} from "../src/modules/intelligence-experience/index.js";
import { ApiError } from "../src/utils/ApiError.js";

const userId = "trusted-customer";
const context = createTrustedAssistantContext({ userId, roles: ["CUSTOMER"] }, "request-1");
const medicineId = "11111111-1111-4111-8111-111111111111";
const pharmacyId = "22222222-2222-4222-8222-222222222222";
const updatedAt = new Date("2026-09-10T08:30:00.000Z");

function catalogueMedicine(overrides: Record<string, unknown> = {}) {
  return {
    id: medicineId,
    name: "Crocin",
    brandName: "Crocin Brand",
    genericName: "Paracetamol",
    manufacturer: "Example Labs",
    description: null,
    requiresPrescription: false,
    ...overrides,
  };
}

function address(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    label: "Home",
    addressLine1: "12 Main Road",
    addressLine2: null,
    landmark: null,
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    latitude: 12.9716,
    longitude: 77.5946,
    isDefault: true,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

function availability(overrides: Record<string, unknown> = {}) {
  return {
    medicine: {
      id: medicineId,
      name: "Crocin",
      brandName: "Crocin Brand",
      genericName: "Paracetamol",
      manufacturer: "Example Labs",
      requiresPrescription: false,
    },
    availability: [{
      pharmacy: {
        id: pharmacyId,
        name: "Community Pharmacy",
        phone: "9999999999",
        addressLine1: "1 Pharmacy Street",
        addressLine2: null,
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560002",
        latitude: 12.98,
        longitude: 77.6,
      },
      quantity: 7,
      sellingPrice: "49.50",
      availability: InventoryStatus.AVAILABLE,
      lastUpdated: updatedAt,
      freshness: "FRESH" as const,
      distanceKm: 1.234,
    }],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    search: { latitude: 12.9716, longitude: 77.5946, radiusKm: 5 },
    ...overrides,
  };
}

function fakes(overrides: Partial<PharmacyDiscoveryDependencies> = {}): PharmacyDiscoveryDependencies {
  return {
    listAddresses: async () => [address()],
    searchMedicines: async () => ({
      medicines: [catalogueMedicine()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    getAvailability: async () => availability(),
    ...overrides,
  };
}

describe("pharmacy discovery adapter", () => {
  test("trims a named query, uses trusted identity and default address, and applies bounded defaults", async () => {
    let receivedUserId = "";
    let searchInput: unknown;
    let availabilityInput: unknown;
    let receivedMedicineId = "";
    const adapter = createPharmacyDiscoveryAdapter(fakes({
      listAddresses: async (received) => { receivedUserId = received; return [address()]; },
      searchMedicines: async (input) => { searchInput = input; return {
        medicines: [catalogueMedicine()], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }; },
      getAvailability: async (receivedId, input) => {
        receivedMedicineId = receivedId; availabilityInput = input; return availability();
      },
    }));

    const result = await adapter.discover({ discoveryType: "medicine", medicineName: "  Crocin  " }, context);
    assert.equal(result.status, "success");
    assert.equal(receivedUserId, userId);
    assert.deepEqual(searchInput, { q: "Crocin", page: 1, pageSize: 20 });
    assert.equal(receivedMedicineId, medicineId);
    assert.deepEqual(availabilityInput, { latitude: 12.9716, longitude: 77.5946, radiusKm: 5, page: 1, pageSize: 20 });
  });

  test("maps only customer-safe availability data and preserves operational values", async () => {
    const result = await createPharmacyDiscoveryAdapter(fakes()).discover(
      { discoveryType: "medicine", medicineName: "Crocin" }, context,
    );
    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(result.data, {
      medicine: { name: "Crocin", brandName: "Crocin Brand", genericName: "Paracetamol", requiresPrescription: false },
      pharmacies: [{
        name: "Community Pharmacy",
        address: { addressLine1: "1 Pharmacy Street", addressLine2: null, city: "Bengaluru", state: "Karnataka", postalCode: "560002" },
        availability: "AVAILABLE",
        quantity: 7,
        sellingPrice: "49.50",
        distanceKm: 1.234,
        inventory: { freshness: "FRESH", lastUpdated: updatedAt.toISOString() },
      }],
      radiusKm: 5,
    });
    const serialized = JSON.stringify(result.data);
    for (const leaked of [medicineId, pharmacyId, "updatedByUserId", "licenseNumber", "latitude", "longitude"]) {
      assert.equal(serialized.includes(leaked), false, leaked);
    }
  });

  test("requires a named medicine without calling dependencies", async () => {
    let calls = 0;
    const result = await createPharmacyDiscoveryAdapter(fakes({ listAddresses: async () => { calls += 1; return []; } }))
      .discover({ discoveryType: "medicine", medicineName: "  " }, context);
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_request");
    assert.equal(calls, 0);
  });

  test("requires a default address with coordinates", async () => {
    for (const addresses of [[], [address({ isDefault: false })], [address({ latitude: null })], [address({ longitude: null })]]) {
      const result = await createPharmacyDiscoveryAdapter(fakes({ listAddresses: async () => addresses }))
        .discover({ discoveryType: "medicine", medicineName: "Crocin" }, context);
      assert.equal(result.status, "error");
      if (result.status === "error") assert.equal(result.code, "invalid_request");
    }
  });

  test("accepts an exact brand match but rejects substring-only and missing matches", async () => {
    const brandResult = await createPharmacyDiscoveryAdapter(fakes({
      searchMedicines: async () => ({ medicines: [catalogueMedicine({ name: "Paracetamol 500", brandName: "Crocin" })], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
    })).discover({ discoveryType: "medicine", medicineName: "crocin" }, context);
    assert.equal(brandResult.status, "success");

    for (const medicines of [[catalogueMedicine({ name: "Crocin 500" })], []]) {
      const result = await createPharmacyDiscoveryAdapter(fakes({
        searchMedicines: async () => ({ medicines, pagination: { page: 1, pageSize: 20, total: medicines.length, totalPages: medicines.length } }),
      })).discover({ discoveryType: "medicine", medicineName: "Crocin" }, context);
      assert.equal(result.status, "error");
      if (result.status === "error") assert.equal(result.code, "not_found");
    }
  });

  test("does not choose arbitrarily when distinct medicines match exactly", async () => {
    let availabilityCalls = 0;
    const result = await createPharmacyDiscoveryAdapter(fakes({
      searchMedicines: async () => ({
        medicines: [catalogueMedicine(), catalogueMedicine({ id: "44444444-4444-4444-8444-444444444444" })],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      }),
      getAvailability: async () => { availabilityCalls += 1; return availability(); },
    })).discover({ discoveryType: "medicine", medicineName: "Crocin" }, context);
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_request");
    assert.equal(availabilityCalls, 0);
  });

  test("keeps empty availability successful", async () => {
    const result = await createPharmacyDiscoveryAdapter(fakes({
      getAvailability: async () => availability({ availability: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
    })).discover({ discoveryType: "medicine", medicineName: "Crocin" }, context);
    assert.equal(result.status, "success");
    if (result.status === "success") assert.deepEqual(result.data.pharmacies, []);
  });

  test("maps known not-found errors and hides unexpected service failures", async () => {
    const notFound = await createPharmacyDiscoveryAdapter(fakes({
      getAvailability: async () => { throw new ApiError(404, "Medicine not found.", "MEDICINE_NOT_FOUND"); },
    })).discover({ discoveryType: "medicine", medicineName: "Crocin" }, context);
    assert.equal(notFound.status, "error");
    if (notFound.status === "error") assert.equal(notFound.code, "not_found");

    const failed = await createPharmacyDiscoveryAdapter(fakes({
      searchMedicines: async () => { throw new Error("private database detail"); },
    })).discover({ discoveryType: "medicine", medicineName: "Crocin" }, context);
    assert.deepEqual(failed, { status: "error", code: "execution_failed", message: "Medicine availability could not be retrieved." });
  });

  test("keeps pharmacy-only discovery explicitly unavailable without calling services", async () => {
    let calls = 0;
    const adapter = createPharmacyDiscoveryAdapter(fakes({ listAddresses: async () => { calls += 1; return []; } }));
    const result = await adapter.discover({ discoveryType: "pharmacy" }, context);
    assert.deepEqual(result, { status: "error", code: "unavailable", message: "Nearby pharmacy discovery is not connected yet." });
    assert.equal(calls, 0);
  });
});

describe("medicine assistant integration", () => {
  test("summarizes availability, stale data, and prescription metadata deterministically", async () => {
    const dependencies = createUnavailableIntelligenceDependencies();
    const adapter = createPharmacyDiscoveryAdapter(fakes({
      getAvailability: async () => availability({
        medicine: { ...availability().medicine, requiresPrescription: true },
        availability: [{ ...availability().availability[0], freshness: "STALE" as const }],
      }),
    }));
    const assistant = composeIntelligenceModule({ ...dependencies, medicineDiscovery: adapter });
    const response = await assistant.respond({ message: "Find Crocin near me", channel: "text", correlationId: "not-an-identity" }, context);
    assert.equal(response.status, "fulfilled");
    assert.equal(response.message, "Crocin is reported available at 1 pharmacy within 5 km. Some availability information was last updated more than 24 hours ago and may have changed. This medicine is marked as requiring a prescription.");
  });

  test("refuses clinical requests before invoking Pharmacy dependencies", async () => {
    let calls = 0;
    const dependencies = createUnavailableIntelligenceDependencies();
    const assistant = composeIntelligenceModule({
      ...dependencies,
      medicineDiscovery: { discover: async () => { calls += 1; return { status: "error", code: "execution_failed", message: "unexpected" }; } },
    });
    for (const message of [
      "What medicine should I take for fever?",
      "Recommend a pain medicine for me.",
      "What dosage should I take?",
      "Is Crocin safe for me?",
    ]) {
      const response = await assistant.respond({ message, channel: "text" }, context);
      assert.equal(response.status, "refused", message);
      assert.equal(response.intent, "clinical_decision", message);
    }
    assert.equal(calls, 0);
  });
});
