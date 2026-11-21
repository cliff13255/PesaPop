import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { AssistantMessageResponse } from '../api/types';
import { ConfirmPaymentModal } from '../components/ConfirmPaymentModal';
import { formatKES, MISSING_LABEL } from '../lib/format';
import { useDemo } from '../demo/DemoContext';

interface ChatItem {
  id: number;
  from: 'user' | 'assistant';
  text: string;
  response?: AssistantMessageResponse;
}

const CHIPS = ['Pay my electricity bill', 'Send KES 500 to John', 'Pay 1k to Mary 0722000333'];

export function AssistantPage() {
  const { config } = useDemo();
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: 0,
      from: 'assistant',
      text: 'Hi! Tell me who you want to pay and how much. I will set it up, and you confirm before anything is sent.',
    },
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<{ message: string; retryText: string } | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<AssistantMessageResponse | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [items, typing]);

  const send = async (text: string, appendUser = true) => {
    const message = text.trim();
    if (!message || typing) return;
    setError(null);
    if (appendUser) setItems((prev) => [...prev, { id: nextId.current++, from: 'user', text: message }]);
    setInput('');
    setTyping(true);
    try {
      const res = await api.assistantMessage(message, conversationId);
      setConversationId(res.conversation_id);
      setItems((prev) => [...prev, { id: nextId.current++, from: 'assistant', text: res.reply, response: res }]);
    } catch (err) {
      setError({ message: err instanceof ApiError ? err.message : 'The assistant could not reply.', retryText: message });
    } finally {
      setTyping(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const newChat = () => {
    setConversationId(null);
    setError(null);
    setItems((prev) => prev.slice(0, 1));
  };

  return (
    <div className="container narrow page chat-page">
      <div className="chat-head">
        <div>
          <h1>Payment assistant</h1>
          {config?.assistant_mode === 'rules' && <p className="muted small">Basic mode: the AI model is not connected, so only simple requests are understood.</p>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={newChat} disabled={typing}>
          New chat
        </button>
      </div>

      <div className="chat-log" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`bubble-row ${item.from}`}>
            <div className={`bubble ${item.from}`}>
              <p>{item.text}</p>
              {item.response && item.response.missing_fields.length > 0 && (
                <div className="still-needed">
                  <strong>Still needed</strong>
                  <ul>
                    {item.response.missing_fields.map((f) => (
                      <li key={f}>{MISSING_LABEL[f] ?? f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {item.response?.payment_summary && item.response.confirmation_id && (
                <div className="summary-card">
                  <div className="summary-card-row">
                    <span>{item.response.payment_summary.recipient}</span>
                    <strong>{formatKES(item.response.payment_summary.total)}</strong>
                  </div>
                  <div className="muted small">
                    M-Pesa · prompt to {item.response.payment_summary.phone}
                    {item.response.payment_summary.reference ? ` · Ref ${item.response.payment_summary.reference}` : ''}
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setReviewing(item.response!)}>
                    Review and confirm
                  </button>
                  <div className="hint">Not paid yet. Nothing moves until you confirm.</div>
                </div>
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div className="bubble-row assistant">
            <div className="bubble assistant typing" aria-label="Assistant is typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error.message}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void send(error.retryText, false)}>
            Retry
          </button>
        </div>
      )}

      <div className="chips">
        {CHIPS.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => void send(c)} disabled={typing}>
            {c}
          </button>
        ))}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Send 500 to John 0712 345 678"
          aria-label="Message"
          maxLength={2000}
        />
        <button type="submit" className="btn btn-primary" disabled={typing || !input.trim()}>
          Send
        </button>
      </form>
      <p className="hint center">Never share your M-Pesa PIN here. The assistant will never ask for it.</p>

      {reviewing?.payment_summary && reviewing.confirmation_id && (
        <ConfirmPaymentModal
          summary={reviewing.payment_summary}
          confirmationId={reviewing.confirmation_id}
          onCancel={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
