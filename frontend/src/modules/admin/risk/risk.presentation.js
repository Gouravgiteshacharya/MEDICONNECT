export const rules = {
  ASSIGNMENT_OFFER_TIMED_OUT: ['Assignment offer timed out', 'A historical assignment offer timeout was recorded.'],
  DELIVERY_FAILED: ['Delivery failure recorded', 'A recorded delivery failure requires operational review.'],
  RIDER_LOCATION_STALE: ['Location update stale', 'Location telemetry was stale for an active assignment at evaluation time.'],
}
export const severities = ['INFO', 'LOW', 'MEDIUM', 'HIGH']
export const statuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']
export const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export const label = value => typeof value === 'string' ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, char => char.toUpperCase()) : 'Unavailable'
export function rulePresentation(record) {
  return record.ruleVersion === '1' && Object.hasOwn(rules, record.ruleCode) ? rules[record.ruleCode] : ['Operational assessment', 'Presentation information is unavailable for this rule version.']
}
export const formatTime = value => isIso(value) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' }).format(new Date(value)) : 'Not recorded'
const orderStates = ['CREATED', 'PRESCRIPTION_PENDING', 'PRESCRIPTION_APPROVED', 'PRESCRIPTION_REJECTED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'PICKED_UP_BY_CUSTOMER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED_BY_PHARMACY']

// Explicit typed fields only. Never recursively render an object or unknown version.
export function evidenceRows(record) {
  if (record.ruleVersion !== '1' || record.evidence?.status !== 'available') return null
  const e = record.evidence.evidence
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null
  if (record.ruleCode === 'ASSIGNMENT_OFFER_TIMED_OUT' && e.assignmentStatus === 'TIMED_OUT' && (e.offerExpiresAt === null || isIso(e.offerExpiresAt)) && isIso(e.timedOutAt)) {
    return [['Assignment status', 'Timed out'], ['Offer deadline', formatTime(e.offerExpiresAt)], ['Timed out at', formatTime(e.timedOutAt)]]
  }
  if (record.ruleCode === 'DELIVERY_FAILED' && e.assignmentStatus === 'FAILED' && e.eventType === 'FAILED_DELIVERY' && isIso(e.occurredAt) && orderStates.includes(e.orderStatusAtFailure) && e.requiresManualReview === true) {
    return [['Assignment status', 'Failed'], ['Event', 'Failed delivery'], ['Occurred at', formatTime(e.occurredAt)], ['Order status at failure', label(e.orderStatusAtFailure)], ['Manual review required', 'Yes']]
  }
  if (record.ruleCode === 'RIDER_LOCATION_STALE' && ['ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(e.assignmentStatus) && e.locationFreshness === 'STALE' && isIso(e.lastLocationAt) && isIso(e.evaluatedAt) && Number.isFinite(e.freshnessThresholdMs) && e.freshnessThresholdMs >= 0) {
    return [['Assignment status', label(e.assignmentStatus)], ['Telemetry freshness', 'Stale at evaluation'], ['Last location update', formatTime(e.lastLocationAt)], ['Freshness threshold', `${e.freshnessThresholdMs} ms`], ['Evaluated at', formatTime(e.evaluatedAt)]]
  }
  return null
}
export function riskError(error) {
  if (error.kind === 'network') return 'Unable to reach the service. Please try again.'
  return ({ 400: 'The risk request was not accepted. Check the filters and retry.', 401: 'Your session has expired. Please sign in again.', 403: 'Access denied. This account cannot view operational assessments.', 404: 'This assessment is unavailable. Return to the queue.', 409: 'The assessment changed while loading. Please refresh.' })[error.status] || 'Operational assessments could not be loaded. Please try again.'
}
