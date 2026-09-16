import { assignmentTimeoutMetadata, evaluateAssignmentTimeout } from "./rules/assignment-timeout.rule.js";
import { deliveryFailedMetadata, evaluateDeliveryFailed } from "./rules/delivery-failed.rule.js";
import { riderLocationStaleMetadata, evaluateRiderLocationStale } from "./rules/rider-location-stale.rule.js";

export { assignmentTimeoutMetadata, evaluateAssignmentTimeout, deliveryFailedMetadata, evaluateDeliveryFailed, riderLocationStaleMetadata, evaluateRiderLocationStale };
export type { AssignmentTimeoutFacts } from "./rules/assignment-timeout.rule.js";
export type { DeliveryFailedFacts, DeliveryFailureEventFacts } from "./rules/delivery-failed.rule.js";
export type { RiderLocationStaleFacts } from "./rules/rider-location-stale.rule.js";

/** Explicit, immutable registry; each evaluator retains its own narrow input type. */
export const operationalRiskRules = Object.freeze({
  ASSIGNMENT_OFFER_TIMED_OUT: Object.freeze({ metadata: assignmentTimeoutMetadata, evaluate: evaluateAssignmentTimeout }),
  DELIVERY_FAILED: Object.freeze({ metadata: deliveryFailedMetadata, evaluate: evaluateDeliveryFailed }),
  RIDER_LOCATION_STALE: Object.freeze({ metadata: riderLocationStaleMetadata, evaluate: evaluateRiderLocationStale }),
});
