import { ApiError } from '../../../api/http.client.js'
import { isIso, severities, statuses } from './risk.presentation.js'
import { dismissalReasons } from './risk.actions.js'
const root = '/admin/risk-assessments'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function summary(row) {
  if (!row || !uuid.test(row.id) || typeof row.ruleCode !== 'string' || !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(row.ruleCode) || row.ruleCode.length > 80 || typeof row.ruleVersion !== 'string' || !/^[1-9][0-9]{0,15}$/.test(row.ruleVersion) || !severities.includes(row.severity) || !statuses.includes(row.status) || !isIso(row.detectedAt) || !isIso(row.lastEvaluatedAt)) throw new ApiError('response')
  return { id: row.id, ruleCode: row.ruleCode, ruleVersion: row.ruleVersion, severity: row.severity, status: row.status, detectedAt: row.detectedAt, lastEvaluatedAt: row.lastEvaluatedAt,
    acknowledgedAt: isIso(row.acknowledgedAt) ? row.acknowledgedAt : null, resolvedAt: isIso(row.resolvedAt) ? row.resolvedAt : null, dismissedAt: isIso(row.dismissedAt) ? row.dismissedAt : null }
}
export function createRiskApi(session) {
  async function mutate(id, action, body) {
    if (!uuid.test(id)) throw new ApiError('http', 400)
    const result = await session.request(`${root}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body })
    const record = summary(result?.data)
    if (record.id !== id) throw new ApiError('response')
    return record
  }
  return {
    acknowledge: id => mutate(id, 'acknowledge', {}),
    resolve: id => mutate(id, 'resolve', { reason: 'OPERATOR_RESOLVED' }),
    dismiss(id, reason) {
      if (!dismissalReasons.includes(reason)) return Promise.reject(new ApiError('http', 400))
      return mutate(id, 'dismiss', { reason })
    },
    async list({ severity = '', ruleCode = '', limit = 25, offset = 0 } = {}, signal) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000000 || (severity && !severities.includes(severity)) || (ruleCode && (ruleCode.length > 80 || !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(ruleCode)))) throw new ApiError('http', 400)
      const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (severity) query.set('severity', severity)
      if (ruleCode) query.set('ruleCode', ruleCode)
      const result = await session.request(`${root}?${query}`, { method: 'GET', signal })
      if (!Array.isArray(result?.data) || result.data.length > limit || result.pagination?.limit !== limit || result.pagination?.offset !== offset) throw new ApiError('response')
      return result.data.map(summary)
    },
    async detail(id, signal) {
      if (!uuid.test(id)) throw new ApiError('http', 400)
      const result = await session.request(`${root}/${encodeURIComponent(id)}`, { method: 'GET', signal })
      const record = summary(result?.data)
      if (record.id !== id) throw new ApiError('response')
      return { ...record, evidence: result.data.evidence }
    },
  }
}
