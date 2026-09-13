import { apiRequest } from '../../services/apiClient'

export async function getCart() {
  return apiRequest('/cart')
}

export async function addCartItem({
  pharmacyId,
  medicineId,
  quantity = 1,
}) {
  return apiRequest('/cart/items', {
    method: 'POST',
    body: {
      pharmacyId,
      medicineId,
      quantity,
    },
  })
}

export async function updateCartItem(itemId, quantity) {
  return apiRequest(`/cart/items/${itemId}`, {
    method: 'PATCH',
    body: {
      quantity,
    },
  })
}

export async function removeCartItem(itemId) {
  return apiRequest(`/cart/items/${itemId}`, {
    method: 'DELETE',
  })
}

export async function setPickupFulfillment() {
  return apiRequest('/cart', {
    method: 'PATCH',
    body: {
      fulfillmentMethod: 'SELF_PICKUP',
    },
  })
}

export async function setDeliveryFulfillment(deliveryAddressId) {
  return apiRequest('/cart', {
    method: 'PATCH',
    body: {
      fulfillmentMethod: 'DELIVERY',
      deliveryAddressId,
    },
  })
}
