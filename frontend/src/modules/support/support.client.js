const unavailable = () => Promise.resolve({
  status: 'error',
  code: 'unavailable',
  message: 'Support services are not connected yet.',
})

export class UnavailableSupportClient {
  createTicket(_input) {
    return unavailable()
  }

  listOwnTickets() {
    return unavailable()
  }

  getOwnTicket(_ticketId) {
    return unavailable()
  }

  addMessage(_ticketId, _message) {
    return unavailable()
  }
}

export const supportClient = Object.freeze(new UnavailableSupportClient())
