import type { Prisma } from "../../../generated/prisma/client.js";
import type { DispatchDatasetSource } from "./dispatch-dataset.types.js";

export const DISPATCH_DATASET_SELECT = {
  id: true, orderId: true, riderId: true, assignmentId: true, dispatchRoundId: true, status: true, attemptedAt: true,
  riderDistanceToPharmacyKm: true, workloadSignal: true, deterministicRank: true,
  dispatchPolicyVersion: true, selectionPolicy: true, workloadPenaltyKm: true, shortlistSize: true,
  searchRadiusKm: true, freshnessThresholdMs: true,
  order: { select: { status: true, cancelledAt: true } },
  assignment: { select: { id: true, orderId: true, riderId: true, assignedAt: true, offerExpiresAt: true,
    status: true, acceptedAt: true, declinedAt: true, timedOutAt: true, cancelledAt: true, reassignedAt: true } },
} as const satisfies Prisma.DispatchAttemptSelect;
type Selected = Prisma.DispatchAttemptGetPayload<{ select: typeof DISPATCH_DATASET_SELECT }>;
export interface DispatchDatasetDataSource {
  readonly dispatchAttempt: {
    findMany(args: { where: Prisma.DispatchAttemptWhereInput; select: typeof DISPATCH_DATASET_SELECT;
      orderBy: [{ attemptedAt: "asc" }, { id: "asc" }] }): PromiseLike<readonly Selected[]>;
  };
}
/** Seed by explicit time range, then load complete offered order chains and all
 * mappings of their assignments. This prevents clipping cross-window chains.
 * Use a stable offline DB snapshot for a reproducible two-read export. */
export async function loadDispatchDataset(source: DispatchDatasetDataSource, range: { from: Date; until: Date }): Promise<DispatchDatasetSource[]> {
  if (![range.from, range.until].every(d => d instanceof Date && Number.isFinite(d.getTime())) || range.from >= range.until) throw new RangeError("Invalid candidate range");
  const query = (where: Prisma.DispatchAttemptWhereInput) => source.dispatchAttempt.findMany({ where, select: DISPATCH_DATASET_SELECT, orderBy: [{ attemptedAt: "asc" }, { id: "asc" }] });
  const seeds = await query({ attemptedAt: { gte: range.from, lt: range.until }, assignmentId: { not: null } });
  if (!seeds.length) return [];
  const records = await query({ OR: [
    { orderId: { in: [...new Set(seeds.map(s => s.orderId))] }, assignmentId: { not: null } },
    { assignmentId: { in: [...new Set(seeds.flatMap(s => s.assignmentId ? [s.assignmentId] : []))] } },
  ] });
  return records.map(s => ({
    candidateId: s.id, orderId: s.orderId, riderId: s.riderId, dispatchRoundId: s.dispatchRoundId,
    assignmentId: s.assignmentId, status: s.status, attemptedAt: s.attemptedAt,
    riderDistanceKm: s.riderDistanceToPharmacyKm, workloadAtDispatch: s.workloadSignal,
    deterministicRank: s.deterministicRank, dispatchPolicyVersion: s.dispatchPolicyVersion, selectionPolicy: s.selectionPolicy,
    workloadPenaltyKm: s.workloadPenaltyKm, shortlistSize: s.shortlistSize, searchRadiusKm: s.searchRadiusKm,
    freshnessThresholdMs: s.freshnessThresholdMs, orderStatus: s.order.status, orderCancelledAt: s.order.cancelledAt,
    assignment: s.assignment ? {
      id: s.assignment.id, orderId: s.assignment.orderId, riderId: s.assignment.riderId, assignedAt: s.assignment.assignedAt,
      offerExpiresAt: s.assignment.offerExpiresAt, status: s.assignment.status, acceptedAt: s.assignment.acceptedAt,
      declinedAt: s.assignment.declinedAt, timedOutAt: s.assignment.timedOutAt,
      cancelledAt: s.assignment.cancelledAt, reassignedAt: s.assignment.reassignedAt,
    } : null,
  }));
}
