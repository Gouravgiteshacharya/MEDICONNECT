import { ApiError } from "../middleware/errors.js";
import { validateCoordinates } from "../location/coordinates.js";
import type { RouteConfig } from "./route.config.js";
import { optimizeStops, type OptimizerStop } from "./route-optimizer.js";
import type { RouteProvider } from "./route-provider.js";

export interface RouteStore {
  deliveryBatch: { findFirst(args: unknown): Promise<any>; };
  deliveryStop: { findMany(args: unknown): Promise<any[]>; updateMany(args: unknown): Promise<{ count: number }>; };
  $transaction<T>(callback: (tx: RouteStore) => Promise<T>, options?: unknown): Promise<T>;
}
export interface RouteOptions extends RouteConfig { provider: RouteProvider; now: () => Date; }
const actionableStatuses = ["PENDING", "EN_ROUTE", "ARRIVED"];
const stopSelect = { id: true, assignmentId: true, orderId: true, stopType: true, sequence: true, latitude: true, longitude: true, addressLabel: true, status: true, estimatedArrivalAt: true, updatedAt: true, assignment: { select: { acceptedAt: true, order: { select: { orderNumber: true, quotedEtaMinutes: true } } } } };
function isP2034(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2034"; }
function nowFrom(options: RouteOptions) { const now = options.now(); if (!Number.isFinite(now.getTime())) throw new Error("Route clock returned an invalid date"); return now; }
function safeStop(stop: any) { return { id: stop.id, assignmentId: stop.assignmentId, orderId: stop.orderId, orderNumber: stop.assignment?.order?.orderNumber ?? null, stopType: stop.stopType, sequence: stop.sequence, latitude: stop.latitude, longitude: stop.longitude, addressLabel: stop.addressLabel, status: stop.status, estimatedArrivalAt: stop.estimatedArrivalAt }; }

async function loadBatch(store: RouteStore, batchId: string, riderUserId?: string) {
  const batch = await store.deliveryBatch.findFirst({ where: { id: batchId, status: { in: ["PLANNED", "ACTIVE"] }, ...(riderUserId ? { rider: { userId: riderUserId } } : {}) }, select: { id: true, riderId: true, status: true, createdAt: true, startedAt: true, rider: { select: { currentLatitude: true, currentLongitude: true } }, stops: { select: stopSelect, orderBy: { sequence: "asc" } } } });
  if (!batch) throw new ApiError(404, "Active delivery batch not found", "ROUTE_BATCH_NOT_FOUND");
  return batch;
}

export async function optimizeBatchRoute(store: RouteStore, batchId: string, options: RouteOptions) {
  const now = nowFrom(options), batch = await loadBatch(store, batchId);
  const start = { latitude: batch.rider.currentLatitude, longitude: batch.rider.currentLongitude };
  try { validateCoordinates(start); } catch { throw new ApiError(409, "Rider location is unavailable", "ROUTE_START_UNAVAILABLE"); }
  const active = batch.stops.filter((stop: any) => actionableStatuses.includes(stop.status));
  if (active.length < 2) throw new ApiError(409, "Batch does not have enough pending stops", "ROUTE_NOT_OPTIMIZABLE");
  if (active.length > options.maxStops) throw new ApiError(409, "Batch exceeds route optimizer capacity", "ROUTE_CAPACITY_EXCEEDED");
  const completedPickups = new Set<string>(batch.stops.filter((stop: any) => stop.stopType === "PHARMACY_PICKUP" && stop.status === "COMPLETED" && stop.assignmentId).map((stop: any) => stop.assignmentId));
  const optimizerStops: OptimizerStop[] = active.map((stop: any) => {
    try { validateCoordinates(stop); } catch { throw new ApiError(422, "Route stop coordinates are invalid", "ROUTE_STOP_INVALID"); }
    const quotedEta = stop.assignment?.order?.quotedEtaMinutes;
    if (stop.stopType === "CUSTOMER_DROPOFF" && (!Number.isFinite(quotedEta) || quotedEta <= 0)) throw new ApiError(409, "A delivery ETA is unavailable", "ROUTE_ETA_UNAVAILABLE");
    const base = stop.assignment?.acceptedAt ?? batch.startedAt ?? batch.createdAt;
    return { id: stop.id, assignmentId: stop.assignmentId, stopType: stop.stopType, status: stop.status, latitude: stop.latitude, longitude: stop.longitude, deadlineAt: stop.stopType === "CUSTOMER_DROPOFF" ? new Date(base.getTime() + quotedEta * 60_000) : null };
  });
  // Provider calls are deliberately completed before opening a write transaction.
  const optimized = await optimizeStops({ start, stops: optimizerStops, completedPickups, now, maxLateMinutes: options.maxLateMinutes, provider: options.provider });
  const reservedSequences = new Set<number>(batch.stops.filter((stop: any) => !actionableStatuses.includes(stop.status)).map((stop: any) => stop.sequence));
  const targetSequences: number[] = [];
  for (let value = 1; targetSequences.length < optimized.stops.length; value += 1) if (!reservedSequences.has(value)) targetSequences.push(value);
  for (let attempt = 1; attempt <= 3; attempt += 1) try {
    await store.$transaction(async (tx) => {
      const currentBatch = await tx.deliveryBatch.findFirst({ where: { id: batchId, status: batch.status }, select: { id: true } });
      if (!currentBatch) throw new ApiError(409, "Batch changed during route optimization", "ROUTE_CONFLICT");
      const current = await tx.deliveryStop.findMany({ where: { batchId, status: { in: actionableStatuses } }, select: { id: true, status: true, updatedAt: true } });
      const snapshot = new Map(active.map((stop: any) => [stop.id, `${stop.status}:${stop.updatedAt.toISOString()}`]));
      if (current.length !== active.length || current.some((stop: any) => snapshot.get(stop.id) !== `${stop.status}:${stop.updatedAt.toISOString()}`)) throw new ApiError(409, "Route stops changed during optimization", "ROUTE_CONFLICT");
      for (let index = 0; index < optimized.stops.length; index += 1) {
        const write = await tx.deliveryStop.updateMany({ where: { id: optimized.stops[index].id, batchId, status: optimized.stops[index].status }, data: { sequence: -(index + 1) } });
        if (write.count !== 1) throw new ApiError(409, "Route stops changed during optimization", "ROUTE_CONFLICT");
      }
      for (let index = 0; index < optimized.stops.length; index += 1) {
        const stop = optimized.stops[index];
        const write = await tx.deliveryStop.updateMany({ where: { id: stop.id, batchId, sequence: -(index + 1) }, data: { sequence: targetSequences[index], estimatedArrivalAt: stop.estimatedArrivalAt } });
        if (write.count !== 1) throw new ApiError(409, "Route stops changed during optimization", "ROUTE_CONFLICT");
      }
    }, { isolationLevel: "Serializable" });
    break;
  } catch (error) {
    if (!isP2034(error) || attempt === 3) { if (isP2034(error)) throw new ApiError(409, "Route changed concurrently", "ROUTE_CONFLICT"); throw error; }
  }
  const source = new Map<string, any>(batch.stops.map((stop: any) => [stop.id, stop]));
  return { batchId: batch.id, status: batch.status, optimizedAt: now, totalDistanceKm: Math.round(optimized.totalDistanceKm * 100) / 100, totalDurationMinutes: Math.ceil(optimized.totalDurationMinutes), stops: optimized.stops.map((stop, index) => safeStop({ ...source.get(stop.id), sequence: targetSequences[index], estimatedArrivalAt: stop.estimatedArrivalAt })) };
}

export async function getMyBatchRoute(store: RouteStore, batchId: string, userId: string) {
  const batch = await loadBatch(store, batchId, userId);
  return { batchId: batch.id, status: batch.status, stops: batch.stops.map(safeStop) };
}
