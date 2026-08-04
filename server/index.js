import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomBytes } from 'crypto';
import { pathToFileURL } from 'url';
import storage from './storage.js';
import { authenticate } from './auth.js';
import {
  geocode, geocodeNear, haversine, route, nearbyPlaces, nearbyPlacesTerms, highlyRatedPlaces,
  sampleAlongGeometry, pointAtFraction,
} from './maps.js';
import { chat } from './ai.js';
import { searchFlights, searchTransit } from './transport.js';

const app = express();
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.use(express.json());
app.use(authenticate);

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  });

const validShareToken = (token) => /^[A-Za-z0-9_-]{20,40}$/.test(token);

// ---------- trips ----------
app.get('/api/trips', wrap(async (req, res) => {
  res.json(await storage.listTrips(req.user.uid));
}));

app.get('/api/trips/:id', wrap(async (req, res) => {
  const trip = await storage.getTrip(req.params.id, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(trip);
}));

app.post('/api/trips/:id/share', wrap(async (req, res) => {
  const token = await storage.ensureShareToken(
    req.params.id,
    req.user.uid,
    randomBytes(18).toString('base64url'),
  );
  if (!token) return res.status(404).json({ error: 'Trip not found' });
  res.json({ token });
}));

const getSharedTrip = wrap(async (req, res) => {
  if (!validShareToken(req.params.token)) {
    return res.status(404).json({ error: 'Shared trip not found' });
  }
  const trip = await storage.getSharedTrip(req.params.token, req.user?.uid);
  if (!trip) return res.status(404).json({ error: 'Shared trip not found' });
  res.json(trip);
});
app.get('/api/shared/:token', getSharedTrip);
app.get('/shared/:token', getSharedTrip);

app.post('/api/shared/:token/votes/:optionId', wrap(async (req, res) => {
  if (!validShareToken(req.params.token)) {
    return res.status(404).json({ error: 'Shared trip or poll option not found' });
  }
  const trip = await storage.toggleSharedVote(
    req.params.token,
    req.params.optionId,
    req.user.uid,
  );
  if (!trip) return res.status(404).json({ error: 'Shared trip or poll option not found' });
  res.json(trip);
}));

app.post('/api/trips', wrap(async (req, res) => {
  const {
    title, origin, origin_lat, origin_lon,
    destination, dest_lat, dest_lon, start_date, travel_mode = 'car', travel_option = null,
    itinerary = null,
  } = req.body;
  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination are required' });
  }
  const allowedModes = new Set(['car', 'flight', 'train', 'bus']);
  if (!allowedModes.has(travel_mode)) {
    return res.status(400).json({ error: 'Unsupported travel mode' });
  }
  if (travel_mode !== 'car' && !travel_option) {
    return res.status(400).json({ error: 'Select a live travel option before creating this trip' });
  }
  let cleanItinerary = null;
  if (itinerary != null) {
    if (!Array.isArray(itinerary) || itinerary.length < 1 || itinerary.length > 7) {
      return res.status(400).json({ error: 'Template itinerary must contain 1 to 7 days' });
    }
    cleanItinerary = itinerary.map((day) => {
      if (
        day == null || typeof day !== 'object' ||
        (day.date != null && (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date))) ||
        !Array.isArray(day.stops) || day.stops.length > 6
      ) {
        throw Object.assign(new Error('Each itinerary day needs a valid date and up to 6 stops'), { status: 400 });
      }
      return {
        date: day.date || null,
        stops: day.stops.map((stop) => {
          const name = typeof stop?.name === 'string' ? stop.name.trim() : '';
          if (!name || name.length > 180) {
            throw Object.assign(new Error('Each itinerary stop needs a valid name'), { status: 400 });
          }
          const lat = stop.lat == null ? null : Number(stop.lat);
          const lon = stop.lon == null ? null : Number(stop.lon);
          if ((lat != null && !Number.isFinite(lat)) || (lon != null && !Number.isFinite(lon))) {
            throw Object.assign(new Error('Itinerary stop coordinates must be numbers'), { status: 400 });
          }
          return { name, lat, lon };
        }),
      };
    });
  }
  const trip = await storage.createTrip({
    title: title || `${origin} → ${destination}`,
    travel_mode,
    travel_option,
    origin,
    origin_lat,
    origin_lon,
    destination,
    dest_lat,
    dest_lon,
    start_date,
    itinerary: cleanItinerary,
  }, req.user.uid);
  res.status(201).json(trip);
}));

app.put('/api/trips/:id/locations', wrap(async (req, res) => {
  const trip = await storage.getTrip(req.params.id, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if ((trip.travel_mode || 'car') !== 'car') {
    return res.status(409).json({
      error: 'Plane, train, and bus locations are tied to the selected journey. Create a new scheduled trip to change them.',
    });
  }

  const {
    origin, origin_lat, origin_lon, destination, dest_lat, dest_lon,
  } = req.body || {};
  const coordinates = [origin_lat, origin_lon, dest_lat, dest_lon].map(Number);
  if (
    typeof origin !== 'string' || !origin.trim() ||
    typeof destination !== 'string' || !destination.trim() ||
    coordinates.some((value) => !Number.isFinite(value))
  ) {
    return res.status(400).json({
      error: 'Select both starting and ending locations from the search suggestions.',
    });
  }
  if (coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3]) {
    return res.status(400).json({ error: 'Starting and ending locations must be different.' });
  }

  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();
  const title = `${cleanOrigin.split(',')[0]} → ${cleanDestination.split(',')[0]}`;
  const updated = await storage.updateLocations(req.params.id, req.user.uid, {
    title,
    origin: cleanOrigin,
    origin_lat: coordinates[0],
    origin_lon: coordinates[1],
    destination: cleanDestination,
    dest_lat: coordinates[2],
    dest_lon: coordinates[3],
  });
  res.json(updated);
}));

