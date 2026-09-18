import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRiskApi } from '../src/modules/admin/risk/risk.api.js'
import { createRiskState } from '../src/modules/admin/risk/risk.state.js'
import { evidenceRows, rulePresentation, riskError } from '../src/modules/admin/risk/risk.presentation.js'
import { createAuthSession } from '../src/modules/auth/auth.session.js'
import { ApiError } from '../src/api/http.client.js'

const id = '11111111-1111-4111-8111-111111111111'
const at = '2026-09-18T00:00:00.000Z'
const record = { id, ruleCode: 'RIDER_LOCATION_STALE', ruleVersion: '1', severity: 'LOW', status: 'OPEN', detectedAt: at, lastEvaluatedAt: at, evidence: { status: 'available', evidence: { assignmentStatus: 'ACCEPTED', locationFreshness: 'STALE', lastLocationAt: at, evaluatedAt: at, freshnessThresholdMs: 0 } } }
const full = Array.from({ length: 25 }, () => record)

test('risk API sends only bounded GET reads with supported filters and detail UUID', async () => {
  const calls = []
  const api = createRiskApi({ request: async (path, options) => { calls.push({ path, options }); return path.includes('?') ? { data: [record], pagination: { limit: 25, offset: 0 } } : { data: record } } })
  await api.list({ severity: 'LOW', ruleCode: 'RIDER_LOCATION_STALE', status: 'OPEN' })
  await api.detail(id)
  assert.match(calls[0].path, /limit=25&offset=0&severity=LOW&ruleCode=RIDER_LOCATION_STALE/)
  assert.equal(calls[0].path.includes('status='), false)
  assert.equal(calls[1].path, `/admin/risk-assessments/${id}`)
  assert.ok(calls.every(call => call.options.method === 'GET'))
  await assert.rejects(api.list({ limit: 101 }), { status: 400 })
  await assert.rejects(api.detail('../private'), { status: 400 })
})

test('queue loading, next/previous, filter reset, refresh and detail/back preserve list state', async () => {
  const calls = []
  const model = createRiskState({ list: async query => { calls.push(query); return full }, detail: async () => record })
  const pending = model.load()
  assert.equal(model.getSnapshot().loading, true)
  await pending
  await model.next()
  assert.equal(model.getSnapshot().query.offset, 25)
  await model.previous()
  assert.equal(model.getSnapshot().query.offset, 0)
  await model.next()
  await model.filters({ severity: 'HIGH', ruleCode: 'DELIVERY_FAILED' })
  assert.equal(model.getSnapshot().query.offset, 0)
  const refresh = model.load()
  assert.equal(model.getSnapshot().rows.length, 25)
  await refresh
  await model.select(id)
  assert.equal(model.getSnapshot().detail, record)
  model.back()
  assert.equal(model.getSnapshot().selected, null)
  assert.equal(model.getSnapshot().query.severity, 'HIGH')
  assert.equal(model.getSnapshot().rows.length, 25)
  assert.equal(calls.at(-1).ruleCode, 'DELIVERY_FAILED')
})

test('superseded filter and detail responses cannot replace newer data', async () => {
  const queue = [], details = []
  const model = createRiskState({ list: (query, signal) => new Promise(resolve => queue.push({ resolve, signal, query })), detail: (key, signal) => new Promise(resolve => details.push({ resolve, signal, key })) })
  const old = model.load()
  const latest = model.filters({ severity: 'HIGH' })
  assert.equal(queue[0].signal.aborted, true)
  queue[1].resolve([{ ...record, severity: 'HIGH' }]); await latest
  queue[0].resolve([record]); await old
  assert.equal(model.getSnapshot().rows[0].severity, 'HIGH')
  const a = model.select('a'), b = model.select('b')
  details[1].resolve({ ...record, id: 'b' }); await b
  details[0].resolve({ ...record, id: 'a' }); await a
  assert.equal(model.getSnapshot().detail.id, 'b')
  const late = model.select('c')
  model.back(); details[2].resolve(record); await late
  assert.equal(model.getSnapshot().detail, null)
})

test('network failures retry; detail 404 clears stale record', async () => {
  let fail = true, status = 0
  const model = createRiskState({ list: async () => { if (fail) throw new ApiError('network'); return [] }, detail: async () => { if (fail) throw new ApiError(status ? 'http' : 'network', status); return record } })
  await model.load(); assert.match(model.getSnapshot().error, /reach/)
  fail = false; await model.load(); assert.deepEqual(model.getSnapshot().rows, [])
  fail = true; await model.select(id); assert.match(model.getSnapshot().detailError, /reach/)
  fail = false; await model.select(id); assert.equal(model.getSnapshot().detail.id, id)
  status = 404; fail = true; await model.select(id)
  assert.equal(model.getSnapshot().detail, null)
  assert.match(model.getSnapshot().detailError, /unavailable/)
})

