import { useId } from 'react'

export default function AssistantComposer({ draft, onDraftChange, onSubmit, pending }) {
  const inputId = useId()
  const isEmpty = draft.trim().length === 0

  return (
    <form className="assistant-composer" onSubmit={onSubmit}>
      <label htmlFor={inputId}>What can MediConnect help you with?</label>
      <div className="assistant-composer__controls">
        <textarea
          id={inputId}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          rows="3"
          placeholder="Type an operational request"
          disabled={pending}
        />
        <button type="submit" disabled={pending || isEmpty}>{pending ? 'Sending...' : 'Send request'}</button>
      </div>
      <p>Do not include sensitive medical information. This assistant does not provide clinical advice.</p>
    </form>
  )
}
