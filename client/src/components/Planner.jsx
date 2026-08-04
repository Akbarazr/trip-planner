import { useState, useEffect, useCallback } from 'react';
import MapView from './MapView';
import Chat from './Chat';
import DayTip from './DayTip';
import PlaceInput from './PlaceInput';
import MapIcon from './MapIcon';
import RoadsterIcon from './RoadsterIcon';
import OfflinePanel from './OfflinePanel';
import { useI18n } from '../i18n.jsx';
import { api } from '../api';
import { auth } from '../firebase';
import { cacheRoute, getCachedRoute } from '../offline';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

function fmtDist(m) { return (m / 1609.34).toFixed(0) + ' mi'; }
function fmtDur(s) {
  const h = Math.floor(s / 3600), min = Math.round((s % 3600) / 60);
  return h ? `${h}h ${min}m` : `${min}m`;
}

const MODE_INFO = {
  car: { icon: <RoadsterIcon size={25} />, label: 'Car', color: '#0f766e' },
  flight: { icon: '✈️', label: 'Plane', color: '#38bdf8' },
  train: { icon: '🚆', label: 'Train', color: '#7c3aed' },
  bus: { icon: '🚌', label: 'Bus', color: '#f59e0b' },
};

function fmtDateTime(value) {
  if (!value) return 'Time unavailable';
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function JourneyDetails({ option, mode }) {
  if (!option) return null;
  const info = MODE_INFO[mode];
  if (option.availability_unconfirmed) {
    return (
      <div className="card journey-card">
        <span className="pill">{info.icon} {info.label}</span>
        <h3>{option.title}</h3>
        <p className="muted">
          {option.origin_station || 'Departure'} → {option.destination_station || 'Arrival'}
        </p>
        <div className="banner">
          Your flight plan is saved, but the airline, schedule, and fare have not been confirmed.
        </div>
        {option.external_search_url && (
          <a
            className="live-flight-link standalone"
            href={option.external_search_url}
            target="_blank"
            rel="noreferrer"
          >
            Check live flights and prices ↗
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="card journey-card">
      <div className="row spread wrap">
        <div>
          <span className="pill">{info.icon} {info.label}</span>
          <h3>{option.title}</h3>
          <div className="muted">
            {option.origin_station || 'Departure'} → {option.destination_station || 'Arrival'}
          </div>
        </div>
        {(option.price || option.fare_unavailable) && (
          <div className="journey-price">
            <small>Estimated fare</small>
            <b>{option.price ? `${option.currency || ''} ${option.price}`.trim() : 'Unavailable from operator'}</b>
          </div>
        )}
      </div>

      <div className="journey-times">
        <div><small>Leaves</small><b>{fmtDateTime(option.departure)}</b></div>
        <div><small>Arrives</small><b>{fmtDateTime(option.arrival)}</b></div>
        <div><small>Travel time</small><b>{fmtDur(option.duration_s)}</b></div>
        <div><small>Changes</small><b>{option.transfers || 'Direct'}</b></div>
      </div>

      {option.date_offset_days !== 0 && (
        <div className="banner">
          No {info.label.toLowerCase()} was found on {option.requested_date}. This is the closest available option on {option.service_date}.
        </div>
      )}

      <div className="journey-legs">
        {(option.segments || []).map((segment, index) => {
          const from = typeof segment.from === 'string' ? segment.from : segment.from?.name;
          const to = typeof segment.to === 'string' ? segment.to : segment.to?.name;
          const service = segment.flight_number ||
            [segment.provider, segment.service, segment.number].filter(Boolean).join(' · ') ||
            segment.mode;
          return (
            <div className="journey-leg" key={`${service}-${index}`}>
              <div className="journey-leg-icon">
                {segment.mode === 'WALK' ? '🚶' : (mode === 'flight' ? '✈️' : info.icon)}
              </div>
              <div>
                <b>{service}</b>
                <div>{from} → {to}</div>
                <small>{fmtDateTime(segment.departure)} → {fmtDateTime(segment.arrival)}</small>
                {segment.headsign && <small>Direction: {segment.headsign}</small>}
                {segment.connection_wait_s != null && (
                  <small>
                    Wait {fmtDur(segment.connection_wait_s)} at {segment.connection_station || to} before the next {mode === 'bus' ? 'bus' : 'service'}.
                  </small>
                )}
                {segment.intermediate_stops?.length > 0 && (
                  <details>
                    <summary>{segment.intermediate_stops.length} stops on the way</summary>
                    <ol className="journey-stops">
                      {segment.intermediate_stops.map((stop, stopIndex) => (
                        <li key={`${stop.stop_id || stop.name}-${stopIndex}`}>
                          <span>{stop.name}</span>
                          <small>{fmtDateTime(stop.arrival || stop.departure)}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="provider-note">
        {mode === 'flight'
          ? 'Live airline availability supplied by Amadeus. Recheck the fare and schedule before booking.'
          : (
            <>
              Schedule data supplied by Transitous and its source transport operators.{' '}
              <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">View data sources.</a>
            </>
          )}
      </p>
    </div>
  );
}

function EditTripLocations({ trip, onSaved, onCancel }) {
  const [origin, setOrigin] = useState({
    name: trip.origin,
    lat: trip.origin_lat,
    lon: trip.origin_lon,
  });
  const [destination, setDestination] = useState({
    name: trip.destination,
    lat: trip.dest_lat,
    lon: trip.dest_lon,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event) {
    event.preventDefault();
    setError('');
    if (
      origin.lat == null || origin.lon == null ||
      destination.lat == null || destination.lon == null
    ) {
      setError('Select both locations from the search suggestions.');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateTripLocations(trip.id, {
        origin: origin.name,
        origin_lat: origin.lat,
        origin_lon: origin.lon,
        destination: destination.name,
        dest_lat: destination.lat,
        dest_lon: destination.lon,
      });
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="trip-location-editor" onSubmit={save}>
      <h3>Edit trip locations</h3>
      <p className="muted">Type at least three letters, then select a predefined location from the list.</p>
      <PlaceInput
        label="Starting location"
        value={trip.origin}
        placeholder="Search starting location"
        onSelect={setOrigin}
      />
      <PlaceInput
        label="Ending location"
        value={trip.destination}
        placeholder="Search ending location"
        onSelect={setDestination}
      />
      {error && <div className="banner">{error}</div>}
      <div className="row">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save locations'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const POLL_CATEGORIES = ['destination', 'restaurant', 'activity', 'lodging', 'other'];

function PollPanel({
  trip, onChange, readOnly, shareToken, viewer,
}) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('restaurant');
  const [error, setError] = useState('');
  const options = trip.poll_options || [];

  async function addOption(event) {
    event.preventDefault();
    setError('');
    try {
      const updated = await api.addPollOption(trip.id, { label: label.trim(), category });
      setLabel('');
      onChange(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function vote(optionId) {
    setError('');
    try {
      onChange(await api.voteSharedOption(shareToken, optionId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card poll-card">
      <span className="section-kicker">Plan together</span>
      <h3>Group voting</h3>
      {!readOnly && <div className="group-voting-active">Group voting activated</div>}
      <p className="muted">
        {readOnly ? 'Vote for the choices you prefer.' : 'Add choices, then share the trip link with your group.'}
      </p>
      {!readOnly && (
        <form className="poll-form" onSubmit={addOption}>
          <input
            value={label}
            placeholder="Restaurant, hotel, or activity"
            onChange={(event) => setLabel(event.target.value)}
            required
          />
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {POLL_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button type="submit" className="small">Add choice</button>
        </form>
      )}
      {readOnly && !viewer && (
        <button
          className="google-button poll-signin"
          onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
        >
          Sign in with Google to vote
        </button>
      )}
      {error && <div className="banner">{error}</div>}
      <div className="poll-list">
        {options.length === 0 && <p className="muted">No choices have been added yet.</p>}
        {options.map((option) => (
          <div className={`poll-option ${option.user_voted ? 'voted' : ''}`} key={option.id}>
            <div>
              <span className="expense-category">{option.category}</span>
              <b>{option.label}</b>
            </div>
            <div className="poll-actions">
              <span>{option.vote_count || 0} vote{option.vote_count === 1 ? '' : 's'}</span>
              {readOnly && viewer && (
                <button className="small" onClick={() => vote(option.id)}>
                  {option.user_voted ? 'Remove vote' : 'Vote'}
                </button>
              )}
              {!readOnly && (
                <button
                  className="danger small"
                  onClick={async () => onChange(await api.deletePollOption(option.id))}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Planner({
  trip: initial, onBack, onChanged, readOnly = false, shareToken = null, viewer = null,
}) {
  const { t } = useI18n();
  const [trip, setTrip] = useState(initial);
  const [route, setRoute] = useState(null);
  const [routeErr, setRouteErr] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [addingFor, setAddingFor] = useState(null); // day id we're adding a stop to
  const [editingLocations, setEditingLocations] = useState(false);
  const [locationEditError, setLocationEditError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const mode = trip.travel_mode || 'car';
  const modeInfo = MODE_INFO[mode];
  const journey = trip.travel_option;

  const refresh = useCallback(async () => {
    const t = await api.getTrip(trip.id);
    setTrip(t);
    onChanged?.();
    return t;
  }, [trip.id]);

  // Build the full ordered list of coordinate points: origin -> stops -> destination.
  function orderedPoints(t) {
    const pts = [];
    if (t.origin_lat != null) pts.push({ lat: t.origin_lat, lon: t.origin_lon, label: `Start: ${t.origin}`, color: '#557153' });
    for (const day of t.days) {
      for (const s of day.stops) {
        if (s.lat != null) pts.push({ lat: s.lat, lon: s.lon, label: `Day ${day.day_number}: ${s.name}`, color: '#6b8e5a' });
      }
    }
    if (t.dest_lat != null) pts.push({ lat: t.dest_lat, lon: t.dest_lon, label: `End: ${t.destination}`, color: '#a9683f' });
    return pts;
  }

  const plannedMarkers = trip.days.flatMap((day) => day.stops
    .filter((stop) => stop.lat != null)
    .map((stop) => ({
      lat: stop.lat,
      lon: stop.lon,
      label: `Day ${day.day_number}: ${stop.name}`,
      color: '#6b8e5a',
    })));
  const scheduledMarkers = (journey?.map_points || []).map((point, index, points) => ({
    ...point,
    color: index === 0 ? '#557153' : (index === points.length - 1 ? '#a9683f' : modeInfo.color),
  }));
  const markers = mode === 'car'
    ? orderedPoints(trip)
    : (scheduledMarkers.length ? [...scheduledMarkers, ...plannedMarkers] : orderedPoints(trip));
  const journeyLine = mode !== 'car' && (journey?.map_points?.length || 0) >= 2
    ? { coordinates: journey.map_points.map((point) => [point.lon, point.lat]) }
    : null;

  // Recompute the driving route whenever the stops change.
  useEffect(() => {
    if (mode !== 'car') {
      setRoute(null);
      setRouteErr('');
      return undefined;
    }
    const pts = orderedPoints(trip);
    if (pts.length < 2) { setRoute(null); return; }
    let cancelled = false;
    setRouteErr('');
    api.route(pts)
      .then((r) => {
        if (cancelled) return;
        setRoute(r);
        cacheRoute(auth.currentUser?.uid, trip.id, r).catch((error) => {
          console.error('Could not refresh offline route cache', error);
        });
      })
      .catch(async (e) => {
        if (cancelled) return;
        const cached = await getCachedRoute(auth.currentUser?.uid, trip.id);
        if (cancelled) return;
        setRoute(cached);
        setRouteErr(cached ? 'Using the route saved on this device.' : e.message);
      });
    return () => { cancelled = true; };
  }, [mode, JSON.stringify(markers.map((m) => [m.lat, m.lon]))]);


  async function addDay() {
    const last = trip.days[trip.days.length - 1];
    let nextDate = null;
    if (last?.date) {
      const d = new Date(last.date); d.setDate(d.getDate() + 1);
      nextDate = d.toISOString().slice(0, 10);
    }
    setTrip(await api.addDay(trip.id, { date: nextDate }));
  }

  async function addStop(dayId, place) {
    if (!place?.name) return;
    setTrip(await api.addStop(dayId, place));
    setAddingFor(null);
  }

  function startLocationEdit() {
    setLocationEditError('');
    if (mode !== 'car') {
      setLocationEditError(
        'Plane, train, and bus locations are tied to the selected journey. Create a new scheduled trip to change them.',
      );
      return;
    }
    setEditingLocations(true);
  }

  function locationSaved(updated) {
    setTrip(updated);
    setSuggestions([]);
    setEditingLocations(false);
    setLocationEditError('');
    onChanged?.();
  }

  async function shareTrip() {
    setShareMessage('');
    try {
      const { token } = await api.shareTrip(trip.id);
      setTrip((current) => ({ ...current, share_token: token }));
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('share', token);
      const link = url.toString();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement('textarea');
        input.value = link;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setShareMessage('Group voting activated. Share link copied.');
    } catch (error) {
      setShareMessage(error.message);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="row spread wrap">
          <div>
            <h2 style={{ margin: '0 0 4px' }}>{trip.title}</h2>
            <div className="muted">
              {trip.origin.split(',')[0]} → {trip.destination.split(',')[0]}
              {trip.start_date ? ` · ${t('starting', { date: trip.start_date })}` : ''}
              {' · '}{modeInfo.icon} {modeInfo.label}
            </div>
          </div>
          <div className="row wrap">
            {!readOnly && <button className="ghost" onClick={shareTrip}>Share trip</button>}
            {!readOnly && <button className="ghost" onClick={startLocationEdit}>Edit locations</button>}
            <button className="ghost" onClick={onBack}>{t('all_trips')}</button>
          </div>
        </div>
        {readOnly && <div className="banner">Shared trip · Read only</div>}
        {trip.offline && <div className="banner">Offline copy · Changes are unavailable until you reconnect.</div>}
        {shareMessage && <div className="banner">{shareMessage}</div>}
        {editingLocations && (
          <EditTripLocations
            trip={trip}
            onSaved={locationSaved}
            onCancel={() => setEditingLocations(false)}
          />
        )}
        {locationEditError && <div className="banner">{locationEditError}</div>}
        {route && (
          <div className="route-stats">
            <div className="stat"><b>{fmtDist(route.distance_m)}</b><span className="muted">{t('stat_drive')}</span></div>
            <div className="stat"><b>{fmtDur(route.duration_s)}</b><span className="muted">{t('stat_time')}</span></div>
            <div className="stat"><b>{trip.days.length}</b><span className="muted">{t('stat_days')}</span></div>
          </div>
        )}
        {route?.approximate && <div className="banner">{t('route_busy')}</div>}
        {routeErr && <div className="banner">{t('route_note', { msg: routeErr })}</div>}
        {mode !== 'car' && journey && (
          <div className="route-stats">
            <div className="stat"><b>{fmtDur(journey.duration_s)}</b><span className="muted">travel time</span></div>
            <div className="stat"><b>{fmtDateTime(journey.departure).split(',').at(-1)}</b><span className="muted">departure</span></div>
            <div className="stat"><b>{journey.transfers || 0}</b><span className="muted">transfers</span></div>
          </div>
        )}
      </div>

      {mode !== 'car' && <JourneyDetails option={journey} mode={mode} />}

      <div className="planner-grid">
        {/* LEFT: Cotrip chat on top, day-by-day itinerary below */}
        <div>
          {!readOnly && (
            <Chat
              tripId={trip.id}
              onPlaces={(pl) => setSuggestions(pl)}
            />
          )}

          <div className="card">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{t('itinerary')}</h3>
              {!readOnly && <button className="small" onClick={addDay}>{t('add_day')}</button>}
            </div>

            {trip.days.map((day) => (
              <div className="day" key={day.id}>
                <div className="day-head">
                  <h4>{t('day', { n: day.day_number })}{day.date ? ` · ${day.date}` : ''}</h4>
                  {!readOnly && trip.days.length > 1 && (
                    <button className="danger small" onClick={async () => setTrip(await api.deleteDay(day.id))}>{t('remove')}</button>
                  )}
                </div>
                <DayTip
                  tripId={trip.id}
                  day={day.day_number}
                  stopsKey={day.stops.map((s) => s.id).join(',')}
                  onPlace={(p) => setSuggestions([{ ...p, kind: 'ai' }])}
                />
                {day.stops.length === 0 && (
                  <div className="muted" style={{ marginBottom: 8 }}>
                    {mode === 'car' ? t('no_stops') : 'No activities planned yet — add places to visit after you arrive.'}
                  </div>
                )}
                {day.stops.map((s) => (
                  <div className="stop" key={s.id}>
                    <span>📍 {s.name.split(',').slice(0, 2).join(',')}</span>
                    {!readOnly && (
                      <button className="danger small" onClick={async () => setTrip(await api.deleteStop(s.id))}>✕</button>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  addingFor === day.id ? (
                    <PlaceInput
                      label={t('add_place_label')}
                      placeholder={t('search_ph')}
                      onSelect={(p) => p.lat && addStop(day.id, p)}
                    />
                  ) : (
                    <button className="ghost small" onClick={() => setAddingFor(day.id)}>{t('add_stop')}</button>
                  )
                )}
              </div>
            ))}
          </div>
          {(readOnly || trip.share_token) && (
            <PollPanel
              trip={trip}
              onChange={setTrip}
              readOnly={readOnly}
              shareToken={shareToken}
              viewer={viewer}
            />
          )}
        </div>

        {/* RIGHT: map + suggestions + AI */}
        <div>
          <div className="card">
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 7 }}><MapIcon size={21} /> {t('your_route')}</h3>
            <MapView
              markers={markers}
              routeLine={mode === 'car' ? route?.geometry : journeyLine}
              routeColor={modeInfo.color}
              suggestions={suggestions}
            />
            {!readOnly && <OfflinePanel trip={trip} route={mode === 'car' ? route : journeyLine} />}
            {suggestions.length > 0 ? (
              <div className="row spread" style={{ marginTop: 10 }}>
                <div className="muted">{t('suggest_showing', { n: suggestions.length })}</div>
                <button className="ghost small" onClick={() => setSuggestions([])}>{t('clear_pins')}</button>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 10 }}>{t('options_hint')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
