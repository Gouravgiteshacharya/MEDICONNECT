export const VOICE_STATES = Object.freeze({
  IDLE: 'idle', REQUESTING_PERMISSION: 'requesting_permission', LISTENING: 'listening',
  TRANSCRIBING: 'transcribing', STOPPED: 'stopped', UNSUPPORTED: 'unsupported', ERROR: 'error',
})

export const VOICE_ERROR_MESSAGES = Object.freeze({
  not_supported: 'Dictation is not supported in this browser.',
  permission_denied: 'Microphone permission was not granted.',
  service_unavailable: "Your browser's speech recognition service is unavailable.",
  no_speech: 'No speech was detected. Try again or type your request.',
  audio_capture: 'A microphone could not be accessed.',
  network: 'Speech recognition could not connect. Try again or type your request.',
  aborted: 'Dictation was cancelled.',
  unknown: 'Dictation could not be completed.',
})

export function mapRecognitionError(code) {
  const mapping = {
    'not-allowed': 'permission_denied', 'service-not-allowed': 'service_unavailable',
    'language-not-supported': 'not_supported', 'no-speech': 'no_speech',
    'audio-capture': 'audio_capture', network: 'network', aborted: 'aborted',
  }
  return Object.hasOwn(mapping, code) ? mapping[code] : 'unknown'
}

export function isRecognitionActive(status) {
  return ['requesting_permission', 'listening', 'transcribing'].includes(status)
}

export function combineTranscript(draft, transcript) {
  const speech = transcript.trim()
  if (!speech) return draft
  return `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${speech}`
}

// Each browser result event contains the session's full result list. Rebuild from
// that snapshot, rather than repeatedly appending already-final segments.
export function extractRecognitionResults(results) {
  const final = [], interim = []
  for (const result of Array.from(results ?? [])) {
    const text = typeof result?.[0]?.transcript === 'string' ? result[0].transcript.trim() : ''
    if (text) (result.isFinal ? final : interim).push(text)
  }
  return { finalTranscript: final.join(' '), interimTranscript: interim.join(' ') }
}

export function createVoiceState(draft = '') {
  return { status: 'idle', originalDraft: draft, draft, finalTranscript: '', interimTranscript: '', error: null }
}

export function reduceVoiceState(state, event) {
  if (event.type === 'start') return { ...createVoiceState(event.draft), status: 'requesting_permission' }
  if (!isRecognitionActive(state.status)) return state
  switch (event.type) {
    case 'listening': return { ...state, status: state.status === 'requesting_permission' ? 'listening' : state.status }
    case 'results': return { ...state, ...extractRecognitionResults(event.results), status: 'transcribing' }
    case 'stop': return { ...state, status: 'transcribing' }
    case 'end': return { ...state, status: 'stopped', draft: combineTranscript(state.originalDraft, state.finalTranscript), interimTranscript: '' }
    case 'cancel': return { ...createVoiceState(state.originalDraft), status: 'stopped' }
    case 'error': return { ...createVoiceState(state.originalDraft), status: 'error', error: mapRecognitionError(event.code) }
    default: return state
  }
}
