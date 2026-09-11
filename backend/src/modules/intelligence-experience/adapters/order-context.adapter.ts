import { getCustomerOrder } from "../../../services/order.service.js";
import { ApiError } from "../../../utils/ApiError.js";
import { uuidSchema } from "../../../validators/common.schemas.js";
import type { OrderContextAdapter, OrderStatusData, ToolExecutionResult } from "../contracts.js";

export interface OrderContextDependencies {
  readonly getCustomerOrder: typeof getCustomerOrder;
}

export function createOrderContextAdapter(
  dependencies: OrderContextDependencies = { getCustomerOrder },
): OrderContextAdapter {
  return {
    async getOrder(orderId, context) {
      const normalizedId = orderId.trim();
      if (!uuidSchema.safeParse(normalizedId).success) {
        return error("invalid_request", "Please provide a valid order ID.");
      }
      try {
        const order = await dependencies.getCustomerOrder(context.userId, normalizedId);
        return { status: "success", data: toOrderStatusData(order) };
      } catch (caught) {
        return translateError(caught);
      }
    },
  };
}

function toOrderStatusData(order: Awaited<ReturnType<typeof getCustomerOrder>>): OrderStatusData {
  return {
    order: {
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentMethod: order.fulfillmentMethod,
      totalAmount: order.totalAmount.toString(),
      placedAt: order.placedAt.toISOString(),
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      updatedAt: order.updatedAt.toISOString(),
    },
    items: order.items.map((item) => ({
      medicineName: item.medicineNameSnapshot,
      brandName: item.brandNameSnapshot,
      requiresPrescription: item.requiresPrescription,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
    prescriptions: order.prescriptions.map((prescription) => ({
      status: prescription.status,
      uploadedAt: prescription.uploadedAt.toISOString(),
      reviewedAt: prescription.reviewedAt?.toISOString() ?? null,
      reviewNotes: prescription.reviewNotes,
      rejectionReason: prescription.rejectionReason,
    })),
  };
}

function translateError(caught: unknown): ToolExecutionResult<never> {
  if (caught instanceof ApiError) {
    if (caught.code === "ORDER_NOT_FOUND") return error("not_found", "Order not found.");
    if (caught.code === "FORBIDDEN") return error("forbidden", "You do not have access to this order.");
    if (caught.code === "UNAVAILABLE" || caught.code === "SERVICE_UNAVAILABLE") return error("unavailable", "Order information is currently unavailable.");
  }
  return error("execution_failed", "Order information could not be retrieved.");
}

function error(code: "invalid_request" | "not_found" | "forbidden" | "unavailable" | "execution_failed", message: string): ToolExecutionResult<never> {
  return { status: "error", code, message };
}
