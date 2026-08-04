import { useState, useEffect } from 'react';
import MapIcon from './MapIcon';
import { api } from '../api';

// A friendly, auto-rotating "Cotrip" suggestion shown on top of a trip card.
// Refreshes on mount (so it changes on every browser refresh) and gently
// rotates every ~12s while the page is open.
export default function TripTip({ tripId }) {
  const [tip, setTip] = useState(null);
  const [show, setShow] = useState(true);

  async function load() {
    try {
      const t = await api.tip(tripId);
      // brief fade to make the rotation feel alive
      setShow(false);
      setTimeout(() => { setTip(t); setShow(true); }, 180);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 12000);
    return () => clearInterval(id);
  }, [tripId]);

  if (!tip?.text) return null;

  return (
    <div className={`cotrip-tip ${show ? 'in' : 'out'}`} onClick={(e) => e.stopPropagation()}>
      <div className="cotrip-avatar"><MapIcon size={20} /></div>
      <div className="cotrip-bubble">
        <span className="cotrip-name">Cotrip</span>
        <p>{tip.text}</p>
      </div>
    </div>
  );
}
