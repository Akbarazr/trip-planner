import { useState, useEffect } from 'react';
import MapIcon from './MapIcon';
import { api } from '../api';

// A highlighted Cotrip suggestion shown beside an itinerary day. Reloads when
// the day's stops change so the tip stays relevant.
export default function DayTip({ tripId, day, stopsKey, onPlace }) {
  const [tip, setTip] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.dayTip(tripId, day)
      .then((t) => { if (!cancelled) setTip(t?.text ? t : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tripId, day, stopsKey]);

  if (!tip?.text) return null;

  return (
    <div
      className="day-tip"
      onClick={() => tip.place && onPlace?.(tip.place)}
      title={tip.place ? 'Show on map' : ''}
    >
      <span className="day-tip-avatar"><MapIcon size={16} /></span>
      <span className="day-tip-text"><b>Cotrip:</b> {tip.text}</span>
    </div>
  );
}
