export const ASSISTANT_UNAVAILABLE_MESSAGE = 'The MediConnect assistant is not connected yet.'

export function buildAssistantRequest(message, correlationId) {
  const request = { message: message.trim(), channel: 'text' }
  if (correlationId) request.correlationId = correlationId
  return request
}

export function createAssistantClient(session) {
  if (!session || typeof session.request !== 'function') {
    throw new TypeError('An authenticated session request boundary is required.')
  }

  return {
    respond(request) {
      return session.request('/assistant/respond', {
        method: 'POST',
        body: request,
      })
    },
  }
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
