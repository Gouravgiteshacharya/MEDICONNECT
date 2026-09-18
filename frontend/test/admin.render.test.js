import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('ADMIN boundary and existing customer views render without new dependencies', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { AdminGate } = await server.ssrLoadModule('/src/modules/admin/AdminWorkspace.jsx')
    const session = { logout() {}, restore() {}, login() {} }
    for (const status of ['AUTH_CHECKING', 'UNAUTHENTICATED', 'AUTH_ERROR', 'AUTHENTICATED_NON_ADMIN', 'AUTHENTICATED_ADMIN']) {
      const html = renderToStaticMarkup(createElement(AdminGate, { state: { status, user: { role: 'ADMIN' }, message: 'Recovery message' }, session }, createElement('p', null, 'Protected workspace')))
      assert.equal(html.includes('Protected workspace'), status === 'AUTHENTICATED_ADMIN')
      if (status === 'UNAUTHENTICATED') {
        assert.match(html, /type="email"/)
        assert.match(html, /type="password"/)
        assert.match(html, /for="operations-email"/)
      }
      if (status === 'AUTH_CHECKING') assert.match(html, /role="status"/)
      if (status === 'AUTHENTICATED_NON_ADMIN') assert.match(html, /Access denied/)
    }
    const App = (await server.ssrLoadModule('/src/App.jsx')).default
    const app = renderToStaticMarkup(createElement(App))
    assert.match(app, /Assistant/)
    assert.match(app, /Support/)
    assert.match(app, /Operations \(ADMIN\)/)
    assert.doesNotMatch(app, /Welcome to Operations/)
    const Support = (await server.ssrLoadModule('/src/modules/support/SupportView.jsx')).default
    assert.match(renderToStaticMarkup(createElement(Support)), /Support/i)
    const Assistant = (await server.ssrLoadModule('/src/modules/assistant/AssistantView.jsx')).default
    assert.match(renderToStaticMarkup(createElement(Assistant)), /assistant/i)
  } finally { await server.close() }
})
