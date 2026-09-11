import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS } from './support.constants.js'
import { formatDate, statusClass } from './support.format.js'

export default function SupportList({ tickets, loading, error, onRetry, onCreate, onSelect }) {
  if (loading) {
    return <div className="support-state" role="status">Loading your support requests…</div>
  }

  if (error) {
    return (
      <div className="support-state support-state--error" role="alert">
        <span className="support-state__icon" aria-hidden="true">!</span>
        <h2>Support is temporarily unavailable</h2>
        <p>{error}</p>
        <div className="support-state__actions">
          <button className="button button--primary" type="button" onClick={onRetry}>Try again</button>
          <button className="button button--secondary" type="button" onClick={onCreate}>Prepare a request</button>
        </div>
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="support-state">
        <span className="support-state__icon support-state__icon--calm" aria-hidden="true">✓</span>
        <h2>No support requests yet</h2>
        <p>When you raise a request, you’ll be able to follow its progress here.</p>
        <button className="button button--primary" type="button" onClick={onCreate}>Raise your first request</button>
      </div>
    )
  }

  return (
    <div className="ticket-list" aria-label="Your support requests">
      {tickets.map((ticket) => (
        <button className="ticket-card" type="button" key={ticket.id} onClick={() => onSelect(ticket.id)}>
          <span className="ticket-card__topline">
            <span className={`status-badge status-badge--${statusClass(ticket.status)}`}>
              {SUPPORT_STATUS_LABELS[ticket.status] ?? ticket.status}
            </span>
            <span className="ticket-card__category">{SUPPORT_CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
          </span>
          <strong>{ticket.subject}</strong>
          <span className="ticket-card__meta">
            {ticket.orderId && <span>Order {ticket.orderId}</span>}
            <span>Created {formatDate(ticket.createdAt)}</span>
            <span>Updated {formatDate(ticket.updatedAt)}</span>
          </span>
          <span className="ticket-card__open">View request <span aria-hidden="true">→</span></span>
        </button>
      ))}
    </div>
  )
}
