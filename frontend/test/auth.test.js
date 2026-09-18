import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, createHttpClient } from '../src/api/http.client.js'
import { createAuthSession } from '../src/modules/auth/auth.session.js'

const user = role => ({ id: 'test-user', name: 'Operator', role })
function harness(role = 'ADMIN') {
  const calls = []
  let failure
  const session = createAuthSession({ request: async (path, options) => {
    calls.push({ path, options })
    if (failure) throw failure
    return path === '/auth/login' ? { token: 'test-token', user: user('ADMIN') } : { user: user(role) }
  } })
  return { session, calls, fail: error => { failure = error } }
}

test('initial checking becomes unauthenticated without a persisted token', async () => {
  const { session, calls } = harness()
  assert.equal(session.getSnapshot().status, 'AUTH_CHECKING')
  await session.restore()
  assert.equal(session.getSnapshot().status, 'UNAUTHENTICATED')
  assert.equal(calls.length, 0)
})

for (const role of ['ADMIN', 'CUSTOMER', 'DELIVERY_PARTNER', 'PHARMACY_STAFF']) {
  test(`login and in-memory restoration use authoritative /me role: ${role}`, async () => {
    const { session, calls } = harness(role)
    await session.login(' person@example.com ', 'password')
    const expected = role === 'ADMIN' ? 'AUTHENTICATED_ADMIN' : 'AUTHENTICATED_NON_ADMIN'
    assert.equal(session.getSnapshot().status, expected)
    assert.deepEqual(calls.map(c => c.path), ['/auth/login', '/auth/me'])
    assert.equal(calls[0].options.body.email, 'person@example.com')
    assert.equal(calls[1].options.token, 'test-token')
    await session.restore()
    assert.equal(session.getSnapshot().status, expected)
    assert.equal(calls.at(-1).path, '/auth/me')
    assert.equal('token' in session.getSnapshot(), false)
  })
}

test('login failure is safe and network failure is distinct', async () => {
  const h = harness()
  h.fail(new ApiError('http', 401, 'INVALID_CREDENTIALS'))
  await h.session.login('a@example.com', 'wrong')
  assert.equal(h.session.getSnapshot().status, 'UNAUTHENTICATED')
  assert.match(h.session.getSnapshot().message, /credentials/)
  h.fail(new ApiError('network'))
  await h.session.login('a@example.com', 'password')
  assert.equal(h.session.getSnapshot().status, 'AUTH_ERROR')
  assert.match(h.session.getSnapshot().message, /connection/)
})

test('expired /me and authenticated 401 clear session; 403 preserves authenticated distinction', async () => {
  for (const viaRestore of [true, false]) {
    const h = harness()
    await h.session.login('a@example.com', 'password')
    h.fail(new ApiError('http', 401, 'INVALID_TOKEN'))
    if (viaRestore) await h.session.restore()
    else await assert.rejects(h.session.request('/protected'), { status: 401 })
    assert.equal(h.session.getSnapshot().status, 'UNAUTHENTICATED')
    await assert.rejects(h.session.request('/protected'), { status: 401 })
  }
  const h = harness()
  await h.session.login('a@example.com', 'password')
  h.fail(new ApiError('http', 403, 'FORBIDDEN'))
  await assert.rejects(h.session.request('/protected'), { status: 403 })
  assert.equal(h.session.getSnapshot().status, 'AUTHENTICATED_NON_ADMIN')
  assert.equal(h.session.getSnapshot().user.role, 'ADMIN')
})

test('duplicate login is suppressed and logout prevents delayed session resurrection', async () => {
  let finish
  let calls = 0
  const session = createAuthSession({ request: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  const first = session.login('a@example.com', 'password')
  await session.login('a@example.com', 'password')
  assert.equal(calls, 1)
  session.logout()
  finish({ token: 'late-token' })
  await first
  assert.equal(session.getSnapshot().status, 'UNAUTHENTICATED')
  await session.restore()
  assert.equal(calls, 1)
})

test('HTTP sends JSON/Bearer with abort support and retains only safe failure metadata', async () => {
  const signal = new AbortController().signal
  let captured
  const request = createHttpClient({ baseUrl: '/api/v1/', fetchImpl: async (url, options) => {
    captured = { url, options }
    return new Response(JSON.stringify({ error: 'sensitive content', code: 'FORBIDDEN' }), { status: 403 })
  } })
  await assert.rejects(request('/auth/me', { token: 'test-token', signal }), error => {
    assert.equal(error.status, 403)
    assert.equal(error.code, 'FORBIDDEN')
    assert.equal(JSON.stringify(error).includes('sensitive'), false)
    return true
  })
  assert.equal(captured.url, '/api/v1/auth/me')
  assert.equal(captured.options.headers.Authorization, 'Bearer test-token')
  assert.equal(captured.options.signal, signal)
  assert.equal(captured.options.credentials, 'omit')
  const offline = createHttpClient({ fetchImpl: async () => { throw new TypeError('private transport error') } })
  await assert.rejects(offline('/auth/me'), { kind: 'network', status: 0 })
  const broken = createHttpClient({ fetchImpl: async () => new Response('not json', { status: 401 }) })
  await assert.rejects(broken('/auth/me'), { kind: 'http', status: 401 })
})

test('malformed or unknown /me role never grants access', async () => {
  const h = harness('SUPERADMIN')
  await h.session.login('a@example.com', 'password')
  assert.equal(h.session.getSnapshot().status, 'AUTH_ERROR')
})
