import { useEffect, useMemo, useState } from 'react';
import PlaceInput from './PlaceInput';
import RoadsterIcon from './RoadsterIcon';
import { useI18n } from '../i18n.jsx';
import { api } from '../api';
import { getTravelAdvice } from '../travelAdvice';
import { buildTemplateItinerary } from '../tripTemplates';

const MODES = [
  { id: 'car', icon: <RoadsterIcon size={32} />, title: 'Car', detail: 'Build a flexible road trip with your own stops.' },
  { id: 'flight', icon: '✈️', title: 'Plane', detail: 'Compare live airline departures and times.' },
  { id: 'train', icon: '🚆', title: 'Train', detail: 'See train times, transfers, and stops on the way.' },
  { id: 'bus', icon: '🚌', title: 'Bus', detail: 'Find scheduled coach and bus journeys.' },
];
const PREFERENCES = [
  { id: 'sightseeing', label: 'Famous sights' },
  { id: 'nature', label: 'Nature and parks' },
  { id: 'museums', label: 'Museums and art' },
  { id: 'food', label: 'Food and local restaurants' },
  { id: 'family', label: 'Family activities' },
  { id: 'shopping', label: 'Markets and shopping' },
  { id: 'history', label: 'History and landmarks' },
];
const PACE_OPTIONS = [
  { id: 'relaxed', label: 'Relaxed', detail: 'About 1 planned place per day' },
  { id: 'balanced', label: 'Balanced', detail: 'About 2 planned places per day' },
  { id: 'full', label: 'Full days', detail: 'About 3 planned places per day' },
];

function emptyItinerary(days, startDate) {
  return Array.from({ length: days }, (_, index) => {
    let date = null;
    if (startDate) {
      const value = new Date(`${startDate}T12:00:00`);
      value.setDate(value.getDate() + index);
      date = value.toISOString().slice(0, 10);
    }
    return { date, stops: [] };
  });
}

