const ALLOWED_EVENTS = new Set([
  'medicine_search',
  'pharmacy_result_opened',
  'checkout_started',
  'checkout_completed',
  'partner_pharmacy_application_started',
  'partner_pharmacy_application_submitted',
  'partner_rider_application_started',
  'partner_rider_application_submitted',
])

export function trackEvent(eventName) {
  if (!ALLOWED_EVENTS.has(eventName) || import.meta.env.VITE_ANALYTICS_ENABLED !== 'true') return false

  window.dispatchEvent(new CustomEvent('mediconnect:analytics', {
    detail: { eventName },
  }))
  return true
}

export function isAllowedAnalyticsEvent(eventName) {
  return ALLOWED_EVENTS.has(eventName)
}

