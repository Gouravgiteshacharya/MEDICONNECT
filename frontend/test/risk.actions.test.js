import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRiskApi } from '../src/modules/admin/risk/risk.api.js'
import { createRiskState } from '../src/modules/admin/risk/risk.state.js'
import { availableActions } from '../src/modules/admin/risk/risk.actions.js'
import { createAuthSession } from '../src/modules/auth/auth.session.js'
import { ApiError } from '../src/api/http.client.js'

const id = '11111111-1111-4111-8111-111111111111', at = '2026-09-18T00:00:00.000Z'
const initial = { id, ruleCode: 'ASSIGNMENT_OFFER_TIMED_OUT', ruleVersion: '1', severity: 'INFO', status: 'OPEN', detectedAt: at, lastEvaluatedAt: at, evidence: { status: 'available', evidence: { assignmentStatus: 'TIMED_OUT', offerExpiresAt: null, timedOutAt: at } } }
async function setup(mutate) {
  let record = initial
  const calls = []
  const api = {
    list: async query => { calls.push(['list', query]); return ['OPEN', 'ACKNOWLEDGED'].includes(record.status) ? [record] : [] },
    detail: async () => { calls.push(['detail']); return record },
  }
  for (const action of ['acknowledge', 'resolve', 'dismiss']) api[action] = async (key, reason) => {
    calls.push([action, key, reason])
    if (mutate) return mutate(action, value => { record = { ...record, status: value } })
    record = { ...record, status: { acknowledge: 'ACKNOWLEDGED', resolve: 'RESOLVED', dismiss: 'DISMISSED' }[action] }
    return record
  }
  const model = createRiskState(api)
  await model.filters({ severity: 'INFO' }); await model.select(id)
  return { model, calls }
}

test('strict eligibility and lifecycle map, including historical policy', () => {
  assert.deepEqual(availableActions(initial), ['acknowledge', 'resolve', 'dismiss'])
  assert.deepEqual(availableActions({ ...initial, status: 'ACKNOWLEDGED' }), ['resolve', 'dismiss'])
  for (const status of ['RESOLVED', 'DISMISSED']) assert.deepEqual(availableActions({ ...initial, status }), [])
  for (const record of [{ ...initial, ruleCode: 'OLD_RULE' }, { ...initial, ruleVersion: '99' }, { ...initial, evidence: null }, { ...initial, evidence: { status: 'available', evidence: { ...initial.evidence.evidence, private: 'secret' } } }]) assert.deepEqual(availableActions(record), [])
})

test('loading prevents a lifecycle choice and selecting another assessment clears old feedback', async () => {
  const { model } = await setup()
  const refresh = model.load()
  model.choose('resolve')
  assert.equal(model.getSnapshot().confirmation, null)
  await refresh
  model.choose('resolve')
  await model.confirm()
  assert.match(model.getSnapshot().actionMessage, /recorded/)
  model.select('22222222-2222-4222-8222-222222222222')
  assert.equal(model.getSnapshot().actionMessage, '')
})

for (const action of ['acknowledge', 'resolve', 'dismiss']) {
  test(`${action}: choosing and canceling sends no request`, async () => {
    const { model, calls } = await setup()
    model.choose(action)
    assert.equal(model.getSnapshot().confirmation, action)
    if (action === 'dismiss') model.reason('FALSE_POSITIVE')
    model.cancel(); await model.confirm()
    assert.equal(calls.filter(c => c[0] === action).length, 0)
    assert.equal(model.getSnapshot().reason, '')
  })
  test(`${action}: pessimistic, no duplicates/contradictory actions, both views reconcile`, async () => {
    let finish
    const { model, calls } = await setup((name, setStatus) => new Promise(resolve => { finish = () => { setStatus({ acknowledge: 'ACKNOWLEDGED', resolve: 'RESOLVED', dismiss: 'DISMISSED' }[name]); resolve() } }))
    model.choose(action)
    if (action === 'dismiss') model.reason('DUPLICATE_CONTEXT')
    const pending = model.confirm()
    assert.equal(model.getSnapshot().detail.status, 'OPEN')
    assert.equal(model.getSnapshot().pending, true)
    model.choose('resolve'); await model.confirm()
    assert.equal(calls.filter(c => ['acknowledge', 'resolve', 'dismiss'].includes(c[0])).length, 1)
    finish(); await pending
    assert.notEqual(model.getSnapshot().detail.status, 'OPEN')
    assert.equal(model.getSnapshot().query.severity, 'INFO')
    assert.equal(calls.filter(c => c[0] === 'detail').length, 2)
    assert.equal(calls.filter(c => c[0] === 'list').length, 2)
    assert.equal(model.getSnapshot().rows.length, action === 'acknowledge' ? 1 : 0)
  })
}

