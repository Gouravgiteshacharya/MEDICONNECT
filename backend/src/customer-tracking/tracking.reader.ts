import { prisma } from "../lib/prisma.js";
import { loadLocationConfig } from "../location/config.js";
import { getCustomerTracking, type TrackingOptions, type TrackingStore } from "./tracking.service.js";

export interface TrackingReaderDependencies {
  readonly store: TrackingStore;
  readonly options: TrackingOptions;
  readonly getTracking: typeof getCustomerTracking;
}

export function createCustomerTrackingReader(
  dependencies: TrackingReaderDependencies = {
    store: prisma,
    options: { freshnessThresholdMs: loadLocationConfig().freshnessThresholdMs, now: () => new Date() },
    getTracking: getCustomerTracking,
  },
) {
  return (customerId: string, orderId: string) => dependencies.getTracking(
    dependencies.store, customerId, orderId, dependencies.options,
  );
}

export type CustomerTrackingReader = ReturnType<typeof createCustomerTrackingReader>;
