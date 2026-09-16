export const USER_ROLES = {
  CUSTOMER: 'CUSTOMER',
  PHARMACY_STAFF: 'PHARMACY_STAFF',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
  ADMIN: 'ADMIN',
}

const ROLE_HOME = {
  [USER_ROLES.CUSTOMER]: '/app',
  [USER_ROLES.PHARMACY_STAFF]: '/pharmacy',
  [USER_ROLES.DELIVERY_PARTNER]: '/rider',
  [USER_ROLES.ADMIN]: '/admin',
}

export function getRoleHome(role) {
  return ROLE_HOME[role] ?? '/'
}

export function isRoleAllowed(role, allowedRoles = []) {
  return allowedRoles.includes(role)
}

export function canRoleAccessPath(role, path = '') {
  if (!role || !path.startsWith('/')) return false

  if (path === '/app' || path.startsWith('/app/')) {
    return role === USER_ROLES.CUSTOMER
  }

  if (path === '/pharmacy' || path.startsWith('/pharmacy/')) {
    return role === USER_ROLES.PHARMACY_STAFF
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return role === USER_ROLES.ADMIN
  }

  if (path === '/rider') {
    return role === USER_ROLES.DELIVERY_PARTNER
  }

  return false
}
