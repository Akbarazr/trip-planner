import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n.jsx';
import MapIcon from './MapIcon';
import { api } from '../api';

export default function Chat({ tripId, onPlaces, onSent, bare }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const logRef = useRef(null);
  const lastPlaceResultRef = useRef({ query: null, places: [] });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const previous = lastPlaceResultRef.current;
      const {
        reply, places, query,
      } = await api.chat({
        tripId,
        message: text,
        history,
        previous_query: previous.query,
        previous_places: previous.places,
      });
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      if (query || (Array.isArray(places) && places.length)) {
        lastPlaceResultRef.current = {
          query: query || previous.query,
          places: Array.isArray(places) ? places : [],
        };
      }
      if (Array.isArray(places) && onPlaces && (query || places.length)) {
        onPlaces(places);
      }
      onSent?.();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Error: ' + e.message }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={bare ? 'chat-bare' : 'card'}>
      {!bare && (
        <div className="row spread">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}><MapIcon size={21} /> Cotrip</h3>
        </div>
      )}
      <div className="chat">
        <div className="chat-log" ref={logRef}>
          {messages.length === 0 && (
            <div className="bubble assistant">{t('chat_welcome')}</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>{m.content}</div>
          ))}
          {loading && <div className="bubble assistant spinner">{t('thinking')}</div>}
        </div>
        <div className="chat-input">
          <input
            value={input}
            placeholder={t('chat_ph')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button onClick={send} disabled={loading}>{t('send')}</button>
        </div>
      </div>
    </div>
  );
}
