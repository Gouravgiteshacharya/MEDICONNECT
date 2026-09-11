import { expect, it, vi } from "vitest";
import { createCustomerTrackingReader } from "../src/customer-tracking/tracking.reader.js";
import { getCustomerTracking, type TrackingStore } from "../src/customer-tracking/tracking.service.js";

it("binds the store, identities, configured freshness and server clock without changing the result", async () => {
  const store: TrackingStore = { order: { findFirst: vi.fn() } };
  const now = vi.fn(() => new Date("2026-09-01T12:00:00Z"));
  const options = { freshnessThresholdMs: 12345, now };
  const result = {} as Awaited<ReturnType<typeof getCustomerTracking>>;
  const getTracking = vi.fn<typeof getCustomerTracking>().mockResolvedValue(result);
  const reader = createCustomerTrackingReader({ store, options, getTracking });
  expect(await reader("trusted-customer", "order-id")).toBe(result);
  expect(getTracking).toHaveBeenCalledExactlyOnceWith(store, "trusted-customer", "order-id", options);
  expect(getTracking.mock.calls[0][3].now).toBe(now);
  expect(store.order.findFirst).not.toHaveBeenCalled();
});