// ---------- budget and group voting ----------
app.put('/api/trips/:id/budget', wrap(async (req, res) => {
  const { budget_amount, budget_currency } = req.body || {};
  if (typeof budget_amount !== 'number' || !Number.isFinite(budget_amount) || budget_amount < 0) {
    return res.status(400).json({ error: 'budget_amount must be a nonnegative number' });
  }
  if (typeof budget_currency !== 'string' || !/^[A-Za-z]{3}$/.test(budget_currency)) {
    return res.status(400).json({ error: 'budget_currency must be a three-letter code' });
  }
  const trip = await storage.updateBudget(req.params.id, req.user.uid, {
    budget_amount,
    budget_currency: budget_currency.toUpperCase(),
  });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(trip);
}));

app.post('/api/trips/:id/expenses', wrap(async (req, res) => {
  const { label, amount, category } = req.body || {};
  const allowedCategories = new Set([
    'transport', 'lodging', 'food', 'activities', 'fuel', 'other',
  ]);
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (!allowedCategories.has(category)) {
    return res.status(400).json({ error: 'Unsupported expense category' });
  }
  const trip = await storage.addExpense(req.params.id, req.user.uid, {
    label: label.trim(),
    amount,
    category,
  });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.status(201).json(trip);
}));

app.delete('/api/expenses/:expenseId', wrap(async (req, res) => {
  const trip = await storage.deleteExpense(req.params.expenseId, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Expense not found' });
  res.json(trip);
}));

app.post('/api/trips/:id/poll-options', wrap(async (req, res) => {
  const { label, category } = req.body || {};
  const allowedCategories = new Set([
    'destination', 'restaurant', 'activity', 'lodging', 'other',
  ]);
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  if (!allowedCategories.has(category)) {
    return res.status(400).json({ error: 'Unsupported poll option category' });
  }
  const trip = await storage.addPollOption(req.params.id, req.user.uid, {
    label: label.trim(),
    category,
  });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.status(201).json(trip);
}));

app.delete('/api/poll-options/:optionId', wrap(async (req, res) => {
  const trip = await storage.deletePollOption(req.params.optionId, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Poll option not found' });
  res.json(trip);
}));

// ---------- preference-based itinerary planning ----------
const ITINERARY_PREFERENCES = {
  sightseeing: {
    label: 'Famous sight',
    googleTypes: ['tourist_attraction', 'cultural_landmark', 'monument'],
  },
  nature: {
    label: 'Nature and parks',
    googleTypes: ['national_park', 'park', 'garden'],
  },
  museums: {
    label: 'Museums and art',
    googleTypes: ['museum', 'art_gallery'],
  },
  food: {
    label: 'Popular restaurant',
    googleTypes: ['restaurant'],
  },
  family: {
    label: 'Family activity',
    googleTypes: ['zoo', 'aquarium', 'amusement_park'],
  },
  shopping: {
    label: 'Popular shopping',
    googleTypes: ['shopping_mall', 'department_store'],
  },
  history: {
    label: 'History and landmarks',
    googleTypes: ['historical_place', 'museum', 'monument'],
  },
};
const ITINERARY_PACE = { relaxed: 1, balanced: 2, full: 3 };

app.post('/api/itinerary/suggest', wrap(async (req, res) => {
  const {
    origin_lat, origin_lon, dest_lat, dest_lon,
    travel_mode = 'car', days = 1, start_date = null,
    preferences = ['sightseeing'], pace = 'balanced', seed_itinerary: seedItinerary = [],
    exclude_places: excludePlaces = [],
  } = req.body || {};
  const coordinates = [origin_lat, origin_lon, dest_lat, dest_lon].map(Number);
  if (coordinates.some((value) => !Number.isFinite(value))) {
    return res.status(400).json({ error: 'Select valid starting and destination locations first' });
  }
  const dayCount = Number(days);
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 7) {
    return res.status(400).json({ error: 'days must be between 1 and 7' });
  }
  if (!['car', 'flight', 'train', 'bus'].includes(travel_mode)) {
    return res.status(400).json({ error: 'Unsupported travel mode' });
  }
  const selectedPreferences = [...new Set(
    (Array.isArray(preferences) ? preferences : [])
      .filter((preference) => ITINERARY_PREFERENCES[preference]),
  )];
  if (!selectedPreferences.length) selectedPreferences.push('sightseeing');
  const stopsPerDay = ITINERARY_PACE[pace] || ITINERARY_PACE.balanced;
  const origin = { lat: coordinates[0], lon: coordinates[1] };
  const destination = { lat: coordinates[2], lon: coordinates[3] };
  let routeGeometry = null;
  if (travel_mode === 'car') {
    try {
      routeGeometry = (await route([origin, destination])).geometry;
    } catch { /* destination-only suggestions still work */ }
  }

  const seen = new Set();
  const itinerary = [];
  let searchFailed = false;
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const fraction = dayCount === 1 ? 1 : (dayIndex + 1) / dayCount;
    const anchor = routeGeometry
      ? (pointAtFraction(routeGeometry, fraction) || destination)
      : destination;
    const preference = selectedPreferences[dayIndex % selectedPreferences.length];
    const config = ITINERARY_PREFERENCES[preference];
    let found = [];
    try {
      found = await highlyRatedPlaces(
        anchor.lat,
        anchor.lon,
        config.googleTypes,
        {
          radius: travel_mode === 'car' && fraction < 1 ? 50000 : 30000,
          excludeNames: Array.isArray(excludePlaces) ? excludePlaces : [],
        },
      );
    } catch (error) {
      if (error.status === 503) throw error;
      searchFailed = true;
    }

    const stops = [];
    for (const place of found) {
      const key = normalize(place.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      stops.push({
        name: place.name,
        lat: place.lat,
        lon: place.lon,
        preference,
        details: place.details || config.label,
        rating: place.rating,
        review_count: place.reviewCount,
        google_maps_url: place.googleMapsUri,
        source: 'google_places',
      });
      if (stops.length >= stopsPerDay) break;
    }
    const seedStops = Array.isArray(seedItinerary?.[dayIndex]?.stops)
      ? seedItinerary[dayIndex].stops
      : [];
    for (const seed of seedStops) {
      const name = typeof seed?.name === 'string' ? seed.name.trim() : '';
      const key = normalize(name);
      if (!name || seen.has(key) || stops.length >= stopsPerDay) continue;
      seen.add(key);
      stops.push({ name, lat: seed.lat ?? null, lon: seed.lon ?? null, preference: 'template' });
    }

    let date = null;
    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      const value = new Date(`${start_date}T12:00:00`);
      value.setDate(value.getDate() + dayIndex);
      date = value.toISOString().slice(0, 10);
    }
    itinerary.push({ date, stops });
  }

  res.json({
    itinerary,
    preferences: selectedPreferences,
    pace,
    message: searchFailed
      ? 'Some Google place searches were temporarily unavailable. Every displayed stop still meets the 4.0+ and 1,000-review requirement.'
      : 'Showing non-religious public places rated 4.0+ on Google with at least 1,000 reviews.',
  });
}));

