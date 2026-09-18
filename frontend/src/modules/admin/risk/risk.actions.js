import { evidenceRows, rules } from './risk.presentation.js'

export const dismissalReasons = ['FALSE_POSITIVE', 'DUPLICATE_CONTEXT']
export const actionLabels = { acknowledge: 'Acknowledge', resolve: 'Resolve', dismiss: 'Dismiss' }
export function readOnlyReason(record) {
  if (!record) return ''
  if (record.ruleVersion !== '1' || !Object.hasOwn(rules, record.ruleCode)) return 'This historical assessment is available for review, but lifecycle actions are not available for this rule version.'
  if (!evidenceRows(record)) return 'Actions are unavailable because the operational evidence cannot currently be verified.'
  // Backend evidence is strict: extra fields also make a record ineligible.
  const fields = {
    ASSIGNMENT_OFFER_TIMED_OUT: ['assignmentStatus', 'offerExpiresAt', 'timedOutAt'],
    DELIVERY_FAILED: ['assignmentStatus', 'eventType', 'occurredAt', 'orderStatusAtFailure', 'requiresManualReview'],
    RIDER_LOCATION_STALE: ['assignmentStatus', 'locationFreshness', 'lastLocationAt', 'freshnessThresholdMs', 'evaluatedAt'],
  }[record.ruleCode]
  if (Object.keys(record.evidence.evidence).some(key => !fields.includes(key))) return 'Actions are unavailable because the operational evidence cannot currently be verified.'
  return ''
}
export function availableActions(record) {
  if (!record || readOnlyReason(record)) return []
  if (record.status === 'OPEN') return ['acknowledge', 'resolve', 'dismiss']
  if (record.status === 'ACKNOWLEDGED') return ['resolve', 'dismiss']
  return []
}