for (const status of [401, 403]) test(`queue ${status} uses existing session boundary`, async () => {
  const session = createAuthSession({ request: async path => {
    if (path === '/auth/login') return { token: 'test-token' }
    if (path === '/auth/me') return { user: { id, name: 'Admin', role: 'ADMIN' } }
    throw new ApiError('http', status)
  } })
  await session.login('test@example.com', 'password')
  const model = createRiskState(createRiskApi(session))
  await model.load()
  assert.equal(session.getSnapshot().status, status === 401 ? 'UNAUTHENTICATED' : 'AUTHENTICATED_NON_ADMIN')
})

test('evidence accepts zero and rejects malformed values; hidden data never appears', () => {
  const safe = evidenceRows({ ...record, evidence: { status: 'available', evidence: { ...record.evidence.evidence, coordinates: 'private', token: 'secret' } } })
  assert.ok(safe.some(row => row[1] === '0 ms'))
  assert.equal(JSON.stringify(safe).includes('private'), false)
  for (const threshold of [-1, Infinity, '0', {}]) assert.equal(evidenceRows({ ...record, evidence: { status: 'available', evidence: { ...record.evidence.evidence, freshnessThresholdMs: threshold } } }), null)
  assert.equal(evidenceRows({ ...record, evidence: null }), null)
  assert.equal(evidenceRows({ ...record, ruleVersion: '999' }), null)
  assert.equal(evidenceRows({ ...record, ruleCode: 'HISTORICAL_RULE' }), null)
  assert.equal(rulePresentation({ ...record, ruleVersion: '999' })[0], 'Operational assessment')
})

test('timeout and failure format only their typed safe fields', () => {
  assert.ok(evidenceRows({ ruleCode: 'ASSIGNMENT_OFFER_TIMED_OUT', ruleVersion: '1', evidence: { status: 'available', evidence: { assignmentStatus: 'TIMED_OUT', offerExpiresAt: null, timedOutAt: at } } }).some(row => row[1] === 'Not recorded'))
  assert.ok(evidenceRows({ ruleCode: 'DELIVERY_FAILED', ruleVersion: '1', evidence: { status: 'available', evidence: { assignmentStatus: 'FAILED', eventType: 'FAILED_DELIVERY', occurredAt: at, orderStatusAtFailure: 'READY_FOR_PICKUP', requiresManualReview: true } } }).some(row => row[0] === 'Manual review required'))
})

test('read errors never expose backend messages', () => {
  for (const status of [400, 401, 403, 404, 409, 500, 503]) assert.equal(riskError({ status, message: 'secret' }).includes('secret'), false)
})

test('ADMIN queue rendering: labels, empty/loading/error states, evidence, unknown history and no mutation controls', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { RiskQueueContent, RiskDetail } = await server.ssrLoadModule('/src/modules/admin/risk/RiskQueue.jsx')
    const { AdminGate } = await server.ssrLoadModule('/src/modules/admin/AdminWorkspace.jsx')
    const model = createRiskState({})
    const render = state => renderToStaticMarkup(createElement(RiskQueueContent, { state, model }))
    const state = { ...model.getSnapshot(), rows: [record] }
    const html = render(state)
    for (const text of ['Location update stale', 'Low', 'Open', 'Severity', 'Rule', 'Next', 'Previous']) assert.ok(html.includes(text))
    assert.doesNotMatch(html, />Acknowledge<|>Resolve<|>Dismiss</)
    assert.match(render({ ...state, rows: [], loading: false }), /No open or acknowledged assessments/)
    assert.match(render({ ...state, rows: [], query: { ...state.query, severity: 'HIGH' } }), /No assessments match/)
    assert.match(render({ ...state, rows: null, loading: true }), /Loading queue/)
    assert.match(render({ ...state, loading: true }), /Refreshing queue/)
    assert.match(render({ ...state, error: 'Service unavailable' }), /role="alert"/)
    const detail = renderToStaticMarkup(createElement(RiskDetail, { record }))
    assert.match(detail, /0 ms/)
    const unknown = renderToStaticMarkup(createElement(RiskDetail, { record: { ...record, ruleCode: 'HISTORICAL_RULE', ruleVersion: '99', status: 'RESOLVED' } }))
    assert.match(unknown, /Operational assessment/); assert.match(unknown, /Operational evidence unavailable/); assert.match(unknown, /Resolved/)
    for (const status of ['AUTHENTICATED_ADMIN', 'AUTHENTICATED_NON_ADMIN']) {
      const gated = renderToStaticMarkup(createElement(AdminGate, { state: { status, user: { role: 'ADMIN' } }, session: {} }, createElement(RiskQueueContent, { state, model })))
      assert.equal(gated.includes('Location update stale'), status === 'AUTHENTICATED_ADMIN')
    }
    assert.match(render({ ...state, selected: id, detailLoading: true }), /Loading assessment/)
    assert.match(render({ ...state, selected: id, detail: record }), /Back to queue/)
  } finally { await server.close() }
})
