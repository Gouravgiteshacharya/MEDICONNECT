import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './CustomerSearch.css'

const medicines = [
  {
    name: 'Dolo 650',
    composition: 'Paracetamol 650 mg',
    form: 'Tablet',
    rx: false,
    nearby: 3,
  },
  {
    name: 'Dolo 500',
    composition: 'Paracetamol 500 mg',
    form: 'Tablet',
    rx: false,
    nearby: 4,
  },
  {
    name: 'Crocin 650',
    composition: 'Paracetamol 650 mg',
    form: 'Tablet',
    rx: false,
    nearby: 2,
  },
  {
    name: 'Azithral 500',
    composition: 'Azithromycin 500 mg',
    form: 'Tablet',
    rx: true,
    nearby: 2,
  },
]

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

export default function CustomerSearch() {
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const [query, setQuery] = useState('')
  const [selectedMedicine, setSelectedMedicine] = useState(null)

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) {
      return medicines
    }

    return medicines.filter((medicine) => {
      return (
        medicine.name.toLowerCase().includes(normalized) ||
        medicine.composition.toLowerCase().includes(normalized)
      )
    })
  }, [query])

  function chooseMedicine(medicine) {
    setSelectedMedicine(medicine)
    setQuery(medicine.name)
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
            placeholder="Medicine or composition"
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
                    <small>Paracetamol 650 mg</small>
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
                    <small>Paracetamol 650 mg</small>
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

              <h2>
                {results.length
                  ? `${results.length} medicine${results.length === 1 ? '' : 's'} found`
                  : 'No matches yet'}
              </h2>
            </div>

            {results.length > 0 ? (
              <div className="customer-medicine-results">
                {results.map((medicine) => (
                  <button
                    key={medicine.name}
                    type="button"
                    className={
                      selectedMedicine?.name === medicine.name
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

                        {medicine.rx && (
                          <span className="customer-rx-badge">Rx</span>
                        )}
                      </div>

                      <span>{medicine.composition}</span>

                      <small>
                        {medicine.form} · {medicine.nearby}{' '}
                        {medicine.nearby === 1 ? 'pharmacy' : 'pharmacies'} nearby
                      </small>
                    </div>

                    <span className="customer-result-arrow">→</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="customer-search-empty">
                <div>?</div>

                <strong>Try another medicine name</strong>

                <span>
                  You can also search using the composition.
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
                  `/app/results?medicine=${encodeURIComponent(selectedMedicine.name)}&composition=${encodeURIComponent(selectedMedicine.composition)}`,
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
