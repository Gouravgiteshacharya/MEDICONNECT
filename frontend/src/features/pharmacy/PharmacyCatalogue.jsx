import { useCallback, useEffect, useState } from 'react'

import {
  createInventoryItem,
  INVENTORY_STATUSES,
  labelFromEnum,
  searchCatalogueMedicines,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

const defaultAddForm = {
  quantity: '1',
  sellingPrice: '',
  availability: 'AVAILABLE',
}

export default function PharmacyCatalogue() {
  const { pharmacyId } = usePharmacyContext()

  const [query, setQuery] = useState('')
  const [medicines, setMedicines] = useState([])
  const [addForms, setAddForms] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadMedicines = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await searchCatalogueMedicines(query, { pageSize: 20 })
      setMedicines(result.medicines ?? [])
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to search medicines.',
      )
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadMedicines()
  }, [loadMedicines])

  function updateAddForm(medicineId, field, value) {
    setAddForms((current) => ({
      ...current,
      [medicineId]: {
        ...defaultAddForm,
        ...(current[medicineId] ?? {}),
        [field]: value,
      },
    }))
  }

  async function addMedicine(medicine) {
    const form = {
      ...defaultAddForm,
      ...(addForms[medicine.id] ?? {}),
    }

    setBusyId(medicine.id)
    setError('')
    setSuccess('')

    try {
      await createInventoryItem(pharmacyId, {
        medicineId: medicine.id,
        quantity: Number(form.quantity),
        sellingPrice: form.sellingPrice.trim(),
        availability: form.availability,
      })
      setSuccess(`${medicine.name} added to inventory.`)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to add this medicine to inventory.',
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>MEDICINES</span>
          <h1>Catalogue search</h1>
          <p>
            Search the backend medicine catalogue. Adding to inventory uses the
            pharmacy inventory API and does not create new master records.
          </p>
        </div>
      </header>

      <section className="pharmacy-toolbar">
        <input
          value={query}
          placeholder="Search medicine, brand, generic, manufacturer"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="pharmacy-button" onClick={loadMedicines}>
          Search
        </button>
      </section>

      {error && <div className="pharmacy-feedback error">{error}</div>}
      {success && <div className="pharmacy-feedback">{success}</div>}

      {loading ? (
        <div className="pharmacy-message">
          <strong>Loading medicines...</strong>
        </div>
      ) : medicines.length === 0 ? (
        <section className="pharmacy-blocked">
          <strong>No medicines found.</strong>
          <p>Try searching by medicine, brand, generic name, or manufacturer.</p>
        </section>
      ) : (
        <section className="pharmacy-table-wrap">
          <table className="pharmacy-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Manufacturer</th>
                <th>Rx</th>
                <th>Add to inventory</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((medicine) => {
                const form = {
                  ...defaultAddForm,
                  ...(addForms[medicine.id] ?? {}),
                }

                return (
                  <tr key={medicine.id}>
                    <td>
                      <strong>{medicine.name}</strong>
                      <small>
                        {medicine.genericName ||
                          medicine.brandName ||
                          medicine.description ||
                          'Catalogue medicine'}
                      </small>
                    </td>
                    <td>{medicine.manufacturer || 'Not listed'}</td>
                    <td>
                      {medicine.requiresPrescription ? (
                        <span className="pharmacy-badge warning">Rx</span>
                      ) : (
                        <span className="pharmacy-badge">No</span>
                      )}
                    </td>
                    <td>
                      <div className="pharmacy-inline-form">
                        <label>
                          <span>Qty</span>
                          <input
                            required
                            min="0"
                            type="number"
                            value={form.quantity}
                            onChange={(event) =>
                              updateAddForm(
                                medicine.id,
                                'quantity',
                                event.target.value,
                              )}
                          />
                        </label>
                        <label>
                          <span>Price</span>
                          <input
                            required
                            inputMode="decimal"
                            placeholder="49.50"
                            value={form.sellingPrice}
                            onChange={(event) =>
                              updateAddForm(
                                medicine.id,
                                'sellingPrice',
                                event.target.value,
                              )}
                          />
                        </label>
                        <label>
                          <span>Status</span>
                          <select
                            value={form.availability}
                            onChange={(event) =>
                              updateAddForm(
                                medicine.id,
                                'availability',
                                event.target.value,
                              )}
                          >
                            {INVENTORY_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {labelFromEnum(status)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="pharmacy-button"
                          disabled={busyId === medicine.id}
                          onClick={() => addMedicine(medicine)}
                        >
                          {busyId === medicine.id ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
