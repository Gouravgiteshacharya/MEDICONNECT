import { ASSISTANT_CAPABILITIES } from './assistant.constants.js'

export default function AssistantIntro() {
  return (
    <section className="assistant-intro" aria-labelledby="assistant-intro-title">
      <div>
        <p className="assistant-eyebrow">Operational help</p>
        <h2 id="assistant-intro-title">What I can help with</h2>
        <ul>{ASSISTANT_CAPABILITIES.map((capability) => <li key={capability}>{capability}</li>)}</ul>
      </div>
      <aside className="assistant-boundary" aria-label="Medical safety boundary">
        <strong>Medical decisions stay with professionals</strong>
        <p>I don’t diagnose, prescribe, choose medicine for symptoms, recommend dosage, or approve or reject prescriptions.</p>
      </aside>
    </section>
  )
}
