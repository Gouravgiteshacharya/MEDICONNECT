import { useRef, useState } from 'react'
import { SUPPORT_CATEGORIES, SUPPORT_ERROR_MESSAGES } from './support.constants.js'
import { validateTicketForm } from './support.validation.js'

const EMPTY_FORM = { subject: '', description: '', category: '', orderId: '' }

export default function SupportTicketForm({ client, onCancel, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [globalError, setGlobalError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef(null)

  const update = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    const validation = validateTicketForm(form)
    if (!validation.valid) {
      setErrors(validation.errors)
      focusFirstInvalid(formRef.current, validation.errors)
      return
    }

    setSubmitting(true)
    setGlobalError('')
    const input = {
      subject: validation.values.subject,
      description: validation.values.description,
      category: validation.values.category,
      ...(validation.values.orderId ? { orderId: validation.values.orderId } : {}),
    }
    const result = await client.createTicket(input)
    setSubmitting(false)
    if (result.status === 'success') {
      onCreated(result.data)
      return
    }
    setGlobalError(result.message || SUPPORT_ERROR_MESSAGES[result.code] || SUPPORT_ERROR_MESSAGES.execution_failed)
  }

  return (
    <form className="support-form" ref={formRef} onSubmit={submit} noValidate>
      <div className="form-field">
        <label htmlFor="support-subject">Subject</label>
        <input id="support-subject" name="subject" value={form.subject} onChange={update} maxLength="120" aria-invalid={Boolean(errors.subject)} aria-describedby={errors.subject ? 'support-subject-error' : 'support-subject-help'} />
        <span id="support-subject-help" className="field-help">A short summary of what happened.</span>
        {errors.subject && <span id="support-subject-error" className="field-error">{errors.subject}</span>}
      </div>

      <div className="form-field">
        <label htmlFor="support-category">Category</label>
        <select id="support-category" name="category" value={form.category} onChange={update} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'support-category-error' : undefined}>
          <option value="">Choose a category</option>
          {SUPPORT_CATEGORIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
        {errors.category && <span id="support-category-error" className="field-error">{errors.category}</span>}
      </div>

      <div className="form-field">
        <label htmlFor="support-order">Order ID <span>(optional)</span></label>
        <input id="support-order" name="orderId" value={form.orderId} onChange={update} aria-invalid={Boolean(errors.orderId)} aria-describedby={errors.orderId ? 'support-order-error' : 'support-order-help'} />
        <span id="support-order-help" className="field-help">Add an order ID only when your request relates to an order.</span>
        {errors.orderId && <span id="support-order-error" className="field-error">{errors.orderId}</span>}
      </div>

      <div className="form-field form-field--wide">
        <label htmlFor="support-description">What can we help with?</label>
        <textarea id="support-description" name="description" value={form.description} onChange={update} rows="7" maxLength="2000" aria-invalid={Boolean(errors.description)} aria-describedby="support-description-help support-description-error" />
        <span id="support-description-help" className="field-help">Include the details our support team will need. {form.description.length}/2000</span>
        {errors.description && <span id="support-description-error" className="field-error">{errors.description}</span>}
      </div>

      <div className="form-alert" aria-live="polite">{globalError}</div>
      <div className="form-actions form-field--wide">
        <button className="button button--secondary" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit request'}</button>
      </div>
    </form>
  )
}

function focusFirstInvalid(form, errors) {
  const firstName = ['subject', 'category', 'orderId', 'description'].find((name) => errors[name])
  form?.elements.namedItem(firstName)?.focus()
}
