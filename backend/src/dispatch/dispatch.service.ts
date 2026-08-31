import { ApiError } from "../middleware/errors.js";
import { haversineDistanceKm, validateCoordinates } from "../location/coordinates.js";
import { classifyLocationFreshness } from "../location/freshness.js";
import { LIVE_ASSIGNMENT_STATUSES } from "../delivery-assignments/assignment.service.js";
import type { DispatchConfig } from "./dispatch.config.js";
import { rankDispatchCandidates } from "./dispatch.ranking.js";
import { isPeakHour, type LogisticsModel } from "../ml/logistics-model.js";

interface Count { count: number; }
interface DispatchStore {
  order: { findUnique(args: unknown): Promise<any>; };
  deliveryPartner: { findMany(args: unknown): Promise<any[]>; };
  deliveryAssignment: { findFirst(args: unknown): Promise<any>; create(args: unknown): Promise<any>; };
  dispatchAttempt: { findMany(args: unknown): Promise<any[]>; createMany(args: unknown): Promise<Count>; findFirst(args: unknown): Promise<any>; updateMany(args: unknown): Promise<Count>; };
  $transaction<T>(callback: (tx: DispatchStore) => Promise<T>, options?: unknown): Promise<T>;
}
export type { DispatchStore };
export interface DispatchOptions extends DispatchConfig { freshnessThresholdMs: number; mlModel: LogisticsModel | null; maxPredictionMinutes: number; timezoneOffsetMinutes: number; now: () => Date; }
const assignmentProjection = { id: true, orderId: true, riderId: true, status: true, assignmentScore: true, assignedAt: true };

