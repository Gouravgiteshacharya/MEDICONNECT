import { useParams } from 'react-router-dom'

import AdminBlockedPage from './AdminBlockedPage'

export default function AdminRiskDetail() {
  const { riskId } = useParams()

  return <AdminBlockedPage type="riskDetail" referenceId={riskId} />
}
