import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import {
  getMedicine,
  getMedicineAvailability,
} from '../discovery/discoveryService'
import CustomerDestinationSelector from './CustomerDestinationSelector'
import { useCustomerDestination } from './CustomerDestinationContext'

import './CustomerPharmacyResults.css'

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function compositionLabel(medicine) {
  if (!medicine?.compositions?.length) {
    return medicine?.genericName || medicine?.brandName || ''
  }

  return medicine.compositions
    .map(
      (composition) =>
        `${composition.activeIngredient.name} ${composition.strength}${composition.strengthUnit}`,
    )
    .join(' + ')
}

function distanceLabel(distanceKm) {
  const value = Number(distanceKm)

  if (!Number.isFinite(value)) return ''

  if (value < 1) {
    return `${Math.round(value * 1000)} m`
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} km`
}

function priceLabel(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) return '—'

  return `₹${number.toFixed(number % 1 === 0 ? 0 : 2)}`
}

function freshnessLabel(item) {
  const updated = new Date(item.lastUpdated)

  if (Number.isNaN(updated.getTime())) {
    return item.freshness === 'FRESH'
      ? 'Inventory recently updated'
      : 'Inventory may be outdated'
  }

  const differenceMinutes = Math.max(
    0,
    Math.round((Date.now() - updated.getTime()) / 60000),
  )

  if (differenceMinutes < 1) {
    return 'Updated just now'
  }

  if (differenceMinutes < 60) {
    return `Updated ${differenceMinutes} min ago`
  }

  const hours = Math.round(differenceMinutes / 60)

  if (hours < 24) {
    return `Updated ${hours} hr${hours === 1 ? '' : 's'} ago`
  }

  return item.freshness === 'FRESH'
    ? 'Inventory updated recently'
    : 'Inventory update is old'
}

function availabilityLabel(status) {
  if (status === 'LOW_STOCK') return 'Low stock'
  if (status === 'AVAILABLE') return 'In stock'

  return status
}

export default function CustomerPharmacyResults() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const medicineId = searchParams.get('medicineId')
  const { destination } = useCustomerDestination()

  const [medicine, setMedicine] = useState(null)
  const [availability, setAvailability] = useState([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [sortBy, setSortBy] = useState('Recommended')

  useEffect(() => {
    if (!medicineId) {
      setError('No medicine was selected.')
      return
    }

    let active = true

    async function loadMedicine() {
      try {
        const result = await getMedicine(medicineId)

        if (!active) return

        setMedicine(result?.medicine ?? result)
      } catch (requestError) {
        if (!active) return

        setError(
          requestError?.message ||
            'Unable to load medicine details.',
        )
      }
    }

    loadMedicine()

    return () => {
      active = false
    }
  }, [medicineId])

  useEffect(() => {
    if (!medicineId || !destination) return

    let active = true

    async function loadAvailability() {
      setLoading(true)
      setError('')

      try {
        const result = await getMedicineAvailability(
          medicineId,
          destination,
          {
            radiusKm: 5,
            page: 1,
            pageSize: 50,
          },
        )

        if (!active) return

        setAvailability(result?.availability ?? [])

        if (result?.medicine) {
          setMedicine((current) => ({
            ...current,
            ...result.medicine,
          }))
        }
      } catch (requestError) {
        if (!active) return

        setAvailability([])
        setError(
          requestError?.message ||
            'Unable to check nearby pharmacy availability.',
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadAvailability()

    return () => {
      active = false
    }
  }, [medicineId, destination])

  const sortedPharmacies = useMemo(() => {
    const items = [...availability]

    if (sortBy === 'Nearest') {
      return items.sort(
        (a, b) => Number(a.distanceKm) - Number(b.distanceKm),
      )
    }

    if (sortBy === 'Lowest price') {
      return items.sort(
        (a, b) => Number(a.sellingPrice) - Number(b.sellingPrice),
      )
    }

    /*
      Backend already returns availability sorted nearest-first.
      Recommended keeps the backend ordering for now.
    */
    return items
  }, [availability, sortBy])

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
          <strong>{medicine?.name || 'Medicine'}</strong>
        </div>
        <CustomerDestinationSelector compact />
      </header>

      <main className="customer-results-main">
        <section className="customer-results-medicine">
          <div className="customer-results-medicine-mark">
            {medicine?.name?.charAt(0) || 'M'}
          </div>

          <div>
            <h1>{medicine?.name || 'Medicine'}</h1>

            <p>
              {compositionLabel(medicine) ||
                medicine?.manufacturer ||
                'Medicine details'}
            </p>

            {medicine?.requiresPrescription && (
              <span>
                Prescription required
              </span>
            )}

            {destination && (
              <span>
                <i />
                {availability.length}{' '}
                {availability.length === 1
                  ? 'pharmacy nearby'
                  : 'pharmacies nearby'}
              </span>
            )}
          </div>
        </section>

        {medicineId && !destination && (
          <section className="customer-location-gate">
            <div className="customer-location-gate-mark">⌖</div>

            <h2>Choose where to search</h2>

            <p>
              Select your current location or a delivery-ready saved address.
              Pharmacy discovery uses that destination, even when it is in a
              different city from you.
            </p>

            <CustomerDestinationSelector />
          </section>
        )}

        {destination && (
          <section className="customer-results-geography">
            <small>AVAILABLE NEAR</small>
            <strong>{destination.label}{destination.city ? ` — ${destination.city}` : ''}</strong>
            <span>{destination.readableAddress}</span>
          </section>
        )}

        {destination && (
          <section className="customer-results-controls">
            {['Recommended', 'Nearest', 'Lowest price'].map(
              (option) => (
                <button
                  key={option}
                  type="button"
                  className={sortBy === option ? 'active' : ''}
                  onClick={() => setSortBy(option)}
                >
                  {option}
                </button>
              ),
            )}
          </section>
        )}

        {error && (
          <section className="customer-results-message">
            <strong>Something needs attention</strong>
            <span>{error}</span>

          </section>
        )}

        {destination && loading && (
          <section className="customer-results-message">
            <strong>Checking nearby pharmacies...</strong>
            <span>
              Looking at current pharmacy inventory.
            </span>
          </section>
        )}

        {destination && !loading && !error && (
          <section className="customer-pharmacy-list">
            {sortedPharmacies.length === 0 && (
              <div className="customer-results-message">
                <strong>No nearby stock found</strong>
                <span>
                  No pharmacy within 5 km currently reports this medicine
                  in stock.
                </span>
              </div>
            )}

            {sortedPharmacies.map((item) => (
              <article
                key={item.pharmacy.id}
                className={`customer-pharmacy-card ${
                  item.availability === 'LOW_STOCK'
                    ? 'checking'
                    : 'stock'
                }`}
              >
                <div className="customer-pharmacy-top">
                  <div>
                    <div className="customer-pharmacy-name-row">
                      <h2>{item.pharmacy.name}</h2>

                      <span className="customer-pharmacy-verified">
                        Stock checked
                      </span>
                    </div>

                    <p>
                      {distanceLabel(item.distanceKm)}
                      {item.pharmacy.city
                        ? ` away · ${item.pharmacy.city}`
                        : ' away'}
                    </p>
                    <p>{[item.pharmacy.addressLine1, item.pharmacy.addressLine2].filter(Boolean).join(', ')}</p>
                  </div>

                  <strong className="customer-pharmacy-price">
                    {priceLabel(item.sellingPrice)}
                  </strong>
                </div>

                <div className="customer-pharmacy-status-row">
                  <div
                    className={`customer-stock-status ${
                      item.availability === 'LOW_STOCK'
                        ? 'checking'
                        : 'stock'
                    }`}
                  >
                    <i />

                    <span>
                      {availabilityLabel(item.availability)}
                    </span>
                  </div>

                  <small>{freshnessLabel(item)}</small>
                </div>

                <div className="customer-pharmacy-options">
                  <span>
                    {item.quantity} unit
                    {item.quantity === 1 ? '' : 's'} reported
                  </span>

                  <span>
                    {item.freshness === 'FRESH'
                      ? 'Fresh inventory data'
                      : 'Inventory data may be old'}
                  </span>
                </div>

                <button
                  type="button"
                  className="customer-pharmacy-choose"
                  onClick={() => {
                    navigate(
                      `/app/pharmacy/${item.pharmacy.id}?medicineId=${encodeURIComponent(medicineId)}`,
                    )
                  }}
                >
                  Choose pharmacy
                  <span>→</span>
                </button>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
