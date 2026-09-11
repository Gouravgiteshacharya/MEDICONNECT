import { formatDate } from './support.format.js'

export default function SupportMessageThread({ messages = [] }) {
  if (messages.length === 0) {
    return <p className="message-empty">No follow-up messages yet.</p>
  }

  return (
    <ol className="message-thread" aria-label="Support conversation">
      {messages.map((message) => (
        <li className={`message ${message.isOwnMessage ? 'message--own' : 'message--support'}`} key={message.id}>
          <span className="message__sender">{message.isOwnMessage ? 'You' : 'MediConnect support'}</span>
          <p>{message.message}</p>
          <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
        </li>
      ))}
    </ol>
  )
}