// ---------- transport availability ----------
app.post('/api/transport/search', wrap(async (req, res) => {
  const {
    mode, origin, destination, origin_lat, origin_lon, dest_lat, dest_lon, date,
    departure_datetime,
  } = req.body || {};
  if (!['flight', 'train', 'bus'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be flight, train, or bus' });
  }
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'origin, destination, and date are required' });
  }
  if ([origin_lat, origin_lon, dest_lat, dest_lon].some((value) => value == null || !Number.isFinite(Number(value)))) {
    return res.status(400).json({ error: 'origin and destination coordinates are required' });
  }
  const args = {
    mode,
    origin,
    destination,
    date,
    departureDateTime: departure_datetime,
    originPoint: { lat: Number(origin_lat), lon: Number(origin_lon) },
    destinationPoint: { lat: Number(dest_lat), lon: Number(dest_lon) },
  };
  if (departure_datetime && Number.isNaN(Date.parse(departure_datetime))) {
    return res.status(400).json({ error: 'departure_datetime must be an ISO date-time' });
  }
  res.json(mode === 'flight' ? await searchFlights(args) : await searchTransit(args));
}));

app.delete('/api/trips/:id', wrap(async (req, res) => {
  const deleted = await storage.deleteTrip(req.params.id, req.user.uid);
  if (!deleted) return res.status(404).json({ error: 'Trip not found' });
  res.json({ ok: true });
}));

// ---------- days ----------
app.post('/api/trips/:id/days', wrap(async (req, res) => {
  const trip = await storage.addDay(req.params.id, req.user.uid, req.body || {});
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.status(201).json(trip);
}));

app.put('/api/days/:dayId', wrap(async (req, res) => {
  const { date, notes } = req.body;
  const trip = await storage.updateDay(req.params.dayId, req.user.uid, { date, notes });
  if (!trip) return res.status(404).json({ error: 'Day not found' });
  res.json(trip);
}));

app.delete('/api/days/:dayId', wrap(async (req, res) => {
  const trip = await storage.deleteDay(req.params.dayId, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Day not found' });
  res.json(trip);
}));

// ---------- stops ----------
app.post('/api/days/:dayId/stops', wrap(async (req, res) => {
  const { name, lat, lon } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const trip = await storage.addStop(req.params.dayId, req.user.uid, { name, lat, lon });
  if (!trip) return res.status(404).json({ error: 'Day not found' });
  res.status(201).json(trip);
}));

app.delete('/api/stops/:stopId', wrap(async (req, res) => {
  const trip = await storage.deleteStop(req.params.stopId, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Stop not found' });
  res.json(trip);
}));

// ---------- maps ----------
app.get('/api/geocode', wrap(async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q required' });
  res.json(await geocode(q));
}));

// points = "lon,lat;lon,lat;..."
app.get('/api/route', wrap(async (req, res) => {
  const raw = req.query.points;
  if (!raw) return res.status(400).json({ error: 'points required' });
  const points = raw.split(';').map((p) => {
    const [lon, lat] = p.split(',').map(Number);
    return { lon, lat };
  });
  if (points.length < 2) return res.status(400).json({ error: 'need at least 2 points' });
  res.json(await route(points));
}));

app.get('/api/places', wrap(async (req, res) => {
  const { lat, lon, kind } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  res.json(await nearbyPlaces(Number(lat), Number(lon), kind));
}));

// Suggest interesting stops along a whole trip's route (on the way + destination).
// Shared: find real places along a trip's route (on the way + at destination).
// Accepts an optional precomputed route to avoid calling the (slow, flaky)
// routing service more than once per request.
// opts: { terms:[most-specific...broadest], fraction:0..1 point along route, strict }
async function computeSuggestions(trip, kind, precomputedRoute, opts = {}) {
  const r = precomputedRoute || await route([
    { lat: trip.origin_lat, lon: trip.origin_lon },
    { lat: trip.dest_lat, lon: trip.dest_lon },
  ]);
  const terms = (opts.terms && opts.terms.length) ? opts.terms : [null]; // null => kind default

  // Where along the route to look. If the user named a fraction ("25% in"),
  // search that point; for specific/sparse requests widen to a small window
  // around it (a halal-indian spot might sit at 22% in the next town over)
  // rather than snapping to a single coordinate.
  let samples;
  let onWayRadius = 6000;
  let radii;
  if (opts.fraction != null) {
    const offsets = opts.strict ? [-0.08, 0, 0.08] : [0];
    samples = offsets
      .map((o) => pointAtFraction(r.geometry, Math.min(Math.max(opts.fraction + o, 0), 1)))
      .filter(Boolean);
    onWayRadius = opts.strict ? 60000 : 25000; // specific/sparse cuisines need a wider net
    // The spot might sit a little past the exact mark — widen if nothing's right there.
    radii = opts.strict ? [onWayRadius, 100000] : [onWayRadius];
  } else {
    // No named position: sample evenly along the whole route. Food (especially
    // sparse cuisines like "halal indian") needs more sample points and a wider
    // net, so a spot slightly off the route still counts when nothing sits
    // exactly on it.
    samples = sampleAlongGeometry(r.geometry, kind === 'food' ? 4 : (opts.pool ? 5 : 4));
    radii = kind === 'food' ? [40000, 100000] : [onWayRadius];
  }

  const destRadius = kind === 'food' ? 20000 : 6000;
  // Search the destination once, in parallel with the first on-the-way pass.
  const destPromise = nearbyPlacesTerms(trip.dest_lat, trip.dest_lon, terms, kind, destRadius)
    .catch(() => ({ places: [] }));

  // On-the-way search with progressive widening: start close, and only widen the
  // radius if nothing was found — so we prefer spots right on the route but still
  // surface one a little off-route when there's nothing directly on the way.
  let sampleResults = [];
  for (const rad of radii) {
    sampleResults = await Promise.all(samples.map((s) =>
      nearbyPlacesTerms(s.lat, s.lon, terms, kind, rad).catch(() => ({ places: [] }))));
    if (sampleResults.some((sr) => (sr.places || []).length)) break;
  }
  const destResult = await destPromise;

  const onTheWay = [];
  const seen = new Set();
  for (const { places } of sampleResults) {
    // Normally one (or a few) picks per sample; in "pool" mode gather many so
    // the caller can reshuffle for fresh "more options" that still match.
    const take = opts.pool ? places.slice(0, 8)
      : (opts.fraction != null ? places.slice(0, 3) : places.slice(0, 1));
    for (const p of take) {
      const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      if (!seen.has(key)) { seen.add(key); onTheWay.push(p); }
    }
  }
  const atDestination = destResult.places || [];
  return { route: r, onTheWay: opts.pool ? onTheWay : onTheWay.slice(0, 3), atDestination };
}

// Guess what kind of place a single piece of text is about, or null.
function kindOf(text) {
  const t = (text || '').toLowerCase();
  if (/\b(hotel|motel|stay|overnight|sleep|lodg(?:e|ing)?|inn|hostel|accommodat(?:ion|ions)?)\b/.test(t)) return 'lodging';
  if (/\b(eat|food|restaurant|restaraunt|resturant|restraunt|restrount|lunch|dinner|breakfast|cafe|coffee|diner|meal|brunch|snack|bite|eatery)\b|\bgrab a bite\b|\bplace to eat\b/.test(t)) return 'food';
  if (/\b(gas|fuel|petrol|charge|charging|ev|station)\b/.test(t)) return 'fuel';
  if (/\b(see|do|attraction|park|visit|sight|scenic|museum|landmark|view|fun|explore|hike|beach)\b/.test(t)) return 'attraction';
  // A cuisine or diet word on its own strongly implies a food/restaurant request
  // even without an explicit food noun (e.g. "a halal indian spot on the way").
  if (DIET_WORDS.some((w) => t.includes(w)) ||
      CUISINE_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t))) return 'food';
  return null;
}

