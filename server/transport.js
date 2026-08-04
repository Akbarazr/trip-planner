const AMADEUS_BASE_URL = process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com';
const TRANSITOUS_BASE_URL = process.env.TRANSITOUS_BASE_URL || 'https://api.transitous.org';
const TRANSITOUS_CONTACT = process.env.TRANSITOUS_CONTACT || 'http://localhost:5173';
const REQUEST_TIMEOUT_MS = 30000;

let amadeusToken = null;
let amadeusTokenExpiresAt = 0;

function withTimeout(ms = REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

async function responseJson(response, provider) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.errors?.[0]?.detail || data?.error_description || data?.error || response.statusText;
    const error = new Error(`${provider}: ${detail}`);
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  return data;
}

async function getAmadeusToken() {
  if (amadeusToken && Date.now() < amadeusTokenExpiresAt) return amadeusToken;

  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error(
      'Live flight search is not configured. Add AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET to server/.env.',
    );
    error.status = 503;
    throw error;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: withTimeout(),
  });
  const data = await responseJson(response, 'Amadeus authentication failed');
  amadeusToken = data.access_token;
  amadeusTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 1800) - 60) * 1000;
  return amadeusToken;
}

async function amadeusGet(path, params) {
  const token = await getAmadeusToken();
  const url = new URL(path, AMADEUS_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: withTimeout(),
  });
  return responseJson(response, 'Amadeus flight search failed');
}

