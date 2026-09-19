import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import './CustomerAuthModal.css'

export default function CustomerAuthModal({
  open,
  initialMode = 'login',
  audience = 'customer',
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
      setMode(audience === 'staff' ? 'login' : initialMode)
      setError('')
    }
  }, [audience, initialMode, open])

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      document.querySelector('.customer-auth-sheet input')?.focus()
    })
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose()
      if (event.key === 'Tab') {
        const focusable = [...document.querySelectorAll(
          '.customer-auth-sheet button:not(:disabled), .customer-auth-sheet input:not(:disabled)',
        )]
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.()
    }
  }, [loading, onClose, open])

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

  const modal = (
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
          audience === 'staff'
            ? 'Staff and partner sign in'
            : mode === 'login'
            ? 'Sign in to MediConnect'
            : 'Create MediConnect account'
        }
      >
        <div className="customer-auth-handle" />

        <header className="customer-auth-header">
          <div>
            <span>MEDICONNECT</span>
            <h2>
              {audience === 'staff'
                ? 'Staff & partner sign in.'
                : mode === 'login'
                ? 'Welcome back.'
                : 'Create your account.'}
            </h2>
          </div>

          <button
            type="button"
            className="customer-auth-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Close sign-in dialog"
          >
            ×
          </button>
        </header>

        <p className="customer-auth-copy">
          {audience === 'staff'
            ? 'For pharmacy staff, delivery partners, and MediConnect operations. Your account role opens the correct workspace.'
            : mode === 'login'
            ? 'Sign in when you are ready to order, save addresses, or manage your medicines.'
            : 'Create an account when you are ready to order from a nearby pharmacy.'}
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
                  maxLength={120}
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
                  minLength={7}
                  maxLength={20}
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
              maxLength={254}
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
              minLength={mode === 'register' ? 8 : 1}
              maxLength={128}
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

        {audience !== 'staff' && <div className="customer-auth-switch">
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
        </div>}
      </section>
    </div>
  )

  return createPortal(modal, document.body)
}