// Does this message look like a follow-up that leans on the previous topic
// (e.g. "is there one on the way?", "which is closest?", "any cheaper?")
// rather than naming a place type itself?
function isFollowUp(text) {
  const t = (text || '').toLowerCase();
  return /\b(that|those|these|it|them|they|one|ones|any|which|closest|nearest|cheaper|better|instead|on the way|along the|en route|nearby|there|same|first|second|other)\b/.test(t);
}

function isPinRequest(text) {
  return /\b(pin|mark|map|dot|marker)\b|\b(put|add|drop|show)\b.*\b(pin|marker|dot|map)\b/i.test(text || '');
}

function pinTarget(text) {
  const value = String(text || '').trim();
  const patterns = [
    /\b(?:add|put|drop)\s+(?:a\s+)?(?:pin|marker|dot)\s+(?:for|at|on|to)\s+(.+)$/i,
    /\b(?:pin|mark|map)\s+(.+?)(?:\s+on\s+the\s+map)?$/i,
    /\b(?:show)\s+(.+?)\s+(?:on\s+the\s+map|as\s+a\s+(?:pin|dot|marker))$/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const target = match[1]
      .replace(/\b(?:please|for me|on the map)\b/gi, '')
      .replace(/[.!?]+$/, '')
      .trim();
    if (target && !/^(it|that|them|those|one|this|the place|these places)$/i.test(target)) {
      return target.slice(0, 120);
    }
  }
  return null;
}

// Work out the kind of place a question is about, using recent conversation
// context so follow-ups inherit the topic. `history` is [{role, content}].
function detectKind(text, history = []) {
  const direct = kindOf(text);
  if (direct) return direct;
  // Follow-up with no explicit type: inherit the most recent kind from the
  // conversation (prefer what the USER last asked about).
  if (isFollowUp(text)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const k = kindOf(history[i].content);
      if (k) return k;
    }
  }
  return null;
}

