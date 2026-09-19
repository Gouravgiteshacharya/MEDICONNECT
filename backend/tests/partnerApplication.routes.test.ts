import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserRole } from "../generated/prisma/client.js";
import { signAuthToken } from "../src/utils/jwt.js";

const service = vi.hoisted(() => ({
  submitPharmacyApplication: vi.fn(),
  submitRiderApplication: vi.fn(),
  listPharmacyApplications: vi.fn(),
  listRiderApplications: vi.fn(),
  getPharmacyApplication: vi.fn(),
  getRiderApplication: vi.fn(),
  transitionPharmacyApplication: vi.fn(),
  transitionRiderApplication: vi.fn(),
  recordFieldVisit: vi.fn(),
  recordOfficeVerification: vi.fn(),
  approvePharmacyApplication: vi.fn(),
  approveRiderApplication: vi.fn(),
  createPharmacyPhotoAccess: vi.fn(),
}));

const userFindUnique = vi.hoisted(() => vi.fn());

vi.mock("../src/services/partnerApplication.service.js", () => service);
vi.mock("../src/lib/prisma.js", () => ({ prisma: { user: { findUnique: userFindUnique } } }));

const { app } = await import("../src/app.js");

const customerId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const applicationId = "33333333-3333-4333-8333-333333333333";

function token(role: UserRole, id = customerId) {
  return `Bearer ${signAuthToken({ userId: id, role })}`;
}

describe("partner application routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUnique.mockImplementation(({ where: { id } }) => Promise.resolve({
      id,
      name: "Test",
      email: "test@mediconnect.local",
      phone: null,
      role: id === adminId ? UserRole.ADMIN : UserRole.CUSTOMER,
      isActive: true,
    }));
  });

  it("accepts a public pharmacy application with a real photo", async () => {
    service.submitPharmacyApplication.mockResolvedValue({ id: applicationId, status: "APPLICATION_SUBMITTED" });
    const response = await request(app)
      .post("/api/v1/partner/pharmacy/apply")
      .field("pharmacyName", "Local Care Pharmacy")
      .field("contactName", "Owner")
      .field("contactEmail", "owner@example.com")
      .field("phone", "9999999999")
      .field("addressLine1", "Main Road")
      .field("city", "Keonjhar")
      .field("state", "Odisha")
      .field("postalCode", "758001")
      .field("latitude", "21.63")
      .field("longitude", "85.58")
      .field("licenseNumber", "LIC-TEST-1")
      .field("operatingInfo", "Open daily")
      .field("pickupAvailable", "true")
      .field("consentAccepted", "true")
      .attach("photo", Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), { filename: "pharmacy.png", contentType: "image/png" });
    expect(response.status).toBe(201);
    expect(service.submitPharmacyApplication).toHaveBeenCalledOnce();
  });

  it("accepts a public rider application but rejects role self-selection", async () => {
    service.submitRiderApplication.mockResolvedValue({ id: applicationId, status: "APPLICATION_SUBMITTED" });
    const body = { fullName: "Rider", email: "rider@example.com", phone: "8888888888", addressLine1: "Market Road", city: "Keonjhar", state: "Odisha", postalCode: "758001", vehicleType: "BIKE", vehicleNumber: "OD09AA1234", drivingLicenseNumber: "DL-TEST-1", consentAccepted: true };
    expect((await request(app).post("/api/v1/partner/rider/apply").send(body)).status).toBe(201);
    const forbiddenRole = await request(app).post("/api/v1/partner/rider/apply").send({ ...body, role: "DELIVERY_PARTNER" });
    expect(forbiddenRole.status).toBe(400);
    expect(service.submitRiderApplication).toHaveBeenCalledTimes(1);
  });

  it("keeps application review and private photo access admin-only", async () => {
    service.listPharmacyApplications.mockResolvedValue({ applications: [], nextCursor: null });
    service.createPharmacyPhotoAccess.mockResolvedValue("https://private.example/signed");
    expect((await request(app).get("/api/v1/admin/applications/pharmacies")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/applications/pharmacies").set("Authorization", token(UserRole.CUSTOMER))).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/applications/pharmacies").set("Authorization", token(UserRole.ADMIN, adminId))).status).toBe(200);
    expect((await request(app).get(`/api/v1/admin/applications/pharmacies/${applicationId}/photo-access`).set("Authorization", token(UserRole.CUSTOMER))).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/applications/pharmacies/${applicationId}/photo-access`).set("Authorization", token(UserRole.ADMIN, adminId))).status).toBe(200);
  });
});
