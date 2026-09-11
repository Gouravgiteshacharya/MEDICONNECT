import { ASSISTANT_PROMPTS } from './assistant.constants.js'

export default function AssistantSuggestions({ onSelect }) {
  return (
    <section className="assistant-suggestions" aria-labelledby="suggestion-title">
      <h2 id="suggestion-title">Example requests</h2>
      <div className="assistant-suggestions__list">
        {ASSISTANT_PROMPTS.map((prompt) => (
          <button type="button" key={prompt} onClick={() => onSelect(prompt)}>{prompt}</button>
        ))}
      </div>
    </section>
  )
}
