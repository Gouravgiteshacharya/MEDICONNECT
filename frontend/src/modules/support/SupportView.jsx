import { useCallback, useEffect, useRef, useState } from 'react'
import { SUPPORT_ERROR_MESSAGES } from './support.constants.js'
import { supportClient } from './support.client.js'
import SupportList from './SupportList.jsx'
import SupportTicketDetail from './SupportTicketDetail.jsx'
import SupportTicketForm from './SupportTicketForm.jsx'
import './support.css'

export default function SupportView({ client = supportClient }) {
  const [view, setView] = useState({ name: 'list' })
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const headingRef = useRef(null)

  const loadTickets = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await client.listOwnTickets()
    setLoading(false)
    if (result.status === 'success') setTickets(result.data)
    else setError(result.message || SUPPORT_ERROR_MESSAGES[result.code] || SUPPORT_ERROR_MESSAGES.execution_failed)
  }, [client])

  useEffect(() => {
    let active = true
    client.listOwnTickets().then((result) => {
      if (!active) return
      setLoading(false)
      if (result.status === 'success') setTickets(result.data)
      else setError(result.message || SUPPORT_ERROR_MESSAGES[result.code] || SUPPORT_ERROR_MESSAGES.execution_failed)
    })
    return () => { active = false }
  }, [client])
  useEffect(() => { headingRef.current?.focus() }, [view])

  const openCreatedTicket = (ticket) => {
    setTickets((current) => [ticket, ...current.filter(({ id }) => id !== ticket.id)])
    setView({ name: 'detail', ticketId: ticket.id, initialTicket: ticket })
  }

  return (
    <main className="support-page">
      <header className="support-hero">
        <div className="support-brand"><span className="support-brand__mark" aria-hidden="true">M</span><span>MediConnect</span></div>
        <div className="support-hero__content">
          <p className="eyebrow">Customer care</p>
          <h1 tabIndex="-1" ref={headingRef}>{viewTitle(view.name)}</h1>
          <p>Get clear help with orders, deliveries, payments, pharmacies, and prescriptions.</p>
        </div>
      </header>

      <section className="support-workspace" aria-label="Customer support workspace">
        <div className="workspace-toolbar">
          {view.name === 'list' ? (
            <>
              <div><p className="eyebrow eyebrow--dark">Your requests</p><h2>Support history</h2></div>
              <button className="button button--primary" type="button" onClick={() => setView({ name: 'create' })}>Raise a request</button>
            </>
          ) : (
            <button className="back-button" type="button" onClick={() => setView({ name: 'list' })}>Back to requests</button>
          )}
        </div>

        {view.name === 'list' && <SupportList tickets={tickets} loading={loading} error={error} onRetry={loadTickets} onCreate={() => setView({ name: 'create' })} onSelect={(ticketId) => setView({ name: 'detail', ticketId })} />}
        {view.name === 'create' && <SupportTicketForm client={client} onCancel={() => setView({ name: 'list' })} onCreated={openCreatedTicket} />}
        {view.name === 'detail' && <SupportTicketDetail client={client} ticketId={view.ticketId} initialTicket={view.initialTicket} onBack={() => setView({ name: 'list' })} />}
      </section>

      <footer className="support-footer"><span>Your medical decisions stay with qualified healthcare professionals.</span><span>Support handles your MediConnect experience.</span></footer>
    </main>
  )
}

function viewTitle(view) {
  if (view === 'create') return 'Tell us what went wrong'
  if (view === 'detail') return 'Your support request'
  return 'How can we help?'
}
