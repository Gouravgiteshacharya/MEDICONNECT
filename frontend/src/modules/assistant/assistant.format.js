const STATUS_PRESENTATION = {
  fulfilled: { label: 'Completed', className: 'fulfilled' },
  refused: { label: 'Medical safety', className: 'refused' },
  unsupported: { label: 'How I can help', className: 'unsupported' },
  error: { label: 'Unable to complete', className: 'error' },
}

const TOOL_ERROR_LABELS = {
  invalid_request: 'More information needed',
  not_found: 'Not found',
  forbidden: 'Access unavailable',
  unavailable: 'Service unavailable',
  execution_failed: 'Request failed',
}

export function getResponsePresentation(status) {
  return STATUS_PRESENTATION[status] || STATUS_PRESENTATION.error
}

export function getToolErrorLabel(code) {
  return TOOL_ERROR_LABELS[code] || 'Request error'
}

export function getToolResultPresentation(toolResult) {
  if (!toolResult || toolResult.status !== 'error') return null
  return { label: getToolErrorLabel(toolResult.code), message: toolResult.message }
}

export function getActionDisplayMode(action) {
  if (!action || action.kind === 'submit') return 'informational'
  if ((action.kind === 'navigate' || action.kind === 'contact_professional') && !action.target) return 'informational'
  return action.target ? 'actionable' : 'informational'
}
