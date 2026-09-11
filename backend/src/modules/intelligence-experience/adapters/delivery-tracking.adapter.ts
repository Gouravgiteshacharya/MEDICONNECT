import { z } from "zod";
import { createCustomerTrackingReader, type CustomerTrackingReader } from "../../../customer-tracking/tracking.reader.js";
import { parseTrackingOrderId } from "../../../customer-tracking/tracking.validation.js";
import { ApiError } from "../../../utils/ApiError.js";
import type { DeliveryTrackingAdapter, DeliveryTrackingData, ToolErrorCode, ToolExecutionResult } from "../contracts.js";

const orderStatus = z.enum([
  "CREATED", "PRESCRIPTION_PENDING", "PRESCRIPTION_APPROVED", "PRESCRIPTION_REJECTED",
  "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP",
  "PICKED_UP_BY_CUSTOMER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REJECTED_BY_PHARMACY",
]);
const assignmentStatus = z.enum(["ACCEPTED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"]).nullable();
const eventType = z.enum([
  "RIDER_ASSIGNED", "RIDER_ACCEPTED", "ARRIVED_AT_PHARMACY", "PICKED_UP", "OUT_FOR_DELIVERY",
  "DELIVERED", "FAILED_DELIVERY", "REASSIGNED", "CANCELLED",
]);

// Validate the legacy service's weakly typed output before exposing or summarizing it.
const trackingRecord = z.object({
  orderNumber: z.string(), status: orderStatus, quotedEtaMinutes: z.number().int().nonnegative().nullable(),
  assignment: z.object({ status: assignmentStatus.unwrap() }).nullable(),
  timeline: z.array(z.object({ eventType: z.string(), occurredAt: z.unknown() })),
});

const deliveryData = z.object({
  order: z.object({ orderNumber: z.string(), status: orderStatus }),
  delivery: z.object({ assignmentStatus, quotedEtaMinutes: z.number().int().nonnegative().nullable() }),
  events: z.array(z.object({ type: eventType, occurredAt: z.iso.datetime() })),
});

export function isDeliveryTrackingData(value: unknown): value is DeliveryTrackingData {
  return deliveryData.safeParse(value).success;
}

export interface DeliveryTrackingDependencies {
  readonly readTracking: CustomerTrackingReader;
}

export function createDeliveryTrackingAdapter(
  dependencies: DeliveryTrackingDependencies = { readTracking: createCustomerTrackingReader() },
): DeliveryTrackingAdapter {
  return {
    async getTracking(orderId, context) {
      if (!context.roles.includes("CUSTOMER")) return error("forbidden", "Delivery tracking is available only to customers.");
      let id: string;
      try { id = parseTrackingOrderId(typeof orderId === "string" ? orderId.trim() : orderId); }
      catch { return error("invalid_request", "Please provide a valid order ID to track the delivery."); }
      try {
        const record = trackingRecord.parse(await dependencies.readTracking(context.userId, id));
        const data: DeliveryTrackingData = {
          order: { orderNumber: record.orderNumber, status: record.status },
          delivery: { assignmentStatus: record.assignment?.status ?? null, quotedEtaMinutes: record.quotedEtaMinutes },
          events: record.timeline.flatMap((event) => {
            const type = eventType.safeParse(event.eventType);
            return type.success ? [{ type: type.data, occurredAt: z.date().parse(event.occurredAt).toISOString() }] : [];
          }),
        };
        return { status: "success", data };
      } catch (caught) {
        if (caught instanceof ApiError) {
          if (caught.code === "ORDER_NOT_FOUND") return error("not_found", "Order not found.");
          if (["TRACKING_NOT_AVAILABLE", "UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(caught.code)) {
            return error("unavailable", "Delivery tracking is currently unavailable.");
          }
        }
        return error("execution_failed", "Delivery tracking could not be retrieved.");
      }
    },
  };
}

function error(code: ToolErrorCode, message: string): ToolExecutionResult<never> {
  return { status: "error", code, message };
}
