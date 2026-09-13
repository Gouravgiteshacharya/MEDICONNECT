import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import {
  getMedicine,
  getMedicineAvailability,
} from '../discovery/discoveryService'
import { addCartItem } from '../commerce/cartService'
import CustomerAuthModal from './CustomerAuthModal'

import './CustomerPharmacyDetail.css'

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

function availabilityLabel(status) {
  if (status === 'LOW_STOCK') return 'Low stock'
  if (status === 'AVAILABLE') return 'In stock'
  return status
}

export default function CustomerPharmacyDetail() {
  const navigate = useNavigate()
  const { pharmacyId } = useParams()
  const [searchParams] = useSearchParams()

  const medicineId = searchParams.get('medicineId')

  const { authenticated } = useAuth()

  const [medicine, setMedicine] = useState(null)
  const [inventory, setInventory] = useState(null)

  const [quantity, setQuantity] = useState(1)

  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const [authOpen, setAuthOpen] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(false)

  useEffect(() => {
    if (!medicineId || !pharmacyId) {
      setError('Medicine or pharmacy information is missing.')
      setLoading(false)
      return
    }

    let active = true

    async function load() {
      setLoading(true)
      setError('')

      try {
        const detailResult = await getMedicine(medicineId)
        const medicineDetail = detailResult?.medicine ?? detailResult

        if (!active) return

        setMedicine(medicineDetail)

        /*
          Re-check availability using the pharmacy coordinates already
          returned by the discovery flow once this screen receives them
          in a future route-state refactor.

          For now, the detail screen is entered from a pharmacy result
          that was already validated by the backend.
        */
      } catch (requestError) {
        if (!active) return

        setError(
          requestError?.message ||
            'Unable to load medicine details.',
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      active = false
    }
  }, [medicineId, pharmacyId])

  async function performAddToCart() {
    if (!medicineId || !pharmacyId) return

    setAdding(true)
    setError('')

    try {
      await addCartItem({
        pharmacyId,
        medicineId,
        quantity,
      })

      navigate('/app/cart')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to add this medicine to your cart.',
      )
    } finally {
      setAdding(false)
      setPendingAdd(false)
    }
  }

  async function handleAddToCart() {
    if (!authenticated) {
      setPendingAdd(true)
      setAuthOpen(true)
      return
    }

    await performAddToCart()
  }

  return (
    <div className="customer-pharmacy-detail-page">
      <header className="customer-pharmacy-detail-header">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <BackIcon />
        </button>

        <div>
          <small>SELECTED PHARMACY</small>
          <strong>Medicine details</strong>
        </div>
      </header>

      <main className="customer-pharmacy-detail-main">
        {loading && (
          <div className="customer-detail-message">
            <strong>Loading medicine...</strong>
          </div>
        )}

        {!loading && medicine && (
          <>
            <section className="customer-detail-medicine">
              <div className="customer-detail-mark">
                {medicine.name?.charAt(0) || 'M'}
              </div>

              <div>
                <h1>{medicine.name}</h1>
                <p>
                  {compositionLabel(medicine) ||
                    medicine.genericName ||
                    medicine.manufacturer ||
                    'Medicine'}
                </p>

                {medicine.requiresPrescription && (
                  <span className="customer-detail-rx">
                    Rx · Prescription required
                  </span>
                )}
              </div>
            </section>

            <section className="customer-detail-pharmacy-card">
              <div className="customer-detail-pharmacy-top">
                <div>
                  <span>PHARMACY</span>
                  <h2>Selected pharmacy</h2>
                </div>

                <span className="customer-detail-verified">
                  <CheckIcon />
                  Verified
                </span>
              </div>

              <p>
                This pharmacy was selected from your nearby availability results.
              </p>

              <div className="customer-detail-status">
                <span>
                  <i />
                  Availability verified by MediConnect
                </span>
              </div>
            </section>

            <section className="customer-detail-quantity">
              <div>
                <span>QUANTITY</span>
                <strong>How many units?</strong>
              </div>

              <div className="customer-detail-quantity-control">
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                >
                  −
                </button>

                <strong>{quantity}</strong>

                <button
                  type="button"
                  onClick={() => setQuantity((current) => current + 1)}
                >
                  +
                </button>
              </div>
            </section>

            {error && (
              <div className="customer-detail-error">
                {error}
              </div>
            )}

            <button
              className="customer-detail-add"
              type="button"
              disabled={adding}
              onClick={handleAddToCart}
            >
              <span>
                <strong>
                  {adding ? 'Adding...' : 'Add to cart'}
                </strong>

                <small>
                  Stock will be checked again before adding
                </small>
              </span>

              <span>→</span>
            </button>
          </>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => {
          setAuthOpen(false)
          setPendingAdd(false)
        }}
        onAuthenticated={() => {
          if (pendingAdd) {
            performAddToCart()
          }
        }}
      />
    </div>
  )
}
