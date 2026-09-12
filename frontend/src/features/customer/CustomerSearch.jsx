import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  getMedicine,
  searchMedicines,
} from '../discovery/discoveryService'

import './CustomerSearch.css'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4 4" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </svg>
  )
}

function medicineSubtitle(medicine) {
  return (
    medicine.genericName ||
    medicine.brandName ||
    medicine.manufacturer ||
    'Medicine'
  )
}

function compositionLabel(detail) {
  if (!detail?.compositions?.length) {
    return medicineSubtitle(detail || {})
  }

  return detail.compositions
    .map(
      (composition) =>
        `${composition.activeIngredient.name} ${composition.strength}${composition.strengthUnit}`,
    )
    .join(' + ')
}

export default function CustomerSearch() {
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const [query, setQuery] = useState('')
  const [medicines, setMedicines] = useState([])
  const [selectedMedicine, setSelectedMedicine] = useState(null)

  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')

      try {
        const result = await searchMedicines(query, {
          page: 1,
          pageSize: 20,
        })

        if (!active) return

        setMedicines(result?.medicines ?? [])
      } catch (requestError) {
        if (!active) return

        setMedicines([])
        setError(
          requestError?.message ||
            'Unable to load medicines. Please try again.',
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }, query.trim() ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query])

  const resultHeading = useMemo(() => {
    if (loading) return 'Searching...'

    if (!medicines.length) return 'No matches yet'

    return `${medicines.length} medicine${medicines.length === 1 ? '' : 's'} found`
  }, [loading, medicines.length])

  async function chooseMedicine(medicine) {
    setSelecting(true)
    setError('')

    try {
      const result = await getMedicine(medicine.id)
      const detail = result?.medicine ?? result

      setSelectedMedicine({
        ...medicine,
        ...detail,
        compositionLabel: compositionLabel(detail),
      })

      setQuery(detail?.name ?? medicine.name)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load medicine details. Please try again.',
      )
    } finally {
      setSelecting(false)
    }
  }

  function chooseRecent(value) {
    setQuery(value)
    setSelectedMedicine(null)

    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  return (
    <div className="customer-search-page">
      <header className="customer-search-header">
        <button
          className="customer-search-back"
          type="button"
          aria-label="Back"
          onClick={() => navigate('/app')}
        >
          <BackIcon />
        </button>

        <div>
          <small>MEDICONNECT</small>
          <strong>Search medicines</strong>
        </div>
      </header>

      <main className="customer-search-main">
        <div className="customer-search-input">
          <SearchIcon />

          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Medicine, generic or brand"
            autoFocus
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedMedicine(null)
            }}
          />

          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                setSelectedMedicine(null)
                inputRef.current?.focus()
              }}
            >
              ×
            </button>
          )}
        </div>

        {!query && (
          <>
            <section className="customer-search-section">
              <div className="customer-search-section-title">
                <span>RECENT</span>
                <h2>Your searches</h2>
              </div>

              <div className="customer-search-recents">
                <button
                  type="button"
                  onClick={() => chooseRecent('Dolo 650')}
                >
                  <ClockIcon />

                  <span>
                    <strong>Dolo 650</strong>
                    <small>Search again</small>
                  </span>

                  <span>↗</span>
                </button>

                <button
                  type="button"
                  onClick={() => chooseRecent('Crocin 650')}
                >
                  <ClockIcon />

                  <span>
                    <strong>Crocin 650</strong>
                    <small>Search again</small>
                  </span>

                  <span>↗</span>
                </button>
              </div>
            </section>

            <section className="customer-search-section">
              <div className="customer-search-section-title">
                <span>QUICK SEARCH</span>
                <h2>Commonly searched</h2>
              </div>

              <div className="customer-search-chips">
                <button
                  type="button"
                  onClick={() => chooseRecent('Paracetamol')}
                >
                  Paracetamol
                </button>

                <button
                  type="button"
                  onClick={() => chooseRecent('Dolo')}
                >
                  Dolo
                </button>

                <button
                  type="button"
                  onClick={() => chooseRecent('Crocin')}
                >
                  Crocin
                </button>
              </div>
            </section>
          </>
        )}

        {query && (
          <section className="customer-search-section customer-search-results">
            <div className="customer-search-section-title">
              <span>RESULTS</span>
              <h2>{resultHeading}</h2>
            </div>

            {error && (
              <div className="customer-search-empty">
                <div>!</div>
                <strong>Couldn’t load medicines</strong>
                <span>{error}</span>
              </div>
            )}

            {!error && !loading && medicines.length > 0 && (
              <div className="customer-medicine-results">
                {medicines.map((medicine) => (
                  <button
                    key={medicine.id}
                    type="button"
                    disabled={selecting}
                    className={
                      selectedMedicine?.id === medicine.id
                        ? 'selected'
                        : ''
                    }
                    onClick={() => chooseMedicine(medicine)}
                  >
                    <div className="customer-result-mark">
                      {medicine.name.charAt(0)}
                    </div>

                    <div className="customer-result-copy">
                      <div>
                        <strong>{medicine.name}</strong>

                        {medicine.requiresPrescription && (
                          <span className="customer-rx-badge">Rx</span>
                        )}
                      </div>

                      <span>{medicineSubtitle(medicine)}</span>

                      {medicine.manufacturer && (
                        <small>{medicine.manufacturer}</small>
                      )}
                    </div>

                    <span className="customer-result-arrow">→</span>
                  </button>
                ))}
              </div>
            )}

            {!error && !loading && medicines.length === 0 && (
              <div className="customer-search-empty">
                <div>?</div>
                <strong>Try another medicine name</strong>
                <span>
                  You can also search using the generic name or manufacturer.
                </span>
              </div>
            )}
          </section>
        )}

        {selectedMedicine && (
          <div className="customer-search-selection">
            <div>
              <small>SELECTED</small>
              <strong>{selectedMedicine.name}</strong>
            </div>

            <button
              type="button"
              onClick={() => {
                navigate(
                  `/app/results?medicineId=${encodeURIComponent(selectedMedicine.id)}`,
                )
              }}
            >
              Find nearby
              <span>→</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
