import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRiskApi } from './risk.api.js'
import { createRiskState } from './risk.state.js'
import { evidenceRows, formatTime, label, rulePresentation, rules, severities } from './risk.presentation.js'
import './risk.css'
import RiskActions from './RiskActions.jsx'

function Facts({ rows }) {
  return <dl className="risk-facts">{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
}
export function RiskDetail({ record }) {
  const [title, explanation] = rulePresentation(record)
  const evidence = evidenceRows(record)
  return <article>
    <h3>{title}</h3><p>{explanation}</p>
    <Facts rows={[
      ['Rule', record.ruleCode], ['Rule version', record.ruleVersion], ['Severity', label(record.severity)], ['Status', label(record.status)],
      ['Detected', formatTime(record.detectedAt)], ['Last evaluated', formatTime(record.lastEvaluatedAt)],
      ['Acknowledged at', formatTime(record.acknowledgedAt)], ['Resolved at', formatTime(record.resolvedAt)], ['Dismissed at', formatTime(record.dismissedAt)],
    ]} />
    <h3>Operational evidence</h3>
    {evidence ? <Facts rows={evidence} /> : <p>Operational evidence unavailable</p>}
  </article>
}

export function RiskQueueContent({ state, model, headingRef }) {
  if (state.selected) return <section aria-labelledby="risk-heading">
    <button onClick={model.back} disabled={state.pending}>Back to queue</button>
    <h2 id="risk-heading" tabIndex={-1} ref={headingRef}>Assessment detail</h2>
    <button onClick={() => model.select(state.selected)} disabled={state.detailLoading || state.pending}>Refresh detail</button>
    {state.detailLoading && <p role="status">{state.detail ? 'Refreshing assessment…' : 'Loading assessment…'}</p>}
    {state.detailError && <p role="alert">{state.detailError} {state.detail && 'Previously loaded information may be out of date.'}</p>}
    {state.detailError && <button disabled={state.pending} onClick={() => model.select(state.selected)}>Retry detail</button>}
    {state.detail && <RiskDetail record={state.detail} />}
    <RiskActions state={state} model={model} />
    {state.error && <><p role="alert">Queue refresh failed. Refresh before another lifecycle action.</p><button disabled={state.pending || state.loading} onClick={() => model.load(true)}>Retry queue refresh</button></>}
  </section>
  return <section aria-labelledby="risk-heading">
    <h2 id="risk-heading" tabIndex={-1} ref={headingRef}>Risk Queue</h2>
    <p>Open and acknowledged assessments, newest detection first. Times shown in UTC.</p>
    <div className="risk-filters">
      <label>Severity<select value={state.query.severity} onChange={e => model.filters({ severity: e.target.value })}><option value="">All severities</option>{severities.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Rule<select value={state.query.ruleCode} onChange={e => model.filters({ ruleCode: e.target.value })}><option value="">All rules</option>{Object.entries(rules).map(([value, [title]]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <button onClick={() => model.load()} disabled={state.loading}>Refresh queue</button>
    </div>
    {state.loading && <p role="status">{state.rows ? 'Refreshing queue…' : 'Loading queue…'}</p>}
    {state.error && <><p role="alert">{state.error} {state.rows && 'Previously loaded information may be out of date.'}</p><button onClick={() => model.load()}>Retry queue</button></>}
    {!state.loading && !state.error && state.rows?.length === 0 && <p role="status">{state.query.offset ? 'No assessments on this page. Return to the previous page or refresh.' : state.query.severity || state.query.ruleCode ? 'No assessments match these filters.' : 'No open or acknowledged assessments.'}</p>}
    <ul className="risk-list">{state.rows?.map(record => <li key={record.id}>
      <h3><button onClick={() => model.select(record.id)}>{rulePresentation(record)[0]}</button></h3>
      <p className="risk-code">{record.ruleCode} · Version {record.ruleVersion}</p>
      <Facts rows={[
        ['Severity', label(record.severity)], ['Status', label(record.status)], ['Detected', formatTime(record.detectedAt)],
      ]} />
    </li>)}</ul>
    <nav className="risk-pagination" aria-label="Risk Queue pages">
      <button onClick={model.previous} disabled={state.loading || state.query.offset === 0}>Previous</button>
      <span>Page {Math.floor(state.query.offset / state.query.limit) + 1} · Up to {state.query.limit} assessments per page</span>
      <button onClick={model.next} disabled={state.loading || !!state.error || state.rows?.length !== state.query.limit || state.query.offset + state.query.limit > 1000000}>Next</button>
    </nav>
    <p>A full page may be the last page. Assessments can move between pages as the queue changes.</p>
  </section>
}

export default function RiskQueue({ session }) {
  const [model] = useState(() => createRiskState(createRiskApi(session)))
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const headingRef = useRef(null)
  useEffect(() => { model.load(); return model.dispose }, [model])
  useEffect(() => { headingRef.current?.focus() }, [state.selected])
  return <RiskQueueContent state={state} model={model} headingRef={headingRef} />
}
