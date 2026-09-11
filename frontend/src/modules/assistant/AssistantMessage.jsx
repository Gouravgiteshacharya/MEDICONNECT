import AssistantResult from './AssistantResult.jsx'
import { getResponsePresentation } from './assistant.format.js'

export default function AssistantMessage({ entry, responseRef }) {
  if (entry.role === 'customer') {
    return <li className="assistant-message assistant-message--customer"><span className="assistant-message__author">You</span><p>{entry.content}</p></li>
  }

  const presentation = getResponsePresentation(entry.status)
  return (
    <li className={`assistant-message assistant-message--response assistant-message--${presentation.className}`} tabIndex="-1" ref={responseRef}>
      <span className="assistant-message__status">{presentation.label}</span>
      <p>{entry.content}</p>
      <AssistantResult toolResult={entry.toolResult} suggestedActions={entry.suggestedActions} />
    </li>
  )
}