// Is the user asking specifically about places ON THE WAY vs AT THE DESTINATION?
// Returns 'on the way', 'at destination', or null (no preference).
function detectWhere(text) {
  const t = (text || '').toLowerCase();
  if (/\b(on the way|along the|en route|enroute|between|midway|halfway|during the drive|stop(s)? on|pit ?stop)\b/.test(t)) return 'on the way';
  if (/\b(at (the )?destination|when i (get|arrive)|once i('m| am) there|in town|at the end|around (the )?dest)\b/.test(t)) return 'at destination';
  return null;
}

// Build a list of search terms from a request, most specific first, so we can
// honour things like "halal indian restaurant" and fall back gracefully.
const DIET_WORDS = ['halal', 'kosher', 'vegan', 'vegetarian', 'gluten-free', 'gluten free', 'organic'];
const CUISINE_WORDS = ['indian', 'chinese', 'thai', 'mexican', 'italian', 'japanese', 'sushi', 'korean',
  'bbq', 'barbecue', 'pizza', 'burger', 'seafood', 'steakhouse', 'steak', 'mediterranean', 'greek',
  'vietnamese', 'ramen', 'american', 'french', 'spanish', 'turkish', 'lebanese', 'ethiopian',
  'caribbean', 'cajun', 'tex-mex'];
// Food place-types whose noun replaces the generic "restaurant".
const FOOD_NOUNS = { coffee: 'coffee shop', cafe: 'cafe', café: 'cafe', bakery: 'bakery', deli: 'deli', diner: 'diner', pub: 'pub', 'fast food': 'fast food' };

// Returns { terms:[specific...broad], strict:boolean, label }. When `strict`
// (the user named a cuisine/diet/lodging type) we must NOT fall back to a
// generic pin — a plain steakhouse dot for a "halal indian" request is exactly
// the mismatch we're avoiding. `label` is the human phrase for the reply.
function refineTerms(message, kind) {
  const t = (message || '').toLowerCase();
  if (kind === 'food') {
    const diets = DIET_WORDS.filter((w) => t.includes(w));
    const cuisines = CUISINE_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(t));
    let noun = 'restaurant';
    for (const key of Object.keys(FOOD_NOUNS)) {
      if (t.includes(key)) { noun = FOOD_NOUNS[key]; break; }
    }
    const adj = [...cuisines];
    const strict = diets.length > 0 || adj.length > 0;
    const terms = [];
    if (strict) {
      terms.push([...diets, ...adj, noun].join(' '));        // "halal indian restaurant"
      if (adj.length) terms.push([...adj, noun].join(' '));  // "indian restaurant"
      if (diets.length) terms.push([...diets, noun].join(' ')); // "halal restaurant"
      // NOTE: intentionally no generic `noun` fallback when strict.
    } else {
      terms.push(noun);                                      // "restaurant" / "cafe" ...
    }
    return { terms: [...new Set(terms)], strict, label: [...diets, ...adj, noun].join(' ') };
  }
  if (kind === 'lodging') {
    const mods = ['motel', 'resort', 'hostel', 'cabin', 'bed and breakfast', 'b&b'].filter((w) => t.includes(w));
    if (mods.length) return { terms: [...mods], strict: true, label: mods.join('/') };
    return { terms: ['hotel'], strict: false, label: 'hotel' };
  }
  return { terms: [null], strict: false, label: null }; // fuel / attraction: kind default
}

// Detect a position along the trip the user named ("25% in", "a quarter of the
// way", "halfway", "1/3"). Returns a fraction 0..1, or null.
function detectFraction(text) {
  const t = (text || '').toLowerCase();
  let m = t.match(/(\d{1,3})\s*(?:%|percent)/);
  if (m) return Math.min(Math.max(Number(m[1]) / 100, 0), 1);
  m = t.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  if (m && Number(m[2]) !== 0) return Math.min(Math.max(Number(m[1]) / Number(m[2]), 0), 1);
  if (/\b(three[-\s]?quarter|3\/4)\b/.test(t)) return 0.75;
  if (/\b(two[-\s]?third)\b/.test(t)) return 0.66;
  if (/\b(quarter)\b/.test(t)) return 0.25;
  if (/\b(third)\b/.test(t)) return 0.33;
  if (/\b(half|halfway|half[-\s]?way|midway|midpoint|middle)\b/.test(t)) return 0.5;
  return null;
}

// Detect a position given in driving hours ("2-3 hours into the drive", "about
// 4 hours in"). Needs the trip's total driving seconds to turn hours into a
// fraction. Returns a fraction 0..1, or null.
function detectHoursFraction(text, totalSeconds) {
  if (!totalSeconds) return null;
  const t = (text || '').toLowerCase();
  // "2-3 hours", "2 to 3 hours", "about 4 hrs", "an hour and a half"
  const range = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour)/);
  let hours = null;
  if (range) {
    hours = (Number(range[1]) + Number(range[2])) / 2; // middle of the range
  } else {
    const one = t.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour)/);
    if (one) hours = Number(one[1]);
  }
  if (hours == null) return null;
  return Math.min(Math.max((hours * 3600) / totalSeconds, 0), 1);
}

app.get('/api/trips/:id/suggestions', wrap(async (req, res) => {
  const trip = await storage.getTrip(req.params.id, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.origin_lat == null || trip.dest_lat == null) {
    return res.status(400).json({ error: 'Trip needs geocoded origin & destination' });
  }
  const kind = req.query.kind || 'attraction';
  res.json(await computeSuggestions(trip, kind));
}));

// A short, friendly "Cotrip" suggestion for a trip card. Lightweight (a single
// nearby-places lookup near the route midpoint) and randomised so it rotates on
// every refresh.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function cotripTip(kind, place, dest) {
  const n = place.name;
  const templates = {
    attraction: [
      `Cotrip here! 🌿 Swing by ${n} on your way — it's a lovely little detour.`,
      `Psst, it's Cotrip 👋 ${n} is a great place to stretch your legs between here and ${dest}.`,
      `I'd stop at ${n} if I were riding along — a nice spot in between! — Cotrip 🍃`,
    ],
    lodging: [
      `Cotrip tip 🏕️ ${n} looks like a cozy place to rest partway to ${dest}.`,
      `If you need a night's rest, I'd try ${n} — comfy and right on your route! — Cotrip`,
    ],
    food: [
      `Hungry? 🍽️ Cotrip recommends ${n} for a bite along the way to ${dest}.`,
      `Cotrip here! ${n} is a tasty stop to break up the drive. 🌿`,
    ],
  };
  return pick(templates[kind] || templates.attraction);
}

app.get('/api/trips/:id/tip', wrap(async (req, res) => {
  const trip = await storage.getTrip(req.params.id, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.origin_lat == null || trip.dest_lat == null) {
    return res.json({ text: `Cotrip here! 🌿 Add a stop or two and I'll suggest lovely places along the way.`, place: null });
  }
  const kind = pick(['attraction', 'attraction', 'lodging', 'food']); // weight scenic spots
  const midLat = (trip.origin_lat + trip.dest_lat) / 2;
  const midLon = (trip.origin_lon + trip.dest_lon) / 2;
  let place = null;
  try {
    const places = await nearbyPlaces(midLat, midLon, kind, 25000);
    if (places.length) place = pick(places.slice(0, Math.min(8, places.length)));
  } catch { /* ignore */ }
  if (!place) {
    return res.json({
      text: `Cotrip here! 🌿 A trip from ${trip.origin.split(',')[0]} to ${trip.destination.split(',')[0]} sounds wonderful — ask me for stops along the way!`,
      place: null,
    });
  }
  res.json({ text: cotripTip(kind, place, trip.destination.split(',')[0]), place, kind });
}));

