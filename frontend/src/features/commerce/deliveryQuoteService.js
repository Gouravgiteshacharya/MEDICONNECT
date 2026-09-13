import { apiRequest } from '../../services/apiClient'

export async function createDeliveryQuote({
  pharmacyId,
  deliveryAddressId,
}) {
  return apiRequest('/delivery-quotes', {
    method: 'POST',
    body: {
      pharmacyId,
      deliveryAddressId,
    },
  })
}
