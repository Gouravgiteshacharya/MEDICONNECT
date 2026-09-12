import assert from 'node:assert/strict'
import test from 'node:test'
import { getSpeechRecognitionConstructor, getVoiceCapabilities } from '../src/modules/assistant/voice.capabilities.js'
import { combineTranscript, createVoiceState, extractRecognitionResults, isRecognitionActive, mapRecognitionError, reduceVoiceState, VOICE_ERROR_MESSAGES } from '../src/modules/assistant/voice.state.js'
import { buildAssistantRequest } from '../src/modules/assistant/assistant.client.js'

const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal })
const start = (draft = 'Original draft') => reduceVoiceState(createVoiceState(), { type: 'start', draft })

test('detects the standard constructor in a secure context', () => {
  class Recognition {}
  const browser = { SpeechRecognition: Recognition, isSecureContext: true }
  assert.equal(getSpeechRecognitionConstructor(browser), Recognition)
  assert.deepEqual(getVoiceCapabilities(browser), { speechRecognitionSupported: true, secureContext: true, dictationAvailable: true })
})
test('detects the prefixed constructor and prefers the standard one', () => {
  class Standard {} class Prefixed {}
  assert.equal(getSpeechRecognitionConstructor({ webkitSpeechRecognition: Prefixed }), Prefixed)
  assert.equal(getSpeechRecognitionConstructor({ SpeechRecognition: Standard, webkitSpeechRecognition: Prefixed }), Standard)
})
test('absent globals and non-function properties are harmless', () => {
  for (const browser of [undefined, null, {}, { SpeechRecognition: true }]) {
    assert.equal(getSpeechRecognitionConstructor(browser), null)
    assert.equal(getVoiceCapabilities(browser).dictationAvailable, false)
  }
})
test('secure-context flag is required, including for localhost', () => {
  class Recognition {}
  for (const isSecureContext of [false, undefined, 'true']) {
    assert.equal(getVoiceCapabilities({ SpeechRecognition: Recognition, isSecureContext, location: { hostname: 'localhost' } }).dictationAvailable, false)
  }
  assert.equal(getVoiceCapabilities({ SpeechRecognition: Recognition, isSecureContext: true, location: { hostname: 'localhost' } }).dictationAvailable, true)
})
for (const [browserCode, code] of [
  ['not-allowed', 'permission_denied'], ['service-not-allowed', 'service_unavailable'],
  ['language-not-supported', 'not_supported'], ['no-speech', 'no_speech'],
  ['audio-capture', 'audio_capture'], ['network', 'network'], ['aborted', 'aborted'],
  ['private browser diagnostic', 'unknown'], ['toString', 'unknown'],
]) {
  test(`maps ${browserCode} to a safe frontend error`, () => {
    assert.equal(mapRecognitionError(browserCode), code)
    assert.ok(VOICE_ERROR_MESSAGES[code])
    assert.ok(!VOICE_ERROR_MESSAGES[code].includes('private browser diagnostic'))
  })
}
test('separates final and interim text from array-like browser results', () => {
  assert.deepEqual(extractRecognitionResults({ 0: result('Track order', true), 1: result(' ID', false), length: 2 }), {
    finalTranscript: 'Track order', interimTranscript: 'ID',
  })
  assert.deepEqual(extractRecognitionResults(undefined), { finalTranscript: '', interimTranscript: '' })
})
test('repeated snapshots do not duplicate final segments', () => {
  const event = { type: 'results', results: [result('Track order', true), result('ID', false)] }
  let state = reduceVoiceState(start('Please'), event)
  state = reduceVoiceState(state, event)
  state = reduceVoiceState(state, { type: 'results', results: [result('Track order', true), result('ID', true)] })
  assert.equal(state.finalTranscript, 'Track order ID')
  assert.equal(state.draft, 'Please')
  assert.equal(reduceVoiceState(state, { type: 'end' }).draft, 'Please Track order ID')
})
test('interim replacements never enter the draft', () => {
  let state = reduceVoiceState(start(), { type: 'results', results: [result('wrong words', false)] })
  state = reduceVoiceState(state, { type: 'results', results: [result('corrected words', false)] })
  assert.equal(state.interimTranscript, 'corrected words')
  assert.equal(reduceVoiceState(state, { type: 'end' }).draft, 'Original draft')
})
test('combination preserves the existing draft and inserts only needed whitespace', () => {
  assert.equal(combineTranscript('Existing', ' new speech '), 'Existing new speech')
  assert.equal(combineTranscript('Existing\n', 'new speech'), 'Existing\nnew speech')
  assert.equal(combineTranscript('', 'new speech'), 'new speech')
  assert.equal(combineTranscript('  Existing  ', ''), '  Existing  ')
  assert.equal(combineTranscript('ID', 'MC-1024'), 'ID MC-1024')
})
test('Stop accepts final results until End and final text is committed once', () => {
  let state = reduceVoiceState(start('Please'), { type: 'listening' })
  assert.equal(state.status, 'listening')
  state = reduceVoiceState(state, { type: 'stop' })
  assert.ok(isRecognitionActive(state.status))
  state = reduceVoiceState(state, { type: 'results', results: [result('track order', true)] })
  state = reduceVoiceState(state, { type: 'end' })
  assert.equal(state.status, 'stopped')
  assert.equal(state.draft, 'Please track order')
  assert.equal(reduceVoiceState(state, { type: 'end' }), state)
})
test('Cancel restores original draft and rejects late results or End', () => {
  let state = reduceVoiceState(start('Original\n'), { type: 'results', results: [result('discard me', true)] })
  state = reduceVoiceState(state, { type: 'cancel' })
  assert.equal(state.draft, 'Original\n')
  assert.equal(state.finalTranscript, '')
  assert.equal(state.interimTranscript, '')
  assert.equal(state.error, null)
  assert.equal(reduceVoiceState(state, { type: 'results', results: [result('late', true)] }), state)
  assert.equal(reduceVoiceState(state, { type: 'end' }), state)
})
test('errors discard the session without altering the existing draft', () => {
  let state = reduceVoiceState(start(), { type: 'results', results: [result('discard', true)] })
  state = reduceVoiceState(state, { type: 'error', code: 'network' })
  assert.equal(state.draft, 'Original draft')
  assert.equal(state.error, 'network')
  assert.equal(isRecognitionActive(state.status), false)
})
test('recognition result processing never invokes submission', () => {
  let calls = 0
  const submit = () => { calls++ }
  const state = reduceVoiceState(start(), { type: 'results', results: [result('Track order', true)], submit })
  reduceVoiceState(state, { type: 'end', submit })
  assert.equal(calls, 0)
})
test('reviewed dictation uses the unchanged text request contract', () => {
  const recognized = reduceVoiceState(start(''), { type: 'results', results: [result('Find Crocin', true)] })
  const reviewed = reduceVoiceState(recognized, { type: 'end' }).draft
  assert.deepEqual(buildAssistantRequest(reviewed, 'correlation'), { message: 'Find Crocin', channel: 'text', correlationId: 'correlation' })
  assert.deepEqual(Object.keys(buildAssistantRequest(reviewed)), ['message', 'channel'])
})
test('active states block submission until recognition is finished', () => {
  for (const status of ['requesting_permission', 'listening', 'transcribing']) assert.equal(isRecognitionActive(status), true)
  for (const status of ['idle', 'stopped', 'unsupported', 'error']) assert.equal(isRecognitionActive(status), false)
})