function clock(options: DispatchOptions): Date {
  const now = options.now(); if (!Number.isFinite(now.getTime())) throw new Error("Dispatch clock returned an invalid date"); return now;
}
function p2034(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2034"; }

export async function dispatchOrder(store: DispatchStore, orderId: string, options: DispatchOptions) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await store.$transaction(async (tx) => {
        const now = clock(options);
        const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, fulfillmentMethod: true, status: true, deliveryDistanceKm: true, pharmacy: { select: { latitude: true, longitude: true } } } });
        if (!order) throw new ApiError(404, "Order not found", "ORDER_NOT_FOUND");
        if (order.fulfillmentMethod !== "DELIVERY" || order.status !== "READY_FOR_PICKUP") throw new ApiError(409, "Order is not eligible for dispatch", "ORDER_NOT_ELIGIBLE");
        const existing = await tx.deliveryAssignment.findFirst({ where: { orderId, status: { in: LIVE_ASSIGNMENT_STATUSES } }, select: assignmentProjection });
        if (existing) return { assignment: existing, alreadyDispatched: true, evaluatedCandidates: 0 };
        const pharmacy = order.pharmacy;
        if (pharmacy?.latitude == null || pharmacy?.longitude == null) throw new ApiError(422, "Pharmacy coordinates are unavailable", "PHARMACY_COORDINATES_UNAVAILABLE");
        try { validateCoordinates(pharmacy); } catch { throw new ApiError(422, "Pharmacy coordinates are unavailable", "PHARMACY_COORDINATES_UNAVAILABLE"); }

        const prior = await tx.dispatchAttempt.findMany({ where: { orderId, status: { in: ["OFFERED", "DECLINED", "TIMED_OUT", "ACCEPTED"] } }, select: { riderId: true } });
        const excluded = new Set(prior.map((item) => item.riderId));
        const riders = await tx.deliveryPartner.findMany({
          where: { isActive: true, availability: "AVAILABLE", user: { isActive: true }, currentLatitude: { not: null }, currentLongitude: { not: null }, lastLocationAt: { not: null } },
          select: { id: true, currentLatitude: true, currentLongitude: true, lastLocationAt: true, _count: { select: { assignments: { where: { status: { in: ["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY"] } } } } } },
        });
        const eligible = [] as { riderId: string; distanceKm: number; workload: number }[];
        for (const rider of riders) {
          if (excluded.has(rider.id) || classifyLocationFreshness(rider.lastLocationAt, { now, freshForMs: options.freshnessThresholdMs }) !== "FRESH") continue;
          try {
            const distanceKm = haversineDistanceKm(pharmacy, { latitude: rider.currentLatitude, longitude: rider.currentLongitude });
            if (distanceKm <= options.maxRadiusKm) eligible.push({ riderId: rider.id, distanceKm, workload: rider._count.assignments });
          } catch { /* invalid coordinates are ineligible */ }
        }
        const deterministic = rankDispatchCandidates(eligible, options.workloadPenaltyKm).slice(0, options.maxCandidates);
        if (!deterministic.length) throw new ApiError(409, "No eligible rider is currently available", "NO_ELIGIBLE_RIDER");
        let mode: "ML_ASSISTED" | "DETERMINISTIC_FALLBACK" = "DETERMINISTIC_FALLBACK", modelVersion: string | null = null;
        let ranked = deterministic.map((candidate) => ({ ...candidate, deterministicScore: candidate.score, predictedCompletionMinutes: null as number | null }));
        if (options.mlModel) try {
          const predicted = deterministic.map((candidate) => { const prediction = options.mlModel!.predictDispatch({ riderDistanceKm: candidate.distanceKm, workload: candidate.workload, customerDistanceKm: Math.max(0.5, order.deliveryDistanceKm ?? candidate.distanceKm), peakHour: isPeakHour(now, options.timezoneOffsetMinutes), batched: 0 }); if (!Number.isFinite(prediction.predictedCompletionMinutes) || prediction.predictedCompletionMinutes <= 0 || prediction.predictedCompletionMinutes > options.maxPredictionMinutes) throw new Error("Invalid ML dispatch prediction"); return { ...candidate, deterministicScore: candidate.score, predictedCompletionMinutes: prediction.predictedCompletionMinutes, modelVersion: prediction.modelVersion }; });
          predicted.sort((a, b) => a.predictedCompletionMinutes - b.predictedCompletionMinutes || a.deterministicScore - b.deterministicScore || a.riderId.localeCompare(b.riderId)); ranked = predicted; mode = "ML_ASSISTED"; modelVersion = predicted[0].modelVersion;
        } catch { /* deterministic ranking remains authoritative fallback */ }
        await tx.dispatchAttempt.createMany({ data: ranked.map((candidate) => ({ orderId, riderId: candidate.riderId, suitabilityScore: candidate.predictedCompletionMinutes ?? candidate.deterministicScore, riderDistanceToPharmacyKm: candidate.distanceKm, workloadSignal: candidate.workload, routeCompatibilityScore: candidate.deterministicScore, status: "CANDIDATE", attemptedAt: now })) });
        const winner = ranked[0];
        const assignment = await tx.deliveryAssignment.create({ data: { orderId, riderId: winner.riderId, status: "OFFERED", assignmentScore: winner.predictedCompletionMinutes ?? winner.deterministicScore, assignedAt: now }, select: assignmentProjection });
        await tx.dispatchAttempt.updateMany({ where: { orderId, riderId: winner.riderId, status: "CANDIDATE", attemptedAt: now }, data: { status: "OFFERED", assignmentId: assignment.id } });
        return { assignment, alreadyDispatched: false, evaluatedCandidates: ranked.length, optimization: { mode, modelVersion, predictedCompletionMinutes: winner.predictedCompletionMinutes, deterministicScore: winner.deterministicScore } };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!p2034(error) || attempt === 3) {
        if (p2034(error)) throw new ApiError(409, "Dispatch changed concurrently", "DISPATCH_CONFLICT");
        throw error;
      }
    }
  }
  throw new ApiError(409, "Dispatch changed concurrently", "DISPATCH_CONFLICT");
}
