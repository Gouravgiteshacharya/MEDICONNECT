import type { PrismaClient } from "../../generated/prisma/client.js";
import { isRiskFactObject } from "./risk.evidence.js";
import type { DeliveryFailureEventFacts } from "./rules/delivery-failed.rule.js";
import { activeLocationAssignmentStates } from "./rules/rider-location-stale.rule.js";
import type { ReconciliationSource, LocationAssignment } from "./risk.reconciliation.js";

const locationSelect = { id: true, orderId: true, status: true, assignedAt: true, updatedAt: true,
  rider: { select: { lastLocationAt: true } } } as const;
function location(row: { id: string; orderId: string; status: string; assignedAt: Date; updatedAt: Date; rider: { lastLocationAt: Date | null } }): LocationAssignment {
  return { assignmentId: row.id, orderId: row.orderId, assignmentStatus: row.status, assignedAt: row.assignedAt,
    updatedAt: row.updatedAt, lastLocationAt: row.rider.lastLocationAt };
}
export interface ReconciliationDelegates {
  assignments: Pick<PrismaClient["deliveryAssignment"], "findMany" | "findUnique">;
  events: Pick<PrismaClient["deliveryEvent"], "findMany">;
  assessments: Pick<PrismaClient["operationalRiskAssessment"], "findMany">;
}
/** No imports of live clients, writes, domain hydration, notes or coordinates. */
export function createPrismaRiskReconciliationSource(store: ReconciliationDelegates): ReconciliationSource {
  return {
    async readPage(o) {
      // Timestamp keyset plus an offset only within ties avoids putting application IDs
      // in continuation telemetry. IDs are used solely as an internal stable tie-breaker.
      const dateRange = { ...(o.cursor ? { gte: new Date(o.cursor.at) } : {}), lte: o.evaluatedAt };
      const page = { take: o.batchSize + 1, skip: o.cursor?.consumedAtTime ?? 0 };
      if (o.lane === "timeouts") {
        const rows = await store.assignments.findMany({ ...page, where: { status: "TIMED_OUT", assignedAt: dateRange },
          orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
          select: { id: true, orderId: true, status: true, assignedAt: true, offerExpiresAt: true, timedOutAt: true } });
        return rows.map(r => ({ lane: "timeouts" as const, at: r.assignedAt, facts: { assignmentId: r.id, orderId: r.orderId,
          status: r.status, assignedAt: r.assignedAt, offerExpiresAt: r.offerExpiresAt, timedOutAt: r.timedOutAt } }));
      }
      if (o.lane === "failures") {
        const rows = await store.events.findMany({ ...page, where: { eventType: "FAILED_DELIVERY", occurredAt: dateRange },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true, orderId: true, assignmentId: true,
            eventType: true, occurredAt: true, metadata: true, assignment: { select: { id: true, orderId: true, status: true } } } });
        return rows.map(r => {
          // Only the two durable structured metadata fields cross the reader boundary.
          // Missing/legacy metadata is unavailable, never inferred from current order or notes.
          const m = r.metadata;
          const event: DeliveryFailureEventFacts | null = isRiskFactObject(m) && typeof m.requiresManualReview === "boolean" && typeof m.orderStatusAtFailure === "string"
            ? { id: r.id, eventType: r.eventType, occurredAt: r.occurredAt, requiresManualReview: m.requiresManualReview, orderStatusAtFailure: m.orderStatusAtFailure } : null;
          const linked = r.assignment && r.assignment.id === r.assignmentId && r.assignment.orderId === r.orderId;
          return { lane: "failures" as const, at: r.occurredAt, facts: { assignmentId: r.assignmentId ?? "", orderId: r.orderId,
            assignmentStatus: linked ? r.assignment!.status : "", failureEvent: event } };
        });
      }
      if (o.lane === "locations") {
        const rows = await store.assignments.findMany({ ...page, where: { status: { in: [...activeLocationAssignmentStates] }, assignedAt: dateRange },
          orderBy: [{ assignedAt: "asc" }, { id: "asc" }], select: locationSelect });
        return rows.map(r => ({ lane: "locations" as const, at: r.assignedAt, facts: location(r) }));
      }
      // Include ALL lifecycle statuses so our own resolutions never shrink the scan and
      // shift ties. Each candidate is then read through the existing strict service.
      const rows = await store.assessments.findMany({ ...page, where: { ruleCode: "RIDER_LOCATION_STALE", entityType: "DELIVERY_ASSIGNMENT", detectedAt: dateRange },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }], select: { id: true, detectedAt: true } });
      return rows.map(r => ({ lane: "recovery" as const, at: r.detectedAt, assessmentId: r.id }));
    },
    async readAssignment(id) {
      const row = await store.assignments.findUnique({ where: { id }, select: locationSelect });
      return row ? location(row) : null;
    },
  };
}