function cityKeyword(place) {
  return String(place || '').split(',')[0].trim().replace(/[^a-z0-9 '-]/gi, '').slice(0, 30);
}

function distanceSquared(location, point) {
  const lat = Number(location?.geoCode?.latitude);
  const lon = Number(location?.geoCode?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || point?.lat == null || point?.lon == null) {
    return Number.POSITIVE_INFINITY;
  }
  return (lat - Number(point.lat)) ** 2 + (lon - Number(point.lon)) ** 2;
}

async function findAirport(place, point) {
  const data = await amadeusGet('/v1/reference-data/locations', {
    subType: 'CITY,AIRPORT',
    keyword: cityKeyword(place),
    view: 'LIGHT',
    sort: 'analytics.travelers.score',
  });
  const locations = (data.data || []).filter((item) => item.iataCode);
  if (!locations.length) return null;
  return [...locations].sort((a, b) => distanceSquared(a, point) - distanceSquared(b, point))[0];
}

function isoDurationSeconds(value) {
  const match = String(value || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return (Number(match[1] || 0) * 86400) +
    (Number(match[2] || 0) * 3600) +
    (Number(match[3] || 0) * 60) +
    Number(match[4] || 0);
}

function airportPoint(location, fallback, label) {
  const lat = Number(location?.geoCode?.latitude ?? fallback?.lat);
  const lon = Number(location?.geoCode?.longitude ?? fallback?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon, label }
    : null;
}

function dateWithOffset(date, offsetDays) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function nearestDateGroups(date, maxDistanceDays = 7) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = [[date]];
  for (let distance = 1; distance <= maxDistanceDays; distance += 1) {
    const dates = [dateWithOffset(date, distance), dateWithOffset(date, -distance)]
      .filter((candidate) => candidate >= today);
    if (dates.length) groups.push(dates);
  }
  return groups;
}

function flightSearchFallback({ origin, destination, originPoint, destinationPoint, date }) {
  const query = `Flights from ${origin} to ${destination} on ${date}`;
  return {
    available: true,
    message: 'Live prices are not connected yet. You can continue planning now and check current flights before booking.',
    options: [{
      id: `flight-fallback-${date}-${origin}-${destination}`,
      mode: 'flight',
      provider: 'Google Flights',
      title: 'Flight plan — check live availability',
      origin_station: origin,
      destination_station: destination,
      departure: null,
      arrival: null,
      duration_s: null,
      transfers: null,
      price: null,
      currency: null,
      fare_unavailable: true,
      availability_unconfirmed: true,
      external_search_url: `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`,
      segments: [],
      map_points: [
        { ...originPoint, label: origin },
        { ...destinationPoint, label: destination },
      ],
      requested_date: date,
      service_date: date,
      date_offset_days: 0,
    }],
    attribution: 'Open the live search link to confirm airlines, schedules, and prices before booking.',
    requested_date: date,
    matched_dates: [],
    fallback_used: true,
  };
}

function normalizeFlightOffer(offer, dictionaries, originAirport, destinationAirport, points, requestedDate, serviceDate) {
  const itinerary = offer.itineraries?.[0];
  const segments = (itinerary?.segments || []).map((segment) => ({
    carrier: dictionaries?.carriers?.[segment.carrierCode] || segment.carrierCode,
    carrier_code: segment.carrierCode,
    flight_number: `${segment.carrierCode}${segment.number}`,
    from: segment.departure?.iataCode,
    from_terminal: segment.departure?.terminal || null,
    departure: segment.departure?.at,
    to: segment.arrival?.iataCode,
    to_terminal: segment.arrival?.terminal || null,
    arrival: segment.arrival?.at,
    duration_s: isoDurationSeconds(segment.duration),
    aircraft: dictionaries?.aircraft?.[segment.aircraft?.code] || segment.aircraft?.code || null,
    stops: Number(segment.numberOfStops || 0),
  }));
  const carriers = [...new Set(segments.map((segment) => segment.carrier).filter(Boolean))];
  return {
    id: `flight-${offer.id}`,
    mode: 'flight',
    provider: 'Amadeus',
    title: carriers.join(' + ') || 'Flight',
    origin_station: `${originAirport.name} (${originAirport.iataCode})`,
    destination_station: `${destinationAirport.name} (${destinationAirport.iataCode})`,
    departure: segments[0]?.departure || null,
    arrival: segments.at(-1)?.arrival || null,
    duration_s: isoDurationSeconds(itinerary?.duration),
    transfers: Math.max(0, segments.length - 1),
    price: offer.price?.grandTotal || offer.price?.total || null,
    currency: offer.price?.currency || null,
    segments,
    map_points: points.filter(Boolean),
    requested_date: requestedDate,
    service_date: serviceDate,
    date_offset_days: Math.round(
      (new Date(`${serviceDate}T12:00:00Z`) - new Date(`${requestedDate}T12:00:00Z`)) / 86400000,
    ),
  };
}

async function flightOptionsForDate({
  originAirport, destinationAirport, originPoint, destinationPoint, requestedDate, serviceDate,
}) {
  const data = await amadeusGet('/v2/shopping/flight-offers', {
    originLocationCode: originAirport.iataCode,
    destinationLocationCode: destinationAirport.iataCode,
    departureDate: serviceDate,
    adults: 1,
    currencyCode: 'USD',
    max: 10,
  });
  const points = [
    airportPoint(originAirport, originPoint, `${originAirport.name} (${originAirport.iataCode})`),
    airportPoint(destinationAirport, destinationPoint, `${destinationAirport.name} (${destinationAirport.iataCode})`),
  ];
  return (data.data || []).map((offer) =>
    normalizeFlightOffer(
      offer, data.dictionaries, originAirport, destinationAirport, points, requestedDate, serviceDate,
    ));
}

export async function searchFlights({ origin, destination, originPoint, destinationPoint, date }) {
  if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
    return flightSearchFallback({ origin, destination, originPoint, destinationPoint, date });
  }

  const [originAirport, destinationAirport] = await Promise.all([
    findAirport(origin, originPoint),
    findAirport(destination, destinationPoint),
  ]);
  if (!originAirport || !destinationAirport) {
    return { available: false, message: 'Plane not found: no matching airports were found near this route.', options: [] };
  }

  let options = [];
  let matchedDates = [];
  for (const dates of nearestDateGroups(date)) {
    const groups = await Promise.all(dates.map(async (serviceDate) => ({
      serviceDate,
      options: await flightOptionsForDate({
        originAirport,
        destinationAirport,
        originPoint,
        destinationPoint,
        requestedDate: date,
        serviceDate,
      }),
    })));
    const matches = groups.filter((group) => group.options.length);
    if (matches.length) {
      matchedDates = matches.map((group) => group.serviceDate);
      options = matches.flatMap((group) => group.options)
        .sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure))
        .slice(0, 10);
      break;
    }
  }
  const fallbackUsed = matchedDates.length > 0 && !matchedDates.includes(date);
  return {
    available: options.length > 0,
    message: options.length
      ? (fallbackUsed
        ? `No plane was found on ${date}. Showing the closest available date${matchedDates.length > 1 ? 's' : ''}: ${matchedDates.join(' and ')}.`
        : null)
      : `Plane not found for this route from ${originAirport.name} to ${destinationAirport.name} within 7 days of ${date}.`,
    options,
    attribution: 'Flight availability provided by Amadeus.',
    requested_date: date,
    matched_dates: matchedDates,
    fallback_used: fallbackUsed,
  };
}

