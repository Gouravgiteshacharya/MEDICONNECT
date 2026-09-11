export const ASSISTANT_UNAVAILABLE_MESSAGE = 'The MediConnect assistant is not connected yet.'

export function buildAssistantRequest(message, correlationId) {
  const request = { message: message.trim(), channel: 'text' }
  if (correlationId) request.correlationId = correlationId
  return request
}

export class UnavailableAssistantClient {
  async respond() {
    return {
      status: 'error',
      intent: 'unknown',
      message: ASSISTANT_UNAVAILABLE_MESSAGE,
      suggestedActions: [],
      toolResult: {
        status: 'error',
        code: 'unavailable',
        message: ASSISTANT_UNAVAILABLE_MESSAGE,
      },
    }
  }
}

export const assistantClient = new UnavailableAssistantClient()