// A highlighted Cotrip suggestion for one specific itinerary day. Anchored on
// the day's last stop (or interpolated along the route for empty days) so the
// tip is relevant to where the traveller is that day.
app.get('/api/trips/:id/day-tip', wrap(async (req, res) => {
  const trip = await storage.getTrip(req.params.id, req.user.uid);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.origin_lat == null || trip.dest_lat == null) return res.json({ text: null, place: null });

  const dayNum = Number(req.query.day) || 1;
  const day = trip.days.find((d) => d.day_number === dayNum);
  const totalDays = trip.days.length;

  // Pick an anchor coordinate for this day.
  let anchor;
  const stopsWithCoords = (day?.stops || []).filter((s) => s.lat != null);
  if (stopsWithCoords.length) {
    const s = stopsWithCoords[stopsWithCoords.length - 1];
    anchor = { lat: s.lat, lon: s.lon };
  } else {
    const frac = totalDays > 1 ? dayNum / (totalDays + 1) : 0.5;
    anchor = {
      lat: trip.origin_lat + (trip.dest_lat - trip.origin_lat) * frac,
      lon: trip.origin_lon + (trip.dest_lon - trip.origin_lon) * frac,
    };
  }

  const kind = pick(['attraction', 'attraction', 'food']);
  let place = null;
  try {
    const places = await nearbyPlaces(anchor.lat, anchor.lon, kind, 22000);
    if (places.length) place = pick(places.slice(0, Math.min(6, places.length)));
  } catch { /* ignore */ }
  if (!place) return res.json({ text: null, place: null });

  const n = place.name;
  const dayTexts = [
    `On Day ${dayNum}, I'd swing by ${n} — a lovely spot near your route! 🌿`,
    `Cotrip idea for Day ${dayNum}: ${n} makes a great little stop. 🍃`,
    `Day ${dayNum} tip — don't miss ${n} while you're in the area!`,
  ];
  res.json({ text: pick(dayTexts), place, kind, day: dayNum });
}));

// ---------- AI ----------

