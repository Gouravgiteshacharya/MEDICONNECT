import { useRef, useState } from 'react'
import { assistantClient, ASSISTANT_UNAVAILABLE_MESSAGE, buildAssistantRequest } from './assistant.client.js'
import AssistantComposer from './AssistantComposer.jsx'
import AssistantConversation from './AssistantConversation.jsx'
import AssistantIntro from './AssistantIntro.jsx'
import AssistantSuggestions from './AssistantSuggestions.jsx'
import './assistant.css'

let messageSequence = 0
function nextMessageId(role) {
  messageSequence += 1
  return `${role}-${messageSequence}`
}

function unavailableResponse() {
  return {
    status: 'error', intent: 'unknown', message: ASSISTANT_UNAVAILABLE_MESSAGE, suggestedActions: [],
    toolResult: { status: 'error', code: 'unavailable', message: ASSISTANT_UNAVAILABLE_MESSAGE },
  }
}

export default function AssistantView({ client = assistantClient }) {
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState([])
  const [pending, setPending] = useState(false)
  const responseRef = useRef(null)

  const submitRequest = async (event) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || pending) return

    setEntries((current) => [...current, { id: nextMessageId('customer'), role: 'customer', content: message }])
    setDraft('')
    setPending(true)

    let response
    try {
      response = await client.respond(buildAssistantRequest(message))
    } catch {
      response = unavailableResponse()
    }

    setEntries((current) => [...current, {
      id: nextMessageId('assistant'),
      role: 'assistant',
      content: response.message,
      status: response.status,
      intent: response.intent,
      toolResult: response.toolResult,
      suggestedActions: response.suggestedActions || [],
    }])
    setPending(false)
    requestAnimationFrame(() => responseRef.current?.focus())
  }

  return (
    <main className="assistant-page">
      <header className="assistant-hero">
        <div className="assistant-brand"><span className="assistant-brand__mark" aria-hidden="true">M</span><span>MediConnect</span></div>
        <div className="assistant-hero__content"><p className="assistant-eyebrow assistant-eyebrow--light">Customer assistant</p><h1>How can I help today?</h1><p>Clear help for medicines, pharmacies, prescriptions, orders, deliveries, and support.</p></div>
      </header>

      <section className="assistant-workspace" aria-label="MediConnect assistant">
        <AssistantIntro />
        <AssistantSuggestions onSelect={setDraft} />
        <section className="assistant-chat" aria-label="Request and response area">
          <AssistantConversation entries={entries} responseRef={responseRef} />
          <AssistantComposer draft={draft} onDraftChange={setDraft} onSubmit={submitRequest} pending={pending} />
        </section>
      </section>
      <footer className="assistant-footer">Operational guidance only. Medical decisions stay with qualified healthcare professionals.</footer>
    </main>
  )
}
