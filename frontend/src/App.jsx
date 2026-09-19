import { useEffect, useState } from 'react'
import AssistantView from './modules/assistant/AssistantView.jsx'
import CustomerAssistantGate from './modules/assistant/CustomerAssistantGate.jsx'
import { createAssistantClient } from './modules/assistant/assistant.client.js'
import SupportView from './modules/support/SupportView.jsx'
import AdminWorkspace from './modules/admin/AdminWorkspace.jsx'
import { createAuthSession } from './modules/auth/auth.session.js'
import { createHttpClient } from './api/http.client.js'
import './App.css'

function App() {
  const [experience, setExperience] = useState('assistant')
  const [session] = useState(() => createAuthSession({ request: createHttpClient({ baseUrl: import.meta.env.VITE_API_BASE_URL || '/api/v1' }) }))
  const [assistantClient] = useState(() => createAssistantClient(session))

  useEffect(() => { session.restore() }, [session])

  return (
    <div className="app-shell">
      <nav className="experience-switch" aria-label="Choose a workspace">
        <div className="experience-switch__group">
          <button
            type="button"
            aria-pressed={experience === 'assistant'}
            onClick={() => setExperience('assistant')}
          >
            Assistant
          </button>
          <button
            type="button"
            aria-pressed={experience === 'support'}
            onClick={() => setExperience('support')}
          >
            Support
          </button>
        </div>
        <button type="button" aria-pressed={experience === 'admin'} onClick={() => setExperience('admin')}>Operations (ADMIN)</button>
      </nav>
      {experience === 'assistant' ? <CustomerAssistantGate session={session}><AssistantView client={assistantClient} /></CustomerAssistantGate> : experience === 'support' ? <SupportView /> : <AdminWorkspace session={session} />}
    </div>
  )
}

export default App