// Pull candidate place names out of an AI reply. Models tend to put place
// names in **bold** or as "- Name" list items. We keep both a fuller version
// (with city, which geocodes precisely) and a short version.
function normalize(s) {
  return s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractPlaceNames(reply) {
  const out = [];
  const seen = new Set();
  const push = (medium) => {
    const m = medium
      .replace(/[*_`#]/g, '')
      .replace(/[\p{Extended_Pictographic}\u{2600}-\u{27BF}\uFE0F]/gu, '') // strip emoji/pins like 📍
      .replace(/\(.*?\)/g, '')
      .split(':')[0]                 // drop "Name: description"
      .replace(/[.,;!?]+$/, '')
      .trim();
    if (!m) return;
    const short = m.split(/\s[–—-]\s/)[0].trim(); // "Name - City" -> "Name"
    const key = normalize(m);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ full: m, short });
  };
  for (const mm of reply.matchAll(/\*\*(.+?)\*\*/g)) push(mm[1]);
  for (const mm of reply.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+)$/gm)) push(mm[1]);

  const stop = /^(location|why|clothing|essentials|tip|tips|note|category|overview|summary|day \d|pros|cons|address|hours|price|cost|rating|distance|route|check|book|plan|breakfast|lunch|dinner|wi-?fi|rooms?)/i;
  // Reject filler the model bolds/lists that isn't a place name ("just **one**").
  const filler = /^(one|two|three|four|five|here|this|that|these|those|just|stop|option|first|second|third|next|another|yes|no|ok|okay)$/i;
  return out
    .filter((c) => c.short.length >= 3 && c.full.length <= 70 && !stop.test(c.short) && !filler.test(c.short) && /[a-zA-Z]/.test(c.short))
    .slice(0, 8);
}

// Given the AI reply and trip, return the exact places it mentioned, geocoded.
async function pinsFromReply(reply, trip, knownPlaces) {
  const origin = { lat: trip.origin_lat, lon: trip.origin_lon };
  const dest = { lat: trip.dest_lat, lon: trip.dest_lon };
  const mid = { lat: (origin.lat + dest.lat) / 2, lon: (origin.lon + dest.lon) / 2 };
  const refs = [origin, dest, mid];
  // Allow places anywhere along a generous corridor around the route so the
  // cities/hotels the AI names actually get pinned (not just ones near the
  // straight line between endpoints).
  const spanKm = haversine(origin, dest) / 1000;
  const maxKm = Math.max(200, spanKm * 0.75 + 150);

  const replyNorm = normalize(reply);
  const result = [];
  const seen = new Set();
  const add = (p) => {
    const k = normalize(p.name);
    if (seen.has(k) || !p.lat || !p.lon) return;
    seen.add(k);
    result.push(p);
  };

  for (const cand of extractPlaceNames(reply)) {
    // 1) Match a place we already found (has exact coords).
    const known = (knownPlaces || []).find((p) => {
      const pn = normalize(p.name);
      return pn === normalize(cand.full) || pn === normalize(cand.short) ||
        pn.includes(normalize(cand.short)) || normalize(cand.full).includes(pn);
    });
    if (known) { add({ ...known, where: known.where || 'mentioned' }); continue; }
    // 2) Geocode the fuller name (with city), then the short name — biased to
    //    the trip area but accepting the real spot within the corridor.
    let g = null;
    try { g = await geocodeNear(cand.full, refs, maxKm); } catch { /* skip */ }
    if (!g && cand.short !== cand.full) {
      try { g = await geocodeNear(cand.short, refs, maxKm); } catch { /* skip */ }
    }
    if (g) add({ ...g, kind: 'ai', where: 'mentioned' });
  }
  // 3) Also pin any known place whose name literally appears in the reply.
  for (const p of knownPlaces || []) {
    if (replyNorm.includes(normalize(p.name))) add({ ...p, where: p.where || 'mentioned' });
  }
  return result;
}

app.post('/api/ai/chat', wrap(async (req, res) => {
  const {
    tripId, history, previous_query: previousQuery, previous_places: previousPlaces,
  } = req.body;
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });

  // Fetch the trip once and (if geocoded) compute its route once — both are
  // reused below for context facts and place suggestions.
  const trip = tripId ? await storage.getTrip(tripId, req.user.uid) : null;
  if (tripId && !trip) return res.status(404).json({ error: 'Trip not found' });
  const geocoded = trip && trip.origin_lat != null && trip.dest_lat != null;
  let tripRoute = null;
  if (geocoded && (trip.travel_mode || 'car') === 'car') {
    try {
      tripRoute = await route([
        { lat: trip.origin_lat, lon: trip.origin_lon },
        { lat: trip.dest_lat, lon: trip.dest_lon },
      ]);
    } catch { /* routing unavailable — carry on without facts/suggestions */ }
  }

  let context = {};
  if (trip) {
    context = {
      origin: trip.origin,
      destination: trip.destination,
      start_date: trip.start_date,
      travel_mode: trip.travel_mode || 'car',
      travel_option: trip.travel_option,
      days: trip.days.map((d) => ({
        day: d.day_number,
        date: d.date,
        stops: d.stops.map((s) => s.name),
      })),
    };
    // Give the AI the REAL driving distance & time so it states correct facts.
    if (tripRoute && (trip.travel_mode || 'car') === 'car') {
      const miles = Math.round(tripRoute.distance_m / 1609.34);
      const hrs = Math.floor(tripRoute.duration_s / 3600);
      const mins = Math.round((tripRoute.duration_s % 3600) / 60);
      context.driving_distance_miles = miles;
      context.driving_time = `${hrs ? hrs + 'h ' : ''}${mins}m`;
      if (tripRoute.approximate) context.route_note = 'distance/time are approximate straight-line estimates';
    }
  }
  if (tripId) {
    await storage.addMessage(tripId, req.user.uid, 'user', message);
  }
  const messages = [...(history || []), { role: 'user', content: message }];

  // Understand the question in context: infer the topic even for follow-ups
  // ("is there one on the way?"), whether the user cares about places ON THE WAY
  // vs AT THE DESTINATION, any specific cuisine/type ("halal indian"), and any
  // position along the route ("25% into the trip").
  const followUp = isFollowUp(message) || isPinRequest(message);
  const directKind = kindOf(message);
  const kind = directKind || (followUp && previousQuery?.kind) || detectKind(message, history || []);
  const currentRefinement = refineTerms(message, kind);
  const refined = (
    followUp &&
    !currentRefinement.strict &&
    previousQuery?.kind === kind &&
    Array.isArray(previousQuery.terms) &&
    previousQuery.terms.length
  ) ? {
      terms: previousQuery.terms,
      strict: Boolean(previousQuery.strict),
      label: previousQuery.label || previousQuery.terms[0],
    } : currentRefinement;
  const requestedTerms = refined.terms;
  // A position may be given as a percentage/fraction ("25% in") or in driving
  // hours ("2-3 hours into the drive") — the latter needs the total drive time.
  const detectedFraction = detectFraction(message) ??
    detectHoursFraction(message, tripRoute?.duration_s);
  const fraction = detectedFraction ?? (followUp ? previousQuery?.fraction ?? null : null);
  let focus = detectWhere(message) || (followUp ? previousQuery?.focus || null : null);
  // A named position along the route is by definition an on-the-way request.
  if (fraction != null) focus = 'on the way';

  const reusablePlaces = Array.isArray(previousPlaces)
    ? previousPlaces
      .filter((place) =>
        place && typeof place.name === 'string' &&
        Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon)))
      .slice(0, 8)
      .map((place) => ({ ...place, lat: Number(place.lat), lon: Number(place.lon) }))
    : [];
  const requestedPinTarget = pinTarget(message);
  if (isPinRequest(message) && requestedPinTarget && !geocoded) {
    const reply = 'Select valid trip locations before adding a map dot.';
    if (tripId) {
      await storage.addMessage(tripId, req.user.uid, 'assistant', reply);
    }
    return res.json({
      reply,
      source: 'local',
      places: [],
      kind,
      focus,
      query: previousQuery || null,
    });
  }
  if (isPinRequest(message) && requestedPinTarget && geocoded) {
    const normalizedTarget = normalize(requestedPinTarget);
    let pinnedPlace = reusablePlaces.find((place) => {
      const name = normalize(place.name);
      return name === normalizedTarget || name.includes(normalizedTarget) || normalizedTarget.includes(name);
    }) || null;
    if (!pinnedPlace) {
      const origin = { lat: trip.origin_lat, lon: trip.origin_lon };
      const destination = { lat: trip.dest_lat, lon: trip.dest_lon };
      const midpoint = {
        lat: (origin.lat + destination.lat) / 2,
        lon: (origin.lon + destination.lon) / 2,
      };
      const maxKm = Math.max(250, haversine(origin, destination) / 1000 + 200);
      try {
        const nearby = await geocodeNear(
          requestedPinTarget,
          [origin, destination, midpoint],
          maxKm,
        );
        if (nearby) pinnedPlace = { ...nearby, kind: 'ai', where: 'requested' };
      } catch { /* try global geocoding below */ }
    }
    if (!pinnedPlace) {
      try {
        const matches = await geocode(requestedPinTarget);
        const exact = matches[0];
        if (exact) {
          pinnedPlace = {
            name: exact.place || exact.label || requestedPinTarget,
            lat: exact.lat,
            lon: exact.lon,
            details: [exact.region, exact.country].filter(Boolean).join(', '),
            kind: 'ai',
            where: 'requested',
          };
        }
      } catch { /* handled with a clear no-pin response */ }
    }
    const reply = pinnedPlace
      ? `Pinned ${pinnedPlace.name}.`
      : `I couldn't locate ${requestedPinTarget}, so I didn't add a dot.`;
    if (tripId) {
      await storage.addMessage(tripId, req.user.uid, 'assistant', reply);
    }
    return res.json({
      reply,
      source: 'local',
      places: pinnedPlace ? [pinnedPlace] : [],
      kind,
      focus,
      query: previousQuery || null,
    });
  }
  if (isPinRequest(message) && reusablePlaces.length) {
    const names = reusablePlaces.map((place) => place.name);
    const reply = names.length === 1
      ? `I've pinned ${names[0]} on the map.`
      : `I've pinned these exact places on the map: ${names.join(', ')}.`;
    if (tripId) {
      await storage.addMessage(tripId, req.user.uid, 'assistant', reply);
    }
    return res.json({
      reply,
      source: 'local',
      places: reusablePlaces,
      kind,
      focus,
      query: previousQuery || null,
    });
  }

  // If the question is about a kind of place and the trip is geocoded, find real
  // matching places FIRST so both the AI reply and the map pins reference the
  // same actual, specific spots — honouring the specific type and position.
  let places = [];
  if (kind && geocoded) {
    try {
      const sug = await computeSuggestions(trip, kind, tripRoute, { terms: requestedTerms, fraction, strict: refined.strict });
      const onWay = (sug.onTheWay || []).map((p) => ({ ...p, where: 'on the way' }));
      const atDest = (sug.atDestination || []).map((p) => ({ ...p, where: 'at destination' }));
      let all = [...onWay, ...atDest];
      // If the user asked specifically about on-the-way / destination, keep only
      // those so the answer and pins actually match the question.
      if (focus) {
        const filtered = all.filter((p) => p.where === focus);
        if (filtered.length) all = filtered;
      }
      places = all;
    } catch { /* best-effort */ }
  }

  const pctText = fraction != null ? ` about ${Math.round(fraction * 100)}% of the way into the trip` : '';
  const chatFocus = focus ? `${focus}${pctText}` : (pctText ? `on the way${pctText}` : null);
  // Tell the model exactly what we searched for and whether we actually found
  // it, so it can be honest instead of inventing a place of the wrong type.
  const searchNote = (kind && refined.strict)
    ? `The user asked specifically for a "${refined.label}". ${places.length ? `I found ${places.length} real match(es): ${places.map((p) => p.name).join(', ')}. Recommend ONLY these — do not substitute a different cuisine or type.` : `I could NOT find a "${refined.label}" mapped near that spot. Say so honestly, do NOT invent one or suggest a different cuisine/type as if it matched; instead point them to the nearest town to search.`}`
    : null;
  const { reply, source } = await chat({
    messages,
    context,
    kind,
    places,
    focus: chatFocus,
    note: searchNote,
    request: { label: refined.label, strict: refined.strict, focus: chatFocus },
  });

  // Decide which places become map dots. The dots must always be real,
  // correct-type spots — never a city the model happened to name in prose.
  //  1) Prefer the real found places the reply actually names (keeps dots in
  //     sync with the text, e.g. "pin just one … Maharaja").
  //  2) For a strict cuisine/diet/position request, otherwise keep exactly the
  //     real places we found (or none) — never geocode names from the reply,
  //     which are usually cities ("head into Louisville").
  //  3) For a loose request with no real match, fall back to geocoding the
  //     names the AI mentioned (landmarks/hotels/towns are acceptable there).
  let mappedPlaces = places;
  if (kind && geocoded) {
    const replyNorm = normalize(reply);
    const namedReal = (places || []).filter((p) => p.name && replyNorm.includes(normalize(p.name)));
    if (namedReal.length) {
      mappedPlaces = namedReal;
    } else if (!refined.strict && fraction == null) {
      try {
        const mentioned = await pinsFromReply(reply, trip, places);
        if (mentioned.length) mappedPlaces = mentioned;
      } catch { /* keep real found places */ }
    }
    // else strict/position: keep the real found `places` as-is (may be empty).
  }

  if (tripId) {
    await storage.addMessage(tripId, req.user.uid, 'assistant', reply);
  }
  res.json({
    reply, source, places: mappedPlaces, kind, focus,
    // Echo the exact search we resolved so a "More options" request can rerun
    // the identical query (same cuisine/type/position) and just reshuffle.
    query: (kind && geocoded)
      ? { kind, terms: requestedTerms, fraction, strict: refined.strict, label: refined.label, focus }
      : null,
  });
}));

// Return more real places for the SAME resolved search (from a prior chat),
// reshuffled and excluding ones already shown — so "More options" gives fresh
// picks that still match exactly what the user described.
app.post('/api/ai/more-places', wrap(async (req, res) => {
  const { tripId, query, exclude } = req.body || {};
  const trip = tripId ? await storage.getTrip(tripId, req.user.uid) : null;
  if (!trip || trip.origin_lat == null || trip.dest_lat == null || !query || !query.kind) {
    return res.json({ places: [] });
  }
  const { kind, terms, fraction, strict } = query;
  const focus = query.focus || (fraction != null ? 'on the way' : null);

  let all = [];
  try {
    const sug = await computeSuggestions(trip, kind, null, { terms, fraction, strict, pool: true });
    const onWay = (sug.onTheWay || []).map((p) => ({ ...p, where: 'on the way' }));
    const atDest = (sug.atDestination || []).map((p) => ({ ...p, where: 'at destination' }));
    all = [...onWay, ...atDest];
    if (focus) {
      const filtered = all.filter((p) => p.where === focus);
      if (filtered.length) all = filtered;
    }
  } catch { /* fall through to empty */ }

  // De-duplicate by name.
  const seen = new Set();
  let uniq = [];
  for (const p of all) {
    const k = (p.name || '').toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); uniq.push(p); }
  }
  // Drop already-shown picks so the list actually changes; if that empties the
  // pool (we've exhausted matches), keep the full set so the button still works.
  const ex = new Set((exclude || []).map((n) => (n || '').toLowerCase().trim()));
  const fresh = uniq.filter((p) => !ex.has((p.name || '').toLowerCase().trim()));
  if (fresh.length) uniq = fresh;

  // Shuffle (Fisher-Yates) for the "randomize" feel, then take a handful.
  for (let i = uniq.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniq[i], uniq[j]] = [uniq[j], uniq[i]];
  }
  res.json({ places: uniq.slice(0, 4), kind, focus });
}));

app.get('/api/trips/:id/messages', wrap(async (req, res) => {
  const messages = await storage.listMessages(req.params.id, req.user.uid);
  if (!messages) return res.status(404).json({ error: 'Trip not found' });
  res.json(messages);
}));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => console.log(`Trip Planner API on http://localhost:${PORT}`));
}

export { app };
export default app;