function formatTime(value) {
  if (!value) return 'Time unavailable';
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(seconds) {
  const hours = Math.floor(Number(seconds || 0) / 3600);
  const minutes = Math.round((Number(seconds || 0) % 3600) / 60);
  return `${hours ? `${hours}h ` : ''}${minutes}m`;
}

function localDateTime(date, time) {
  const local = new Date(`${date}T${time}:00`);
  const offsetMinutes = -local.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hours}:${minutes}`;
}

export default function TripForm({ onCreated, onCancel, initialTemplate = null }) {
  const { t } = useI18n();
  const [origin, setOrigin] = useState({ name: '', lat: null, lon: null });
  const [dest, setDest] = useState(initialTemplate?.destination || { name: '', lat: null, lon: null });
  const [date, setDate] = useState('');
  const [departureTime, setDepartureTime] = useState('08:00');
  const [mode, setMode] = useState(
    initialTemplate?.modes?.length === 1 ? initialTemplate.recommendedMode : (initialTemplate ? '' : 'car'),
  );
  const [options, setOptions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [attribution, setAttribution] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [tripDays, setTripDays] = useState(initialTemplate ? 3 : 1);
  const [preferences, setPreferences] = useState(['sightseeing', 'nature', 'food']);
  const [pace, setPace] = useState('balanced');
  const [planning, setPlanning] = useState(false);
  const [itineraryPrepared, setItineraryPrepared] = useState(Boolean(initialTemplate));
  const maxTripDays = initialTemplate
    ? Math.max(1, Math.min(7, initialTemplate.places.length - 2))
    : 7;
  const travelAdvice = useMemo(
    () => getTravelAdvice(origin, dest, initialTemplate),
    [origin.lat, origin.lon, origin.countryCode, dest.lat, dest.lon, dest.countryCode, initialTemplate?.id],
  );
  const templateItinerary = useMemo(
    () => initialTemplate ? buildTemplateItinerary(initialTemplate, tripDays, date) : null,
    [initialTemplate?.id, tripDays, date],
  );
  const [draftItinerary, setDraftItinerary] = useState(
    templateItinerary || emptyItinerary(tripDays, date),
  );

  useEffect(() => {
    if (mode && !travelAdvice.available.includes(mode)) {
      setMode('');
      resetSearch();
    }
  }, [travelAdvice.available.join(',')]);

  useEffect(() => {
    setItineraryPrepared(Boolean(initialTemplate));
    setDraftItinerary(templateItinerary || emptyItinerary(tripDays, date));
  }, [
    origin.lat,
    origin.lon,
    dest.lat,
    dest.lon,
    mode,
    tripDays,
    date,
    pace,
    preferences.join('|'),
    templateItinerary,
  ]);

  function resetSearch() {
    setOptions([]);
    setSelectedOption(null);
    setAttribution('');
    setError('');
    setNotice('');
  }

  function chooseMode(nextMode) {
    setMode(nextMode);
    resetSearch();
  }

  function togglePreference(preference) {
    setPreferences((current) => (
      current.includes(preference)
        ? current.filter((item) => item !== preference)
        : [...current, preference]
    ));
  }

  async function resolvePlaces() {
    if (origin.lat == null || origin.lon == null || dest.lat == null || dest.lon == null) {
      throw new Error('Select both locations from the search suggestions.');
    }
    return { o: origin, d: dest };
  }

  async function createTrip(o, d, option) {
    const trip = await api.createTrip({
      title: `${(o.name || origin.name).split(',')[0]} → ${(d.name || dest.name).split(',')[0]}`,
      origin: origin.name,
      origin_lat: o.lat,
      origin_lon: o.lon,
      destination: dest.name,
      dest_lat: d.lat,
      dest_lon: d.lon,
      start_date: date || null,
      travel_mode: mode,
      travel_option: option,
      itinerary: draftItinerary,
    });
    onCreated(trip);
  }

  async function prepareItinerary(o = origin, d = dest) {
    setError('');
    if (initialTemplate) {
      setDraftItinerary(templateItinerary);
      setItineraryPrepared(true);
      setNotice('Your destination plan is ready. Remove a stop or add another place if you want.');
      return true;
    }
    if (o.lat == null || o.lon == null || d.lat == null || d.lon == null) {
      setError('Select both locations from the search suggestions before preparing the itinerary.');
      return false;
    }
    if (!mode) {
      setError('Choose how you want to travel before preparing the itinerary.');
      return false;
    }
    if (!preferences.length) {
      setError('Choose at least one trip interest.');
      return false;
    }
    setPlanning(true);
    try {
      const result = await api.suggestItinerary({
        origin_lat: o.lat,
        origin_lon: o.lon,
        dest_lat: d.lat,
        dest_lon: d.lon,
        travel_mode: mode,
        days: tripDays,
        start_date: date || null,
        preferences,
        pace,
        seed_itinerary: templateItinerary || [],
      });
      setDraftItinerary(result.itinerary);
      setItineraryPrepared(true);
      setNotice(result.message);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setPlanning(false);
    }
  }

  function removeDraftStop(dayIndex, stopIndex) {
    setDraftItinerary((current) => current.map((day, index) => (
      index === dayIndex
        ? { ...day, stops: day.stops.filter((_, itemIndex) => itemIndex !== stopIndex) }
        : day
    )));
  }

  function addDraftStop(dayIndex, place) {
    if (!place?.name || place.lat == null || place.lon == null) return;
    setDraftItinerary((current) => {
      if (current[dayIndex].stops.length >= 6) {
        setError('Each day can contain up to 6 planned stops.');
        return current;
      }
      return current.map((day, index) => (
        index === dayIndex
          ? { ...day, stops: [...day.stops, place] }
          : day
      ));
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!origin.name || !dest.name) {
      setError(t('form_err_places'));
      return;
    }
    if (!mode) {
      setError('Choose how you want to travel.');
      return;
    }
    if (mode !== 'car' && !date) {
      setError(t('form_err_date'));
      return;
    }
    setSaving(true);
    try {
      const { o, d } = await resolvePlaces();
      if (!itineraryPrepared) {
        await prepareItinerary(o, d);
        return;
      }
      if (mode === 'car') {
        await createTrip(o, d, null);
        return;
      }
      if (selectedOption) {
        await createTrip(o, d, selectedOption);
        return;
      }
      const result = await api.searchTransport({
        mode,
        origin: origin.name,
        origin_lat: o.lat,
        origin_lon: o.lon,
        destination: dest.name,
        dest_lat: d.lat,
        dest_lon: d.lon,
        date,
        departure_datetime: localDateTime(date, departureTime),
      });
      setOptions(result.options || []);
      setAttribution(result.attribution || '');
      setNotice(result.options?.length ? (result.message || '') : '');
      if (result.options?.length) {
        setSelectedOption(result.options[0]);
      } else {
        setError(result.message || t('transport_not_found'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('form_title')}</h2>
      <p className="muted">{t('form_sub')}</p>
      {initialTemplate && (
        <div className="template-form-guide">
          <span>Selected template</span>
          <h3>{initialTemplate.title}</h3>
          <p>{travelAdvice.summary}</p>
          <div>
            <b>
              {travelAdvice.recommended
                ? `Recommended from your starting point: ${MODES.find((item) => item.id === travelAdvice.recommended)?.title}`
                : 'Choose your starting point to get a travel recommendation'}
            </b>
            <small>
              {travelAdvice.distanceKm == null ? 'Potential options: ' : 'Available from this origin: '}
              {travelAdvice.available
                .map((templateMode) => MODES.find((item) => item.id === templateMode)?.title)
                .filter(Boolean)
                .join(', ')}.
            </small>
          </div>
          <div className="template-top-pick">
            <b>Best thing to see: {initialTemplate.topPick}</b>
            <small>Short trips keep only the highest-ranked places. Longer trips add more of the destination.</small>
          </div>
        </div>
      )}
      <form onSubmit={submit}>
        <PlaceInput
          label={t('form_from')}
          placeholder={t('form_from_ph')}
          onSelect={(place) => { setOrigin(place); resetSearch(); }}
        />
        <PlaceInput
          label={t('form_to')}
          placeholder={t('form_to_ph')}
          value={initialTemplate?.destination?.name || ''}
          onSelect={(place) => { setDest(place); resetSearch(); }}
        />
        {initialTemplate ? (
          <div className="template-days-only">
            <span className="section-kicker">Your trip length</span>
            <h3>How many days do you want?</h3>
            <p className="muted">
              Wander automatically keeps the best activities for short trips and adds more experiences for longer trips.
            </p>
            <select
              value={tripDays}
              onChange={(event) => {
                setTripDays(Number(event.target.value));
                resetSearch();
              }}
            >
              {Array.from({ length: maxTripDays }, (_, index) => index + 1).map((days) => (
                <option value={days} key={days}>{days} day{days === 1 ? '' : 's'}</option>
              ))}
            </select>
          </div>
        ) : (
        <div className="preference-builder">
          <span className="section-kicker">Personalize your itinerary</span>
          <h3>What do you enjoy?</h3>
          <p className="muted">Wander will prepare your days with real places matching these interests.</p>
          <div className="preference-grid">
            {PREFERENCES.map((preference) => (
              <button
                type="button"
                key={preference.id}
                className={preferences.includes(preference.id) ? 'selected' : ''}
                onClick={() => togglePreference(preference.id)}
              >
                {preference.label}
              </button>
            ))}
          </div>
          <div className="preference-controls">
            <label>
              Trip length
              <select
                value={tripDays}
                onChange={(event) => {
                  setTripDays(Number(event.target.value));
                  resetSearch();
                }}
              >
                {Array.from({ length: maxTripDays }, (_, index) => index + 1).map((days) => (
                  <option value={days} key={days}>{days} day{days === 1 ? '' : 's'}</option>
                ))}
              </select>
            </label>
            <label>
              Daily pace
              <select value={pace} onChange={(event) => setPace(event.target.value)}>
                {PACE_OPTIONS.map((item) => (
                  <option value={item.id} key={item.id}>{item.label} — {item.detail}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="prepare-itinerary"
            onClick={() => prepareItinerary()}
            disabled={planning}
          >
            {planning ? 'Finding the best places…' : (itineraryPrepared ? 'Refresh suggestions' : 'Prepare my itinerary')}
          </button>
        </div>
        )}
        {itineraryPrepared && (
          <div className="draft-itinerary">
            <div className="row spread wrap">
              <div>
                <span className="section-kicker">Ready to review</span>
                <h3>Your prepared itinerary</h3>
              </div>
              <span className="pill">Remove or add any stop</span>
            </div>
            {draftItinerary.map((day, dayIndex) => (
              <div className="draft-day" key={dayIndex}>
                <div className="draft-day-head">
                  <b>Day {dayIndex + 1}{day.date ? ` · ${day.date}` : ''}</b>
                  <small>{day.stops.length} planned stop{day.stops.length === 1 ? '' : 's'}</small>
                </div>
                {day.stops.length === 0 && <p className="muted">No stop yet. Add one below.</p>}
                {day.stops.map((stop, stopIndex) => (
                  <div className="draft-stop" key={`${stop.name}-${stopIndex}`}>
                    <div>
                      <b>{stop.name}</b>
                      {stop.details && <small>{stop.details}</small>}
                    </div>
                    <button
                      type="button"
                      className="danger small"
                      onClick={() => removeDraftStop(dayIndex, stopIndex)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <PlaceInput
                  key={`draft-${dayIndex}-${day.stops.length}`}
                  label="Add another stop"
                  placeholder="Search for any place"
                  onSelect={(place) => addDraftStop(dayIndex, place)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="field">
          <label>{t('form_mode')}</label>
          <div className="mode-grid">
            {MODES.map((item) => {
              const supportedByDestination = !initialTemplate || initialTemplate.modes.includes(item.id);
              const unavailableReason = supportedByDestination
                ? travelAdvice.unavailable[item.id]
                : 'This destination template does not support this arrival method.';
              const unavailable = Boolean(unavailableReason);
              return (
              <button
                key={item.id}
                type="button"
                className={`mode-card ${mode === item.id ? 'active' : ''} ${unavailable ? 'unavailable' : ''}`}
                onClick={() => chooseMode(item.id)}
                disabled={unavailable}
                title={unavailableReason || ''}
              >
                <span className="mode-icon">{item.icon}</span>
                <span>
                  <b>{item.title}</b>
                  <small>{item.detail}</small>
                  {unavailable ? (
                    <em className="unavailable-label">{unavailableReason}</em>
                  ) : travelAdvice.distanceKm != null ? (
                    <em className={item.id === travelAdvice.recommended ? 'recommended' : ''}>
                      {item.id === travelAdvice.recommended ? 'Recommended from your origin' : 'Available from your origin'}
                    </em>
                  ) : initialTemplate?.modes.includes(item.id) ? (
                    <em>Potential option</em>
                  ) : null}
                </span>
              </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label>{t('form_date')}</label>
          <input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => { setDate(e.target.value); resetSearch(); }}
          />
        </div>
        {mode !== 'car' && (
          <div className="field">
            <label>{t('form_departure_time')}</label>
            <input
              type="time"
              value={departureTime}
              onChange={(e) => { setDepartureTime(e.target.value); resetSearch(); }}
            />
          </div>
        )}
        {options.length > 0 && (
          <div className="transport-results">
            <div className="row spread wrap">
              <h3>{t('transport_choose', { mode: MODES.find((item) => item.id === mode)?.title })}</h3>
              <span className="pill">{options.length} {t('transport_options')}</span>
            </div>
            {options.map((option) => (
              <div className="transport-option-wrap" key={option.id}>
                <button
                  type="button"
                  className={`transport-option ${selectedOption?.id === option.id ? 'selected' : ''}`}
                  onClick={() => setSelectedOption(option)}
                >
                  <span className="transport-option-main">
                    <b>{option.title}</b>
                    <span>{option.origin_station || origin.name} → {option.destination_station || dest.name}</span>
                    {option.availability_unconfirmed
                      ? <small>Airline, time, and price must be confirmed in live search.</small>
                      : <small>{formatTime(option.departure)} → {formatTime(option.arrival)}</small>}
                    {option.date_offset_days !== 0 && (
                      <small>Closest available date: {option.service_date}</small>
                    )}
                  </span>
                  <span className="transport-option-meta">
                    {option.availability_unconfirmed
                      ? <b>Plan now</b>
                      : (
                        <>
                          <b>{formatDuration(option.duration_s)}</b>
                          <small>{option.transfers ? `${option.transfers} transfer${option.transfers === 1 ? '' : 's'}` : t('transport_direct')}</small>
                        </>
                      )}
                    {option.price && <strong>{option.currency ? `${option.currency} ` : ''}{option.price}</strong>}
                    {option.fare_unavailable && <small>Fare not confirmed</small>}
                  </span>
                </button>
                {option.external_search_url && (
                  <a
                    className="live-flight-link"
                    href={option.external_search_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Check live flights and prices ↗
                  </a>
                )}
              </div>
            ))}
            {attribution && (
              <p className="provider-note">
                {attribution}
                {(mode === 'train' || mode === 'bus') && (
                  <> <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">View data sources.</a></>
                )}
              </p>
            )}
          </div>
        )}
        {notice && <div className="banner">{notice}</div>}
        {error && <div className="banner">{error}</div>}
        <div className="row">
          <button type="submit" disabled={saving}>
            {saving
              ? (!itineraryPrepared
                ? 'Preparing itinerary…'
                : (selectedOption || mode === 'car' ? t('form_creating') : t('transport_searching')))
              : (!itineraryPrepared
                ? 'Prepare itinerary'
                : (mode === 'car' || selectedOption ? t('form_start') : t('transport_search')))}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </form>
    </div>
  );
}