test('dismiss requires explicit supported reason, resets on reopening, sends exact values', async () => {
  const calls = []
  const api = createRiskApi({ request: async (path, options) => { calls.push({ path, options }); return { data: initial } } })
  for (const reason of ['FALSE_POSITIVE', 'DUPLICATE_CONTEXT']) {
    const h = await setup()
    h.model.choose('dismiss')
    assert.equal(h.model.getSnapshot().reason, '')
    await h.model.confirm(); h.model.reason('UNKNOWN'); await h.model.confirm()
    assert.equal(h.calls.filter(c => c[0] === 'dismiss').length, 0)
    h.model.reason(reason); await h.model.confirm()
    assert.equal(h.calls.find(c => c[0] === 'dismiss')[2], reason)
    await api.dismiss(id, reason)
    assert.deepEqual(calls.at(-1).options.body, { reason })
  }
  for (const reason of ['', undefined, 'UNKNOWN']) await assert.rejects(api.dismiss(id, reason), { status: 400 })
  assert.equal(calls.length, 2)
  await api.acknowledge(id); assert.deepEqual(calls.at(-1).options.body, {})
  await api.resolve(id); assert.deepEqual(calls.at(-1).options.body, { reason: 'OPERATOR_RESOLVED' })
  assert.ok(calls.every(call => call.options.method === 'POST'))
})

for (const action of ['acknowledge', 'resolve', 'dismiss']) test(`${action} 409 refetches authoritative terminal state without replay`, async () => {
  const { model, calls } = await setup((_action, setStatus) => { setStatus('RESOLVED'); throw new ApiError('http', 409) })
  model.choose(action); model.reason('FALSE_POSITIVE'); await model.confirm()
  assert.match(model.getSnapshot().actionMessage, /changed/)
  assert.equal(model.getSnapshot().detail.status, 'RESOLVED')
  assert.deepEqual(availableActions(model.getSnapshot().detail), [])
  assert.equal(calls.filter(c => c[0] === action).length, 1)
})

for (const status of [400, 404, 500, 0]) test(`mutation failure ${status}: safe handling, never claims success`, async () => {
  const { model, calls } = await setup(() => { throw new ApiError(status ? 'http' : 'network', status) })
  model.choose('resolve'); await model.confirm()
  assert.doesNotMatch(model.getSnapshot().actionMessage, /Lifecycle action recorded/)
  assert.equal(calls.filter(c => c[0] === 'resolve').length, 1)
  if (status === 404) assert.equal(model.getSnapshot().detail, null)
  else assert.equal(model.getSnapshot().detail.status, 'OPEN')
})

for (const status of [401, 403]) test(`mutation ${status} preserves auth semantics`, async () => {
  const session = createAuthSession({ request: async (path, options) => {
    if (path === '/auth/login') return { token: 'test-token' }
    if (path === '/auth/me') return { user: { id, name: 'Admin', role: 'ADMIN' } }
    if (options.method === 'POST') throw new ApiError('http', status)
    return { data: initial }
  } })
  await session.login('admin@example.com', 'password')
  await assert.rejects(createRiskApi(session).resolve(id), { status })
  assert.equal(session.getSnapshot().status, status === 401 ? 'UNAUTHENTICATED' : 'AUTHENTICATED_NON_ADMIN')
})

test('confirmation renders accessible controls, no default reason, unknown/malformed remain readable', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const Actions = (await server.ssrLoadModule('/src/modules/admin/risk/RiskActions.jsx')).default
    const { RiskDetail } = await server.ssrLoadModule('/src/modules/admin/risk/RiskQueue.jsx')
    const { model } = await setup()
    model.choose('dismiss')
    const render = record => renderToStaticMarkup(createElement(Actions, { state: { ...model.getSnapshot(), detail: record, confirmation: null }, model }))
    const html = renderToStaticMarkup(createElement(Actions, { state: model.getSnapshot(), model }))
    assert.match(html, /Select a reason/); assert.match(html, /selected="" value=""|value="" selected=""/)
    assert.match(html, /disabled="">Confirm dismiss/); assert.match(html, /Cancel/)
    for (const record of [{ ...initial, ruleCode: 'OLD_RULE' }, { ...initial, evidence: null }]) {
      assert.doesNotMatch(render(record), />Acknowledge<|>Resolve<|>Dismiss</)
      assert.match(renderToStaticMarkup(createElement(RiskDetail, { record })), /Operational evidence unavailable/)
    }
  } finally { await server.close() }
})
