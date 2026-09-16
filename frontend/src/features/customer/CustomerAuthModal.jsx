import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import './CustomerAuthModal.css'

export default function CustomerAuthModal({
  open,
  initialMode = 'login',
  onClose,
  onAuthenticated,
}) {
  const { login, register } = useAuth()

  const [mode, setMode] = useState(initialMode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
  })

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setError('')
    }
  }, [initialMode, open])

  if (!open) return null

  function updateField(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    setLoading(true)
    setError('')

    try {
      let user

      if (mode === 'register') {
        user = await register({
          name: form.name.trim(),
          email: form.email.trim(),
          ...(form.phone.trim()
            ? { phone: form.phone.trim() }
            : {}),
          password: form.password,
        })
      } else {
        user = await login({
          email: form.email.trim(),
          password: form.password,
        })
      }

      setForm({
        name: '',
        email: '',
        phone: '',
        password: '',
      })

      onClose()
      onAuthenticated?.(user, { mode })
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to continue. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="customer-auth-overlay">
      <button
        type="button"
        className="customer-auth-backdrop"
        aria-label="Close"
        onClick={onClose}
      />

      <section
        className="customer-auth-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={
          mode === 'login'
            ? 'Sign in to MediConnect'
            : 'Create MediConnect account'
        }
      >
        <div className="customer-auth-handle" />

        <header className="customer-auth-header">
          <div>
            <span>MEDICONNECT</span>
            <h2>
              {mode === 'login'
                ? 'Sign in to your workspace.'
                : 'Create your account.'}
            </h2>
          </div>

          <button
            type="button"
            className="customer-auth-close"
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </header>

        <p className="customer-auth-copy">
          {mode === 'login'
            ? 'Use one MediConnect login for customer, pharmacy, rider, or operations access.'
            : 'Create an account to order from nearby pharmacies.'}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>
                <span>Name</span>
                <input
                  name="name"
                  value={form.name}
                  onChange={updateField}
                  autoComplete="name"
                  required
                />
              </label>

              <label>
                <span>Phone <small>Optional</small></span>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={updateField}
                  autoComplete="tel"
                  inputMode="tel"
                />
              </label>
            </>
          )}

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={updateField}
              autoComplete="email"
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={updateField}
              autoComplete={
                mode === 'login'
                  ? 'current-password'
                  : 'new-password'
              }
              required
            />
          </label>

          {error && (
            <div className="customer-auth-error">
              {error}
            </div>
          )}

          <button
            className="customer-auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <div className="customer-auth-switch">
          <span>
            {mode === 'login'
              ? 'New to MediConnect?'
              : 'Already have an account?'}
          </span>

          <button
            type="button"
            onClick={() => {
              setMode(
                mode === 'login'
                  ? 'register'
                  : 'login',
              )
              setError('')
            }}
          >
            {mode === 'login'
              ? 'Create account'
              : 'Sign in'}
          </button>
        </div>
      </section>
    </div>
  )
}
