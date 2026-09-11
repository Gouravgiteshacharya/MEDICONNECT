export function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function statusClass(status) {
  return String(status).toLowerCase().replace('_', '-')
}
