import { useCallback, useEffect, useState } from 'react'
import { SUPPORT_CATEGORY_LABELS, SUPPORT_ERROR_MESSAGES, SUPPORT_STATUS_LABELS } from './support.constants.js'
import { formatDate, statusClass } from './support.format.js'
import SupportMessageThread from './SupportMessageThread.jsx'
import { validateSupportMessage } from './support.validation.js'

export default function SupportTicketDetail({ client, ticketId, initialTicket, onBack }) {
  const [ticket, setTicket] = useState(initialTicket ?? null)
  const [loading, setLoading] = useState(!initialTicket)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState('')
  const [sending, setSending] = useState(false)

  const loadTicket = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await client.getOwnTicket(ticketId)
    setLoading(false)
    if (result.status === 'success') setTicket(result.data)
    else setError(result.message || SUPPORT_ERROR_MESSAGES[result.code] || SUPPORT_ERROR_MESSAGES.execution_failed)
  }, [client, ticketId])

  useEffect(() => {
    if (initialTicket) return undefined
    let active = true
    client.getOwnTicket(ticketId).then((result) => {
      if (!active) return
      setLoading(false)
      if (result.status === 'success') setTicket(result.data)
      else setError(result.message || SUPPORT_ERROR_MESSAGES[result.code] || SUPPORT_ERROR_MESSAGES.execution_failed)
    })
    return () => { active = false }
  }, [client, initialTicket, ticketId])

  const sendMessage = async (event) => {
    event.preventDefault()
    const validation = validateSupportMessage(message)
    if (!validation.valid) {
      setMessageError(validation.error)
      return
    }

    setSending(true)
    setMessageError('')
    const result = await client.addMessage(ticketId, validation.value)
    setSending(false)
    if (result.status === 'success') {
      setTicket((current) => ({ ...current, messages: [...(current.messages ?? []), result.data] }))
      setMessage('')
    } else {
      setMessageError(result.message || SUPPORT_ERROR_MESSAGES[result.code] || SUPPORT_ERROR_MESSAGES.execution_failed)
    }
  }

  if (loading) return <div className="support-state" role="status">Loading support request...</div>
  if (error || !ticket) {
    return (
      <div className="support-state support-state--error" role="alert">
        <h2>We couldn't open this request</h2>
        <p>{error || SUPPORT_ERROR_MESSAGES.not_found}</p>
        <div className="support-state__actions">
          <button className="button button--primary" type="button" onClick={loadTicket}>Try again</button>
          <button className="button button--secondary" type="button" onClick={onBack}>Back to requests</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ticket-detail">
      <div className="ticket-detail__summary">
        <div className="ticket-detail__badges">
          <span className={`status-badge status-badge--${statusClass(ticket.status)}`}>{SUPPORT_STATUS_LABELS[ticket.status] ?? ticket.status}</span>
          <span className="category-badge">{SUPPORT_CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
        </div>
        <h2>{ticket.subject}</h2>
        <dl className="ticket-metadata">
          {ticket.orderId && <><dt>Order</dt><dd>{ticket.orderId}</dd></>}
          <dt>Created</dt><dd>{formatDate(ticket.createdAt)}</dd>
          <dt>Updated</dt><dd>{formatDate(ticket.updatedAt)}</dd>
          {ticket.resolvedAt && <><dt>Resolved</dt><dd>{formatDate(ticket.resolvedAt)}</dd></>}
        </dl>
        <div className="ticket-description">
          <h3>Request details</h3>
          <p>{ticket.description}</p>
        </div>
      </div>

      <section className="conversation" aria-labelledby="conversation-heading">
        <h3 id="conversation-heading">Conversation</h3>
        <SupportMessageThread messages={ticket.messages} />
        <form className="message-composer" onSubmit={sendMessage} noValidate>
          <label htmlFor="support-message">Add a message</label>
          <textarea id="support-message" value={message} onChange={(event) => { setMessage(event.target.value); setMessageError('') }} rows="4" maxLength="2000" aria-invalid={Boolean(messageError)} aria-describedby="support-message-help support-message-error" />
          <span id="support-message-help" className="field-help">{message.length}/2000 characters</span>
          {messageError && <span id="support-message-error" className="field-error" aria-live="polite">{messageError}</span>}
          <button className="button button--primary" type="submit" disabled={sending}>{sending ? 'Sending...' : 'Send message'}</button>
        </form>
      </section>
    </div>
  )
}
