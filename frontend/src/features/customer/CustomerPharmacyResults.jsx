import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import './CustomerPharmacyResults.css'

const pharmacies = [
  {
    id: 1,
    name: 'Sharma Medical Store',
    distance: '850 m',
    distanceValue: 0.85,
    rating: 4.8,
    price: 32,
    availability: 'In stock',
    freshness: 'Updated 6 min ago',
    status: 'stock',
    pickup: 'Pickup available',
    delivery: 'Delivery available',
    verified: true,
  },
  {
    id: 2,
    name: 'City Care Pharmacy',
    distance: '1.2 km',
    distanceValue: 1.2,
    rating: 4.7,
    price: 30,
    availability: 'Confirmed',
    freshness: 'Confirmed 12 min ago',
    status: 'confirmed',
    pickup: 'Pickup available',
    delivery: 'Delivery available',
    verified: true,
  },
  {
    id: 3,
    name: 'Health Point Pharmacy',
    distance: '600 m',
    distanceValue: 0.6,
    rating: 4.5,
    price: 31,
    availability: 'Checking',
    freshness: 'Awaiting pharmacy confirmation',
    status: 'checking',
    pickup: 'Pickup pending',
    delivery: 'Delivery pending',
    verified: true,
  },
]

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

export default function CustomerPharmacyResults() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const medicine = searchParams.get('medicine') || 'Dolo 650'
  const composition = searchParams.get('composition') || 'Paracetamol 650 mg'

  const [sortBy, setSortBy] = useState('Recommended')

  const sortedPharmacies = useMemo(() => {
    const items = [...pharmacies]

    if (sortBy === 'Nearest') {
      return items.sort((a, b) => a.distanceValue - b.distanceValue)
    }

    if (sortBy === 'Lowest price') {
      return items.sort((a, b) => a.price - b.price)
    }

    return items
  }, [sortBy])

  return (
    <div className="customer-results-page">
      <header className="customer-results-header">
        <button
          type="button"
          className="customer-results-back"
          aria-label="Back"
          onClick={() => navigate('/app/search')}
        >
          <BackIcon />
        </button>

        <div>
          <small>NEARBY AVAILABILITY</small>
          <strong>{medicine}</strong>
        </div>
      </header>

      <main className="customer-results-main">
        <section className="customer-results-medicine">
          <div className="customer-results-medicine-mark">
            {medicine.charAt(0)}
          </div>

          <div>
            <h1>{medicine}</h1>
            <p>{composition}</p>

            <span>
              <i />
              {pharmacies.length} pharmacies nearby
            </span>
          </div>
        </section>

        <section className="customer-results-controls">
          {['Recommended', 'Nearest', 'Lowest price'].map((option) => (
            <button
              key={option}
              type="button"
              className={sortBy === option ? 'active' : ''}
              onClick={() => setSortBy(option)}
            >
              {option}
            </button>
          ))}
        </section>

        <section className="customer-pharmacy-list">
          {sortedPharmacies.map((pharmacy) => (
            <article
              key={pharmacy.id}
              className={`customer-pharmacy-card ${pharmacy.status}`}
            >
              <div className="customer-pharmacy-top">
                <div>
                  <div className="customer-pharmacy-name-row">
                    <h2>{pharmacy.name}</h2>

                    {pharmacy.verified && (
                      <span className="customer-pharmacy-verified">
                        <CheckIcon />
                        Verified
                      </span>
                    )}
                  </div>

                  <p>
                    {pharmacy.distance} away · ★ {pharmacy.rating}
                  </p>
                </div>

                <strong className="customer-pharmacy-price">
                  ₹{pharmacy.price}
                </strong>
              </div>

              <div className="customer-pharmacy-status-row">
                <div className={`customer-stock-status ${pharmacy.status}`}>
                  <i />
                  <span>{pharmacy.availability}</span>
                </div>

                <small>{pharmacy.freshness}</small>
              </div>

              <div className="customer-pharmacy-options">
                <span>{pharmacy.pickup}</span>
                <span>{pharmacy.delivery}</span>
              </div>

              <button
                type="button"
                className="customer-pharmacy-choose"
                disabled={pharmacy.status === 'checking'}
                onClick={() => {
                  navigate(
                    `/app/pharmacy/${pharmacy.id}?medicine=${encodeURIComponent(medicine)}&composition=${encodeURIComponent(composition)}`,
                  )
                }}
              >
                {pharmacy.status === 'checking'
                  ? 'Waiting for confirmation'
                  : 'Choose pharmacy'}
                <span>→</span>
              </button>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
