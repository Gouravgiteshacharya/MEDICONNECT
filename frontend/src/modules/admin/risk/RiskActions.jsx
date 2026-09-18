import { useEffect, useRef } from 'react'
import { actionLabels, availableActions, dismissalReasons, readOnlyReason } from './risk.actions.js'
import { label, rulePresentation } from './risk.presentation.js'

export default function RiskActions({ state, model }) {
  const confirmationHeading = useRef(null)
  const origin = useRef(null)
  const restoreFocus = useRef(false)
  const resultMessage = useRef(null)
  useEffect(() => { if (state.confirmation) confirmationHeading.current?.focus() }, [state.confirmation])
  useEffect(() => {
    if (!state.confirmation && restoreFocus.current) {
      restoreFocus.current = false
      origin.current?.focus()
    }
  }, [state.confirmation])
  useEffect(() => { if (state.actionMessage && !state.pending) resultMessage.current?.focus() }, [state.actionMessage, state.pending])
  const unavailable = readOnlyReason(state.detail)
  const actions = availableActions(state.detail)
  return <section className="risk-actions" aria-label="Assessment lifecycle actions">
    {unavailable && <p>{unavailable}</p>}
    {state.actionMessage && <p role="status" tabIndex={-1} ref={resultMessage}>{state.actionMessage}</p>}
    {!state.pending && (state.loading || state.detailLoading) && <p role="status">Wait for the current information to finish loading before choosing an action.</p>}
    {state.pending && <p role="status">Updating assessment and refreshing its state…</p>}
    {!state.pending && actions.map(action => <button key={action} disabled={!!state.confirmation || state.loading || state.detailLoading || !!state.detailError || !!state.error} onClick={event => { origin.current = event.currentTarget; model.choose(action) }}>{actionLabels[action]}</button>)}
    {state.confirmation && <div className="risk-confirmation">
      <h3 tabIndex={-1} ref={confirmationHeading}>Confirm {actionLabels[state.confirmation].toLowerCase()}</h3>
      <p>{rulePresentation(state.detail)[0]} · {label(state.detail.status)}</p>
      <p>{state.confirmation === 'acknowledge' ? 'Mark this assessment as acknowledged for operational handling.' : state.confirmation === 'resolve' ? 'Mark this operational assessment as resolved. This does not change the underlying order or delivery.' : 'Mark this operational assessment as dismissed. Its historical evidence remains available.'}</p>
      {state.confirmation === 'dismiss' && <label>Dismissal reason<select value={state.reason} required onChange={event => model.reason(event.target.value)}><option value="">Select a reason</option>{dismissalReasons.map(reason => <option key={reason} value={reason}>{label(reason)}</option>)}</select></label>}
      <button onClick={model.confirm} disabled={state.pending || state.loading || state.detailLoading || !!state.error || !!state.detailError || (state.confirmation === 'dismiss' && !dismissalReasons.includes(state.reason))}>Confirm {actionLabels[state.confirmation].toLowerCase()}</button>
      <button onClick={() => { restoreFocus.current = true; model.cancel() }}>Cancel</button>
    </div>}
  </section>
}
