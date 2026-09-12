import { useCallback, useEffect, useRef, useState } from 'react'
import { getSpeechRecognitionConstructor, getVoiceCapabilities } from './voice.capabilities.js'
import { createVoiceState, isRecognitionActive, reduceVoiceState, VOICE_ERROR_MESSAGES } from './voice.state.js'

const STATUS_TEXT = {
  idle: 'Dictation is optional.', requesting_permission: 'Starting dictation. Microphone access may be requested.',
  listening: 'Listening. Use Stop to finish or Cancel to discard.', transcribing: 'Transcribing. Finish dictation before sending.',
  stopped: 'Dictation stopped. Review and edit your request before sending.',
  unsupported: 'Dictation is not supported in this browser.', error: 'Dictation stopped.',
}

function detach(recognition) {
  recognition.onstart = null
  recognition.onresult = null
  recognition.onend = null
  recognition.onerror = null
}

export default function AssistantVoiceInput({ draft, onDraftChange, disabled, onRecognitionStateChange }) {
  const capabilities = getVoiceCapabilities(typeof window === 'undefined' ? undefined : window)
  const [state, setState] = useState(createVoiceState)
  const sessionRef = useRef(null)
  const startButtonRef = useRef(null)

  const cancel = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    detach(session.recognition)
    try { session.recognition.abort() } catch { /* Already ended. */ }
    const next = reduceVoiceState(session.state, { type: 'cancel' })
    setState(next)
    onDraftChange(next.draft)
    onRecognitionStateChange(false)
    startButtonRef.current?.focus()
  }, [onDraftChange, onRecognitionStateChange])

  useEffect(() => {
    const onHidden = () => { if (document.hidden) cancel() }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', cancel)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', cancel)
      const session = sessionRef.current
      sessionRef.current = null
      if (session) {
        detach(session.recognition)
        try { session.recognition.abort() } catch { /* Already ended. */ }
      }
    }
  }, [cancel])

  const start = () => {
    if (disabled || sessionRef.current || !capabilities.dictationAvailable) return
    const initial = reduceVoiceState(createVoiceState(), { type: 'start', draft })
    onRecognitionStateChange(true)
    setState(initial)
    let recognition
    try {
      const Constructor = getSpeechRecognitionConstructor(window)
      recognition = new Constructor()
      recognition.continuous = false
      recognition.interimResults = true
      const session = { recognition, state: initial }
      sessionRef.current = session
      const update = (event) => {
        if (sessionRef.current !== session) return
        session.state = reduceVoiceState(session.state, event)
        setState(session.state)
      }
      const finish = (event) => {
        if (sessionRef.current !== session) return
        update(event)
        sessionRef.current = null
        detach(recognition)
        if (event.type === 'error') {
          try { recognition.abort() } catch { /* Already ended. */ }
        }
        onDraftChange(session.state.draft)
        onRecognitionStateChange(false)
        startButtonRef.current?.focus()
      }
      recognition.onstart = () => update({ type: 'listening' })
      recognition.onresult = (event) => update({ type: 'results', results: event.results })
      recognition.onend = () => finish({ type: 'end' })
      recognition.onerror = (event) => finish({ type: 'error', code: event.error })
      recognition.start()
    } catch {
      sessionRef.current = null
      if (recognition) {
        detach(recognition)
        try { recognition.abort() } catch { /* No active capture. */ }
      }
      setState(reduceVoiceState(initial, { type: 'error' }))
      onRecognitionStateChange(false)
    }
  }

  const stop = () => {
    const session = sessionRef.current
    if (!session) return
    session.state = reduceVoiceState(session.state, { type: 'stop' })
    setState(session.state)
    try { session.recognition.stop() } catch { cancel() }
  }

  const active = isRecognitionActive(state.status)
  const status = capabilities.dictationAvailable ? state.status : 'unsupported'
  return (
    <section className="assistant-voice" aria-label="Optional dictation">
      {capabilities.dictationAvailable && <div className="assistant-voice__controls">
        <button ref={startButtonRef} type="button" onClick={start} disabled={disabled || active}>Start dictation</button>
        {active && <>
          <button type="button" onClick={stop}>Stop dictation</button>
          <button type="button" onClick={cancel}>Cancel dictation</button>
        </>}
      </div>}
      <p role="status" aria-live="polite" className={active ? 'assistant-voice__status assistant-voice__status--active' : 'assistant-voice__status'}>
        {!capabilities.secureContext && capabilities.speechRecognitionSupported
          ? 'Dictation requires a secure connection. You can type your request.' : STATUS_TEXT[status]}
      </p>
      {state.interimTranscript && <div className="assistant-voice__transcript" aria-label="Interim transcript, not yet added to your request">
        <strong>Interim transcript</strong><p>{state.interimTranscript}</p>
      </div>}
      {state.error && <p role="alert">{VOICE_ERROR_MESSAGES[state.error]}</p>}
      <p>Dictation may send audio to your browser's speech service. Avoid sensitive medical information. Review the transcript before sending.</p>
      <p>Check medicine names and IDs before sending. Paste long IDs when possible.</p>
    </section>
  )
}
