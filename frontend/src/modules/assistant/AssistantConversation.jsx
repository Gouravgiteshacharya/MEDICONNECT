import AssistantMessage from './AssistantMessage.jsx'

export default function AssistantConversation({ entries, responseRef }) {
  if (entries.length === 0) return <p className="assistant-conversation__empty">Your conversation will appear here after you send a request.</p>

  return (
    <ol className="assistant-conversation" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions">
      {entries.map((entry, index) => (
        <AssistantMessage
          entry={entry}
          key={entry.id}
          responseRef={entry.role === 'assistant' && index === entries.length - 1 ? responseRef : undefined}
        />
      ))}
    </ol>
  )
}
