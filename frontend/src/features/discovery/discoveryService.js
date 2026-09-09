import { apiRequest } from '../../services/apiClient'

export async function searchMedicines(query, options = {}) {
  const {
    page = 1,
    pageSize = 20,
  } = options

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })

  const normalizedQuery = query?.trim()

  if (normalizedQuery) {
    params.set('q', normalizedQuery)
  }

  return apiRequest(`/medicines?${params.toString()}`, {
    auth: false,
  })
}

export async function getMedicine(medicineId) {
  return apiRequest(`/medicines/${medicineId}`, {
    auth: false,
  })
}

export async function getMedicineAvailability(
  medicineId,
  location,
  options = {},
) {
  const {
    radiusKm = 5,
    page = 1,
    pageSize = 20,
  } = options

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    radiusKm: String(radiusKm),
    page: String(page),
    pageSize: String(pageSize),
  })

  return apiRequest(
    `/medicines/${medicineId}/availability?${params.toString()}`,
    {
      auth: false,
    },
  )
}
