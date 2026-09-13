const blockedCopy = {
  pharmacies: {
    label: 'PHARMACY OPERATIONS',
    title: 'Pharmacy visibility blocked',
    body: 'The backend exposes public pharmacy detail by ID and pharmacy-staff operational profile by pharmacy ID, but not an admin pharmacy list or admin mutation endpoints.',
    needed: 'Needed: admin pharmacy list/detail APIs with explicit fields and any real verification or status actions.',
  },
  inventory: {
    label: 'INVENTORY OPERATIONS',
    title: 'Cross-pharmacy inventory blocked',
    body: 'Inventory APIs are scoped to active pharmacy staff membership. There is no admin cross-pharmacy inventory monitoring route.',
    needed: 'Needed: admin inventory list filtered by pharmacy, medicine, availability, and freshness.',
  },
  riders: {
    label: 'RIDER OPERATIONS',
    title: 'Delivery partner visibility blocked',
    body: 'Rider APIs currently expose self-service rider profile, availability, location, and dashboard for delivery partners only.',
    needed: 'Needed: admin delivery-partner list/detail APIs with real availability and assignment state.',
  },
  support: {
    label: 'SUPPORT OPERATIONS',
    title: 'Support queue blocked',
    body: 'SupportTicket and SupportMessage models exist in Prisma, but no support ticket or support message routes are mounted.',
    needed: 'Needed: admin support ticket list/detail/message/status APIs.',
  },
  supportDetail: {
    label: 'SUPPORT DETAIL',
    title: 'Ticket detail blocked',
    body: 'Ticket detail cannot be loaded because no admin support ticket route exists.',
    needed: 'Needed: support ticket detail API including messages and allowed status transitions.',
  },
  risk: {
    label: 'RISK OPERATIONS',
    title: 'Risk queue blocked',
    body: 'RiskAssessment is modeled in Prisma, but no risk assessment list/detail/review routes are mounted.',
    needed: 'Needed: admin risk list/detail APIs with stored score, signals, status, and review actions.',
  },
  riskDetail: {
    label: 'RISK DETAIL',
    title: 'Risk detail blocked',
    body: 'Risk detail cannot be loaded because no admin risk assessment route exists.',
    needed: 'Needed: risk detail API using stored backend signals only.',
  },
  metrics: {
    label: 'METRICS',
    title: 'Aggregate metrics blocked',
    body: 'There is no admin dashboard or aggregate metrics endpoint for operations-wide counts.',
    needed: 'Needed: real aggregate endpoints or efficient list endpoints that can be safely summarized.',
  },
}

export default function AdminBlockedPage({ type = 'metrics', referenceId }) {
  const copy = blockedCopy[type] ?? blockedCopy.metrics

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <span>{copy.label}</span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </div>
      </header>

      <section className="admin-blocked">
        <strong>Blocked by backend API coverage.</strong>
        {referenceId && <p>Reference: {referenceId}</p>}
        <p>{copy.needed}</p>
      </section>
    </main>
  )
}
