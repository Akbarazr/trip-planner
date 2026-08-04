import { useState, useRef } from 'react';
import { api } from '../api';

// Text input that geocodes as you type and lets you pick a real place.
export default function PlaceInput({ label, value, onSelect, placeholder }) {
  const [text, setText] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  function handleChange(e) {
    const v = e.target.value;
    setText(v);
    onSelect({ name: v, lat: null, lon: null }); // keep raw text until a pick
    clearTimeout(timer.current);
    if (v.trim().length < 3) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.geocode(v);
        setResults(r);
        setOpen(true);
      } catch { /* ignore */ }
    }, 400);
  }

  function pick(r) {
    const short = (r.label || r.name).split(',').slice(0, 3).join(',').trim();
    setText(short);
    setResults([]);
    setOpen(false);
    onSelect({
      name: short,
      lat: r.lat,
      lon: r.lon,
      region: r.region || '',
      country: r.country || '',
      countryCode: r.countryCode || '',
    });
  }

  return (
    <div className="field autocomplete">
      {label && <label>{label}</label>}
      <input
        value={text}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="suggest-list">
          {results.map((r, i) => (
            <div key={i} className="suggest-item" onMouseDown={() => pick(r)}>
              <span className="suggest-pin">📍</span>
              <span className="suggest-text">
                <span className="suggest-place">{r.place || (r.label || r.name).split(',')[0]}</span>
                <span className="suggest-region muted">
                  {[r.region, r.country].filter(Boolean).join(', ') ||
                    (r.name || '').split(',').slice(1).join(',').trim()}
                </span>
              </span>
              {r.type && <span className="suggest-type">{r.type}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
