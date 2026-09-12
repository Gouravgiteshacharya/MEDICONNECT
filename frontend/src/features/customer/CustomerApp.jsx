import { useNavigate } from 'react-router-dom'
import './CustomerApp.css'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4 4" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20H4Z" />
    </svg>
  )
}

function OrdersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c.6-4.1 3-6 7-6s6.4 1.9 7 6" />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 6 2.5 8H4c0-2 2.5-2 2.5-8Z" />
      <path d="M10 20h4" />
    </svg>
  )
}

export default function CustomerApp() {
  const navigate = useNavigate()

  return (
    <div className="customer-app">
      <header className="customer-topbar">
        <button className="customer-location" type="button">
          <span className="customer-location-icon">
            <LocationIcon />
          </span>

          <span>
            <small>Delivering to</small>
            <strong>Choose your location</strong>
          </span>

          <span className="customer-chevron">⌄</span>
        </button>

        <div className="customer-top-actions">
          <button type="button" aria-label="Notifications">
            <BellIcon />
          </button>

          <button className="customer-avatar" type="button" aria-label="Profile">
            G
          </button>
        </div>
      </header>

      <main className="customer-main">
        <section className="customer-greeting">
          <span>MEDICONNECT</span>
          <h1>What medicine do you need?</h1>
        </section>

        <button
          className="customer-search"
          type="button"
          onClick={() => navigate('/app/search')}
        >
          <SearchIcon />

          <span>
            <strong>Search medicines</strong>
            <small>Dolo 650, Crocin, Paracetamol...</small>
          </span>

          <span className="customer-search-arrow">→</span>
        </button>

        <section className="customer-quick-grid">
          <button type="button" className="customer-quick-card prescription">
            <span className="customer-quick-icon">Rx</span>

            <span>
              <strong>Prescription</strong>
              <small>Upload or view</small>
            </span>

            <span>→</span>
          </button>

          <button type="button" className="customer-quick-card orders">
            <span className="customer-quick-icon">02</span>

            <span>
              <strong>Your orders</strong>
              <small>Track and review</small>
            </span>

            <span>→</span>
          </button>
        </section>

        <section className="customer-section">
          <div className="customer-section-heading">
            <div>
              <span>NEAR YOU</span>
              <h2>Medicine availability</h2>
            </div>

            <button type="button">See all</button>
          </div>

          <button
            className="customer-availability-card"
            type="button"
            onClick={() => navigate('/app/search')}
          >
            <div className="customer-medicine-mark">D</div>

            <div className="customer-availability-copy">
              <strong>Dolo 650</strong>
              <span>Paracetamol 650 mg</span>

              <div>
                <i />
                3 pharmacies nearby
              </div>
            </div>

            <span className="customer-card-arrow">→</span>
          </button>
        </section>

        <section className="customer-section customer-recent">
          <div className="customer-section-heading">
            <div>
              <span>RECENT</span>
              <h2>Your searches</h2>
            </div>
          </div>

          <div className="customer-recent-list">
            <button type="button" onClick={() => navigate('/app/search')}>
              <span>
                <strong>Crocin 650</strong>
                <small>Paracetamol 650 mg</small>
              </span>
              <span>→</span>
            </button>

            <button type="button" onClick={() => navigate('/app/search')}>
              <span>
                <strong>Dolo 500</strong>
                <small>Paracetamol 500 mg</small>
              </span>
              <span>→</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
