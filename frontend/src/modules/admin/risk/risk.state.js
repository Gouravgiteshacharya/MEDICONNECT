import { riskError } from './risk.presentation.js'
import { availableActions, dismissalReasons } from './risk.actions.js'

export function createRiskState(api) {
  const listeners = new Set()
  let state = { query: { severity: '', ruleCode: '', limit: 25, offset: 0 }, rows: null, loading: false, error: '', selected: null, detail: null, detailLoading: false, detailError: '', confirmation: null, reason: '', pending: false, actionMessage: '' }
  let mutationVersion = 0
  let listVersion = 0, detailVersion = 0, listController, detailController
  const set = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()) }
  async function load(clear = false) {
    listController?.abort()
    listController = new AbortController()
    const version = ++listVersion
    set({ loading: true, error: '', ...(clear ? { rows: null } : {}) })
    try {
      const rows = await api.list(state.query, listController.signal)
      if (version === listVersion) set({ rows, loading: false })
    } catch (error) {
      if (version === listVersion) set({ loading: false, error: riskError(error) })
    }
  }
  async function select(id, reconcile = false) {
    if (state.pending && !reconcile) return
    detailController?.abort()
    detailController = new AbortController()
    const version = ++detailVersion
    set({ selected: id, detail: state.selected === id ? state.detail : null, detailLoading: true, detailError: '', confirmation: null, reason: '', ...(!reconcile ? { actionMessage: '' } : {}) })
    try {
      const detail = await api.detail(id, detailController.signal)
      if (version === detailVersion) set({ detail, detailLoading: false })
    } catch (error) {
      if (version === detailVersion) set({ detailLoading: false, detailError: riskError(error), ...(error.status === 404 ? { detail: null } : {}) })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    load, select,
    choose(action) {
      if (state.pending || state.loading || state.detailLoading || state.detailError || state.error || !availableActions(state.detail).includes(action)) return
      set({ confirmation: action, reason: '', actionMessage: '' })
    },
    reason(value) { if (!state.pending && state.confirmation === 'dismiss') set({ reason: dismissalReasons.includes(value) ? value : '' }) },
    cancel() { if (!state.pending) set({ confirmation: null, reason: '' }) },
    async confirm() {
      const action = state.confirmation, id = state.selected, reason = state.reason
      if (state.pending || state.loading || state.detailLoading || state.detailError || state.error || !availableActions(state.detail).includes(action) || (action === 'dismiss' && !dismissalReasons.includes(reason))) return
      const version = ++mutationVersion
      set({ pending: true, actionMessage: '', confirmation: null, reason: '' })
      let message
      try {
        await api[action](id, reason)
        message = 'Lifecycle action recorded. Assessment state refreshed.'
      } catch (error) {
        if (version !== mutationVersion) return
        if (error.status === 401 || error.status === 403) { set({ pending: false, detail: null, rows: null, actionMessage: riskError(error) }); return }
        if (error.status === 404) {
          set({ detail: null, detailError: 'This assessment is unavailable. Return to the queue.', actionMessage: 'Lifecycle action was not completed.' })
          await load(true)
          if (version === mutationVersion) set({ pending: false })
          return
        }
        message = error.status === 409 ? 'The assessment changed or this transition is no longer allowed. Review the refreshed state before choosing again.' : error.status === 400 ? 'The action was not accepted. Review the current assessment before choosing again.' : 'Action outcome not confirmed. Review the current assessment before choosing any further action.'
      }
      if (version !== mutationVersion) return
      // Never replay a mutation; both views reconcile using authoritative reads.
      await Promise.all([select(id, true), load(true)])
      if (version !== mutationVersion) return
      if (state.detailError || state.error) message = 'Reconciliation incomplete. Refresh the assessment and queue before choosing another action. The action outcome may already be recorded.'
      set({ pending: false, actionMessage: message })
    },
    filters(filters) { set({ query: { ...state.query, ...filters, offset: 0 } }); return load(true) },
    next() { if (state.loading || state.error || state.rows?.length !== state.query.limit || state.query.offset + state.query.limit > 1000000) return; set({ query: { ...state.query, offset: state.query.offset + state.query.limit } }); return load(true) },
    previous() { if (state.loading || !state.query.offset) return; set({ query: { ...state.query, offset: Math.max(0, state.query.offset - state.query.limit) } }); return load(true) },
    back() { if (state.pending) return; detailVersion++; detailController?.abort(); set({ selected: null, detail: null, detailError: '', detailLoading: false, confirmation: null, reason: '', actionMessage: '' }) },
    dispose() { mutationVersion++; listVersion++; detailVersion++; listController?.abort(); detailController?.abort() },
  }
}
