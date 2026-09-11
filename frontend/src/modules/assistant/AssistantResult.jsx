import { getActionDisplayMode, getToolResultPresentation } from './assistant.format.js'

export default function AssistantResult({ toolResult, suggestedActions = [] }) {
  const error = getToolResultPresentation(toolResult)

  return (
    <>
      {error && <p className="assistant-tool-error"><strong>{error.label}.</strong> {error.message}</p>}
      {suggestedActions.length > 0 && (
        <div className="assistant-actions" aria-label="Suggested next steps">
          {suggestedActions.map((action) => (
            <span className="assistant-action" key={action.id} data-display-mode={getActionDisplayMode(action)}>
              {action.label}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
