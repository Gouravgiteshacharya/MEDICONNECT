import { useRef, useState, useSyncExternalStore } from 'react'
import './assistant.css'

function CustomerLoginForm({ session, message }) {
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

    try {
      await session.login(email, password)
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <form className="assistant-auth" onSubmit={submit} aria-label="Customer sign in">
      <p className="assistant-eyebrow">Customer account</p>
      <h2>Sign in to use the assistant</h2>
      <p>Sign in with your MediConnect customer account to access orders, prescriptions, deliveries, and other account-specific help.</p>
      {message && <p className="assistant-auth__alert" role="alert">{message}</p>}
      <label htmlFor="assistant-email">Email</label>
      <input id="assistant-email" name="email" type="email" autoComplete="username" required disabled={submitting} />
      <label htmlFor="assistant-password">Password</label>
      <input id="assistant-password" name="password" type="password" autoComplete="current-password" required disabled={submitting} />
      <button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</button>
    </form>
  )
}

export default function CustomerAssistantGate({ session, children }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)

  if (state.status === 'AUTH_CHECKING') {
    return <main className="assistant-page"><section className="assistant-workspace assistant-auth-shell"><p role="status">Checking your session...</p></section></main>
  }

  if (state.user?.role === 'CUSTOMER' && state.status === 'AUTHENTICATED_NON_ADMIN') {
    return (
      <>
        <div className="assistant-session">
          <span>Signed in as {state.user.name}</span>
          <button type="button" onClick={session.logout}>Sign out</button>
        </div>
        {children}
      </>
    )
  }

  if (state.status === 'AUTHENTICATED_ADMIN' || state.status === 'AUTHENTICATED_NON_ADMIN') {
    return (
      <main className="assistant-page">
        <section className="assistant-workspace assistant-auth-shell">
          <h2>Customer account required</h2>
          <p role="alert">The customer assistant is available only to CUSTOMER accounts.</p>
          <button type="button" onClick={session.logout}>Sign out</button>
        </section>
      </main>
    )
  }

  if (state.status === 'AUTH_ERROR') {
    return (
      <main className="assistant-page">
        <section className="assistant-workspace assistant-auth-shell">
          <h2>Unable to verify your session</h2>
          <p role="alert">{state.message}</p>
          <div className="assistant-auth__actions">
            <button type="button" onClick={session.restore}>Retry session check</button>
            <button type="button" onClick={session.logout}>Return to sign in</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="assistant-page">
      <section className="assistant-workspace assistant-auth-shell">
        <CustomerLoginForm session={session} message={state.message} />
      </section>
    </main>
  )
}