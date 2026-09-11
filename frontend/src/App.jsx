import { useState } from 'react'
import AssistantView from './modules/assistant/AssistantView.jsx'
import SupportView from './modules/support/SupportView.jsx'
import './App.css'

function App() {
  const [experience, setExperience] = useState('assistant')

  return (
    <div className="app-shell">
      <nav className="experience-switch" aria-label="Customer experience">
        <div className="experience-switch__group" role="tablist" aria-label="Choose a workspace">
          <button
            type="button"
            role="tab"
            aria-selected={experience === 'assistant'}
            onClick={() => setExperience('assistant')}
          >
            Assistant
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={experience === 'support'}
            onClick={() => setExperience('support')}
          >
            Support
          </button>
        </div>
      </nav>
      {experience === 'assistant' ? <AssistantView /> : <SupportView />}
    </div>
  )
}

export default App
