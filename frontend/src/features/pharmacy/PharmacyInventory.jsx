import { useCallback, useEffect, useState } from 'react'

import {
  INVENTORY_STATUSES,
  labelFromEnum,
  listPharmacyInventory,
  updateInventoryItem,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

const emptyDraft = {
  quantity: '',
  sellingPrice: '',
  availability: '',
}

function formatDate(value) {
  if (!value) return 'Not available'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function draftForItem(item) {
  return {
    quantity: String(item.quantity),
    sellingPrice: item.sellingPrice,
    availability: item.availability,
  }
}

function updatePayload(draft) {
  return {
    quantity: Number(draft.quantity),
    sellingPrice: draft.sellingPrice.trim(),
    availability: draft.availability,
  }
}

export default function PharmacyInventory() {
  const { pharmacyId } = usePharmacyContext()

  const [query, setQuery] = useState('')
  const [availability, setAvailability] = useState('')
  const [inventory, setInventory] = useState([])
  const [pagination, setPagination] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadInventory = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await listPharmacyInventory(pharmacyId, {
        q: query,
        availability,
      })

      const items = result.inventory ?? []
      setInventory(items)
      setPagination(result.pagination ?? null)
      setDrafts(
        Object.fromEntries(items.map((item) => [item.id, draftForItem(item)])),
      )
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load inventory.',
      )
    } finally {
      setLoading(false)
    }
  }, [availability, pharmacyId, query])

  useEffect(() => {
    loadInventory()
  }, [loadInventory])

  function updateDraft(itemId, field, value) {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? emptyDraft),
        [field]: value,
      },
    }))
  }

  async function saveItem(itemId) {
    const draft = drafts[itemId]
    if (!draft) return

    setBusyId(itemId)
    setError('')
    setSuccess('')

    try {
      await updateInventoryItem(pharmacyId, itemId, updatePayload(draft))
      await loadInventory()
      setSuccess('Inventory item updated from the backend.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to update this inventory item.',
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>INVENTORY</span>
          <h1>Manage stock records</h1>
          <p>
            Quantity, selling price, availability, and freshness are loaded from
            pharmacy inventory APIs.
          </p>
        </div>

        <button
          type="button"
          className="pharmacy-secondary-button"
          onClick={loadInventory}
        >
          Refresh
        </button>
      </header>

      <section className="pharmacy-toolbar">
        <input
          value={query}
          placeholder="Search medicine, brand, generic, manufacturer"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={availability}
          onChange={(event) => setAvailability(event.target.value)}
        >
          <option value="">All availability</option>
          {INVENTORY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {labelFromEnum(status)}
            </option>
          ))}
        </select>
        <button type="button" className="pharmacy-button" onClick={loadInventory}>
          Search
        </button>
      </section>

      {error && <div className="pharmacy-feedback error">{error}</div>}
      {success && <div className="pharmacy-feedback">{success}</div>}

      {loading ? (
        <div className="pharmacy-message">
          <strong>Loading inventory...</strong>
        </div>
      ) : inventory.length === 0 ? (
        <section className="pharmacy-blocked">
          <strong>No inventory records found.</strong>
          <p>
            Use the Medicines page to search the shared catalogue and add a
            supported medicine to this pharmacy inventory.
          </p>
        </section>
      ) : (
        <section className="pharmacy-table-wrap">
          <table className="pharmacy-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Status</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Freshness</th>
                <th>Update</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => {
                const draft = drafts[item.id] ?? draftForItem(item)

                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.medicine.name}</strong>
                      <small>
                        {item.medicine.brandName ||
                          item.medicine.genericName ||
                          item.medicine.manufacturer ||
                          'Catalogue medicine'}
                      </small>
                      {item.medicine.requiresPrescription && (
                        <span className="pharmacy-badge warning">Rx</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={draft.availability}
                        onChange={(event) =>
                          updateDraft(
                            item.id,
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
                    </td>
                    <td>
                      <input
                        min="0"
                        type="number"
                        value={draft.quantity}
                        onChange={(event) =>
                          updateDraft(item.id, 'quantity', event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={draft.sellingPrice}
                        onChange={(event) =>
                          updateDraft(
                            item.id,
                            'sellingPrice',
                            event.target.value,
                          )}
                      />
                    </td>
                    <td>
                      <span
                        className={
                          item.freshness === 'STALE'
                            ? 'pharmacy-badge warning'
                            : 'pharmacy-badge'
                        }
                      >
                        {labelFromEnum(item.freshness)}
                      </span>
                      <small>{formatDate(item.lastUpdated)}</small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pharmacy-button"
                        disabled={busyId === item.id}
                        onClick={() => saveItem(item.id)}
                      >
                        {busyId === item.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {pagination && (
        <p className="pharmacy-feedback">
          Showing page {pagination.page} of {pagination.totalPages || 1} ·{' '}
          {pagination.total} records
        </p>
      )}
    </main>
  )
}
