import { describe, expect, it } from "vitest";
import { loadAssignmentConfig } from "../src/delivery-assignments/assignment.config.js";
import { assignmentExpiresAt, isAssignmentOfferExpired } from "../src/delivery-assignments/assignment.expiry.js";

describe("assignment offer configuration and expiry", () => {
  const assignedAt = new Date("2026-08-30T12:00:00Z");
  it("uses a positive configured timeout", () => expect(loadAssignmentConfig({ DELIVERY_ASSIGNMENT_OFFER_TIMEOUT_SECONDS: "45" }).offerTimeoutMs).toBe(45_000));
  it.each(["0", "-1", "bad"]) ("rejects invalid timeout %s", (value) => expect(() => loadAssignmentConfig({ DELIVERY_ASSIGNMENT_OFFER_TIMEOUT_SECONDS: value })).toThrow());
  it("calculates expiry", () => expect(assignmentExpiresAt(assignedAt, 30_000).toISOString()).toBe("2026-08-30T12:00:30.000Z"));
  it("is actionable before and expired at the exact boundary", () => {
    expect(isAssignmentOfferExpired(assignedAt, new Date(assignedAt.getTime() + 29_999), 30_000)).toBe(false);
    expect(isAssignmentOfferExpired(assignedAt, new Date(assignedAt.getTime() + 30_000), 30_000)).toBe(true);
  });
});
