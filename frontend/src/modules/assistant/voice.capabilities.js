export function getSpeechRecognitionConstructor(windowLike) {
  if (typeof windowLike?.SpeechRecognition === 'function') return windowLike.SpeechRecognition
  if (typeof windowLike?.webkitSpeechRecognition === 'function') return windowLike.webkitSpeechRecognition
  return null
}

export function getVoiceCapabilities(windowLike) {
  const speechRecognitionSupported = getSpeechRecognitionConstructor(windowLike) !== null
  // Browsers report trustworthy localhost development contexts through this flag too.
  const secureContext = windowLike?.isSecureContext === true
  return { speechRecognitionSupported, secureContext, dictationAvailable: speechRecognitionSupported && secureContext }
}
