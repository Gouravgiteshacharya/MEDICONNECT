import { useParams } from 'react-router-dom'

import AdminBlockedPage from './AdminBlockedPage'

export default function AdminSupportDetail() {
  const { ticketId } = useParams()

  return <AdminBlockedPage type="supportDetail" referenceId={ticketId} />
}
