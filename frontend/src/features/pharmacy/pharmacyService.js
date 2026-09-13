import { apiRequest } from '../../services/apiClient'

export const INVENTORY_STATUSES = [
  'AVAILABLE',
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'UNAVAILABLE',
]

export function labelFromEnum(value) {
  if (!value) return 'Not set'

  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function getPharmacyDashboard(pharmacyId) {
  return apiRequest(`/pharmacies/${pharmacyId}/dashboard`)
}

export async function getPharmacyProfile(pharmacyId) {
  const result = await apiRequest(`/pharmacies/${pharmacyId}/profile`)

  return result.pharmacy ?? result
}

export async function updatePharmacyProfile(pharmacyId, body) {
  const result = await apiRequest(`/pharmacies/${pharmacyId}/profile`, {
    method: 'PATCH',
    body,
  })

  return result.pharmacy ?? result
}

export async function listPharmacyInventory(pharmacyId, options = {}) {
  const {
    q,
    availability,
    page = 1,
    pageSize = 20,
  } = options

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })

  if (q?.trim()) params.set('q', q.trim())
  if (availability) params.set('availability', availability)

  return apiRequest(`/pharmacies/${pharmacyId}/inventory?${params.toString()}`)
}

export async function createInventoryItem(pharmacyId, body) {
  const result = await apiRequest(`/pharmacies/${pharmacyId}/inventory`, {
    method: 'POST',
    body,
  })

  return result.inventoryItem ?? result
}

export async function updateInventoryItem(pharmacyId, inventoryId, body) {
  const result = await apiRequest(
    `/pharmacies/${pharmacyId}/inventory/${inventoryId}`,
    {
      method: 'PATCH',
      body,
    },
  )

  return result.inventoryItem ?? result
}

export async function searchCatalogueMedicines(query, options = {}) {
  const {
    page = 1,
    pageSize = 20,
  } = options

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })

  if (query?.trim()) params.set('q', query.trim())

  return apiRequest(`/medicines?${params.toString()}`, {
    auth: false,
  })
}

export async function decidePharmacyOrder(pharmacyId, orderId, decision) {
  const result = await apiRequest(
    `/pharmacies/${pharmacyId}/orders/${orderId}/decision`,
    {
      method: 'PATCH',
      body: { decision },
    },
  )

  return result.order ?? result
}

export async function reviewPharmacyPrescription(
  pharmacyId,
  prescriptionId,
  body,
) {
  const result = await apiRequest(
    `/pharmacies/${pharmacyId}/prescriptions/${prescriptionId}/review`,
    {
      method: 'PATCH',
      body,
    },
  )

  return result.prescription ?? result
}
