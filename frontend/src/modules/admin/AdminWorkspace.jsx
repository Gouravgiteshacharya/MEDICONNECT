import { useRef, useState, useSyncExternalStore } from 'react'
import './admin.css'
import RiskQueue from './risk/RiskQueue.jsx'

export function AdminGate({ state, session, children }) {
  if (state.status === 'AUTH_CHECKING') return <p role="status">Checking your session…</p>
  if (state.status === 'AUTHENTICATED_ADMIN' && state.user?.role === 'ADMIN') return children
  if (state.status === 'AUTHENTICATED_NON_ADMIN') return <section><h2>Access denied</h2><p role="alert">{state.message || 'You are signed in. Operations requires an ADMIN account.'}</p><button onClick={session.logout}>Sign out</button></section>
  if (state.status === 'AUTH_ERROR') return <section><h2>Unable to sign in</h2><p role="alert">{state.message}</p><button onClick={session.restore}>Retry session check</button> <button onClick={session.logout}>Return to sign in</button></section>
  return <LoginForm session={session} message={state.message} />
}

function LoginForm({ session, message }) {
  const [submitting, setSubmitting] = useState(false)
  const busy = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    const form = event.currentTarget
    const email = form.elements.email.value
    const password = form.elements.password.value
    form.elements.password.value = ''
    try { await session.login(email, password) } finally { busy.current = false; setSubmitting(false) }
  }
  return <form onSubmit={submit} aria-label="Operations sign in">
    <h2>Sign in to Operations</h2>
    <p>For authorized ADMIN accounts.</p>
    {message && <p role="alert">{message}</p>}
    <label htmlFor="operations-email">Email</label>
    <input id="operations-email" name="email" type="email" autoComplete="username" required disabled={submitting} />
    <label htmlFor="operations-password">Password</label>
    <input id="operations-password" name="password" type="password" autoComplete="current-password" required disabled={submitting} />
    <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
  </form>
}

export default function AdminWorkspace({ session }) {
  const [view, setView] = useState('landing')
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [state.status])
  return <main className="operations" aria-labelledby="operations-heading">
    <h1 id="operations-heading" tabIndex={-1} ref={heading}>Operations</h1>
    <AdminGate state={state} session={session}>
      <section aria-label="ADMIN workspace">
        <header className="operations__header"><p>Signed in as {state.user?.name} · ADMIN</p><button onClick={session.logout}>Sign out</button></header>
        <nav aria-label="Operations navigation"><button aria-pressed={view === 'risk'} onClick={() => setView('risk')}>Risk Queue</button></nav>
        {view === 'risk' ? <RiskQueue session={session} /> : <><h2>Welcome to Operations</h2><p>Open the Risk Queue to review operational assessments.</p></>}
      </section>
    </AdminGate>
  </main>
}
