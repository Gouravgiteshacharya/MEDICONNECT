import type { EtaShadowDependencies } from "../ml/eta-runtime.js";
import type { Request, Response } from "express";

import {
  createCustomerOrder,
  getCustomerOrder,
  listCustomerOrders,
} from "../services/order.service.js";
import { ApiError } from "../utils/ApiError.js";
import type { OrderHistoryQuery } from "../validators/order.schemas.js";

function getAuthenticatedCustomerId(req: Request) {
  const customerId = req.user?.id;

  if (!customerId) {
    throw new ApiError(401, "Authentication required.", "AUTH_REQUIRED");
  }

  return customerId;
}

export function createOrderController({ etaRuntime, onEtaShadowResult = () => {} }: EtaShadowDependencies = {}) {
  return async function createOrder(req: Request, res: Response) {
    const order = await createCustomerOrder(
      getAuthenticatedCustomerId(req),
      req.body,
    );

    if (order.fulfillmentMethod === "DELIVERY" && etaRuntime) {
      // Detached minimal snapshot, after commit; never give the predictor response objects.
      try {
        const result = etaRuntime.predictOrderPlacement({
          deliveryDistanceKm: order.deliveryDistanceKm,
          placedAt: new Date(order.placedAt.getTime()),
          items: order.items.map(() => null),
        });
        // Whitelist telemetry fields even when a runtime is injected by a caller.
        const observation = result.status === "predicted"
          ? { status: result.status, predictionPoint: result.predictionPoint, predictedMinutes: result.predictedMinutes, modelVersion: result.modelVersion, dataProvenance: result.dataProvenance }
          : result.status === "unavailable"
            ? { status: result.status, reason: result.reason }
            : { status: "disabled" as const };
        await onEtaShadowResult(observation);
      } catch { /* Optional shadow work must never fail successful checkout. */ }
    }
    res.status(201).json({ order });
  };
}
export const createOrder = createOrderController();

export async function listOrders(req: Request, res: Response) {
  const result = await listCustomerOrders(
    getAuthenticatedCustomerId(req),
    req.query as unknown as OrderHistoryQuery,
  );

  res.status(200).json(result);
}

export async function getOrder(req: Request, res: Response) {
  const order = await getCustomerOrder(
    getAuthenticatedCustomerId(req),
    req.params.orderId as string,
  );

  res.status(200).json({ order });
}