const TRAIN_MODES = new Set([
  'RAIL', 'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL',
  'REGIONAL_RAIL', 'SUBURBAN', 'SUBWAY', 'TRAM',
]);
const BUS_MODES = new Set(['BUS', 'COACH']);

function compactPlace(place) {
  if (!place) return null;
  return {
    name: place.name,
    stop_id: place.stopId || null,
    code: place.stopCode || null,
    lat: Number.isFinite(Number(place.lat)) ? Number(place.lat) : null,
    lon: Number.isFinite(Number(place.lon)) ? Number(place.lon) : null,
  };
}

function compactStop(stop) {
  return {
    ...compactPlace(stop),
    arrival: stop.arrival || stop.scheduledArrival || null,
    departure: stop.departure || stop.scheduledDeparture || null,
  };
}

function dedupePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    if (point?.lat == null || point?.lon == null) return false;
    const key = `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function moneyValue(value) {
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'string') {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  if (typeof value !== 'object') return null;
  if (value.cents != null && Number.isFinite(Number(value.cents))) return Number(value.cents) / 100;
  for (const key of ['amount', 'value', 'price']) {
    if (value[key] != null && Number.isFinite(Number(value[key]))) return Number(value[key]);
  }
  for (const key of ['regular', 'adult', 'fare']) {
    const amount = moneyValue(value[key]);
    if (amount != null) return amount;
  }
  return null;
}

function transitFare(itinerary) {
  const sources = [itinerary.price, itinerary.fare, itinerary.fares?.[0], itinerary.cost];
  for (const source of sources) {
    const amount = moneyValue(source);
    if (amount == null) continue;
    const currency = source?.currency || source?.currencyCode ||
      itinerary.currency || itinerary.currencyCode || null;
    return { price: amount.toFixed(2), currency };
  }
  return { price: null, currency: null };
}

function normalizeTransitItinerary(itinerary, mode, requestedDate, serviceDate) {
  const legs = (itinerary.legs || []).map((leg) => ({
    mode: leg.mode,
    provider: leg.agencyName || null,
    service: leg.routeLongName || leg.displayName || leg.routeShortName || null,
    number: leg.tripShortName || leg.displayName || null,
    headsign: leg.headsign || null,
    from: compactPlace(leg.from),
    to: compactPlace(leg.to),
    departure: leg.startTime || leg.from?.departure || leg.from?.scheduledDeparture || null,
    arrival: leg.endTime || leg.to?.arrival || leg.to?.scheduledArrival || null,
    duration_s: Number(leg.duration || 0),
    intermediate_stops: (leg.intermediateStops || []).map(compactStop),
  }));
  for (let index = 0; index < legs.length; index += 1) {
    if (legs[index].mode === 'WALK') continue;
    const next = legs.slice(index + 1).find((leg) => leg.mode !== 'WALK');
    if (!next || !legs[index].arrival || !next.departure) continue;
    const waitSeconds = Math.round((Date.parse(next.departure) - Date.parse(legs[index].arrival)) / 1000);
    if (Number.isFinite(waitSeconds) && waitSeconds >= 0) {
      legs[index].connection_wait_s = waitSeconds;
      legs[index].connection_station = legs[index].to?.name || null;
    }
  }
  const transitLegs = legs.filter((leg) => leg.mode !== 'WALK');
  const relevantModes = mode === 'train' ? TRAIN_MODES : BUS_MODES;
  const relevantLegs = transitLegs.filter((leg) => relevantModes.has(leg.mode));
  const providers = [...new Set(relevantLegs.map((leg) => leg.provider).filter(Boolean))];
  const stops = relevantLegs.flatMap((leg) => leg.intermediate_stops);
  const mapPoints = dedupePoints([
    ...legs.flatMap((leg) => [
      leg.from && { lat: leg.from.lat, lon: leg.from.lon, label: leg.from.name },
      ...leg.intermediate_stops.map((stop) => ({ lat: stop.lat, lon: stop.lon, label: stop.name })),
      leg.to && { lat: leg.to.lat, lon: leg.to.lon, label: leg.to.name },
    ]),
  ]);
  const fare = transitFare(itinerary);
  return {
    id: [
      mode,
      itinerary.startTime,
      itinerary.endTime,
      ...transitLegs.map((leg) => leg.number || leg.service || leg.mode),
    ].filter(Boolean).join('-'),
    mode,
    provider: 'Transitous',
    title: providers.join(' + ') || (mode === 'train' ? 'Train journey' : 'Bus journey'),
    departure: itinerary.startTime || legs[0]?.departure || null,
    arrival: itinerary.endTime || legs.at(-1)?.arrival || null,
    duration_s: Number(itinerary.duration || 0),
    transfers: Number(itinerary.transfers ?? Math.max(0, transitLegs.length - 1)),
    origin_station: relevantLegs[0]?.from?.name || transitLegs[0]?.from?.name || null,
    destination_station: relevantLegs.at(-1)?.to?.name || transitLegs.at(-1)?.to?.name || null,
    segments: legs,
    intermediate_stops: stops,
    map_points: mapPoints,
    price: fare.price,
    currency: fare.currency,
    fare_unavailable: fare.price == null,
    requested_date: requestedDate,
    service_date: serviceDate,
    date_offset_days: Math.round(
      (new Date(`${serviceDate}T12:00:00Z`) - new Date(`${requestedDate}T12:00:00Z`)) / 86400000,
    ),
  };
}

function dateTimeForDate(departureDateTime, serviceDate) {
  if (!departureDateTime) return `${serviceDate}T08:00:00Z`;
  return `${serviceDate}${departureDateTime.slice(10)}`;
}

async function transitOptionsForDate({
  mode, originPoint, destinationPoint, requestedDate, serviceDate, departureDateTime,
}) {
  const url = new URL('/api/v6/plan', TRANSITOUS_BASE_URL);
  const transitModes = mode === 'train'
    ? 'RAIL,REGIONAL_RAIL,SUBURBAN,SUBWAY,TRAM'
    : 'BUS,COACH';
  url.searchParams.set('fromPlace', `${originPoint.lat},${originPoint.lon}`);
  url.searchParams.set('toPlace', `${destinationPoint.lat},${destinationPoint.lon}`);
  url.searchParams.set('time', dateTimeForDate(departureDateTime, serviceDate));
  url.searchParams.set('transitModes', transitModes);
  url.searchParams.set('directModes', '');
  url.searchParams.set('maxTransfers', '4');
  url.searchParams.set('detailedLegs', 'false');

  const response = await fetch(url, {
    headers: { 'User-Agent': `WanderTripPlanner/1.1 (${TRANSITOUS_CONTACT})` },
    signal: withTimeout(60000),
  });
  const data = await responseJson(response, 'Transitous journey search failed');
  const relevantModes = mode === 'train' ? TRAIN_MODES : BUS_MODES;
  return (data.itineraries || [])
    .filter((itinerary) => itinerary.legs?.some((leg) => relevantModes.has(leg.mode)))
    .slice(0, 6)
    .map((itinerary) => normalizeTransitItinerary(itinerary, mode, requestedDate, serviceDate));
}

export async function searchTransit({
  mode, originPoint, destinationPoint, date, departureDateTime,
}) {
  let options = [];
  let matchedDates = [];
  for (const dates of nearestDateGroups(date, 3)) {
    const groups = await Promise.all(dates.map(async (serviceDate) => ({
      serviceDate,
      options: await transitOptionsForDate({
        mode,
        originPoint,
        destinationPoint,
        requestedDate: date,
        serviceDate,
        departureDateTime,
      }),
    })));
    const matches = groups.filter((group) => group.options.length);
    if (matches.length) {
      matchedDates = matches.map((group) => group.serviceDate);
      options = matches.flatMap((group) => group.options)
        .sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure))
        .slice(0, 6);
      break;
    }
  }
  const label = mode === 'train' ? 'Train' : 'Bus';
  const fallbackUsed = matchedDates.length > 0 && !matchedDates.includes(date);
  return {
    available: options.length > 0,
    message: options.length
      ? (fallbackUsed
        ? `No ${label.toLowerCase()} was found on ${date}. Showing the closest available date${matchedDates.length > 1 ? 's' : ''}: ${matchedDates.join(' and ')}.`
        : null)
      : `${label} not found for this origin and destination within 3 days of ${date}.`,
    options,
    attribution: 'Public transport data provided by Transitous and its source operators.',
    requested_date: date,
    matched_dates: matchedDates,
    fallback_used: fallbackUsed,
  };
}
