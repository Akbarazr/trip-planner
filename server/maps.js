// Free, keyless map services: Nominatim (geocoding), OSRM (routing),
// Overpass (nearby places). We add a User-Agent as these services request it.

const UA = 'TripPlanner/1.0 (free demo app)';
const RELIGIOUS_PLACE_TYPES = new Set([
  'buddhist_temple', 'church', 'hindu_temple', 'mosque', 'shinto_shrine',
  'synagogue', 'place_of_worship',
]);
const RELIGIOUS_NAME_PATTERN =
  /\b(abbey|basilica|cathedral|chapel|church|gurdwara|masjid|monastery|mosque|shrine|synagogue|temple)\b/i;

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return res.json();
}

function isReligiousPlace(place) {
  const types = Array.isArray(place?.types) ? place.types : [];
  return types.some((type) => RELIGIOUS_PLACE_TYPES.has(type))
    || RELIGIOUS_PLACE_TYPES.has(place?.primaryType)
    || RELIGIOUS_NAME_PATTERN.test(place?.displayName?.text || '');
}

export async function highlyRatedPlaces(
  lat,
  lon,
  includedTypes,
  { radius = 30000, excludeNames = [] } = {},
) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    const error = new Error('Google Places is not configured for verified itinerary suggestions');
    error.status = 503;
    throw error;
  }
  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.primaryType',
        'places.types',
        'places.rating',
        'places.userRatingCount',
        'places.googleMapsUri',
      ].join(','),
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lon },
          radius: Math.min(50000, Math.max(1000, radius)),
        },
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const error = new Error(`Google Places search failed (${response.status})`);
    error.status = 502;
    throw error;
  }
  const excluded = new Set(excludeNames.map((name) => normalizePlaceName(name)).filter(Boolean));
  const data = await response.json();
  return (data.places || [])
    .filter((place) => (
      Number(place.rating) >= 4
      && Number(place.userRatingCount) >= 1000
      && !isReligiousPlace(place)
      && !excluded.has(normalizePlaceName(place.displayName?.text))
    ))
    .sort((a, b) => (
      Number(b.userRatingCount) - Number(a.userRatingCount)
      || Number(b.rating) - Number(a.rating)
    ))
    .map((place) => ({
      id: place.id,
      name: place.displayName?.text || place.formattedAddress,
      lat: place.location?.latitude,
      lon: place.location?.longitude,
      rating: Number(place.rating),
      reviewCount: Number(place.userRatingCount),
      googleMapsUri: place.googleMapsUri,
      details: `${Number(place.rating).toFixed(1)} stars · ${Number(place.userRatingCount).toLocaleString('en-US')} Google reviews${place.formattedAddress ? ` · ${place.formattedAddress}` : ''}`,
    }))
    .filter((place) => place.name && Number.isFinite(place.lat) && Number.isFinite(place.lon));
}

function normalizePlaceName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

// Turn a place name into coordinates. Results are ordered by Nominatim's
// "importance" so the most prominent match (a state, city or well-known
// landmark) comes first — this keeps ambiguous searches (e.g. "Texas") from
// resolving to some tiny same-named house on the other side of the country.
export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=20&addressdetails=1&q=${encodeURIComponent(query)}`;
  const data = await jsonFetch(url);
  const seen = new Set();
  return data
    .map((d) => {
      const a = d.address || {};
      // The specific place: a city, town, village, suburb, hamlet, etc.
      const place =
        d.name ||
        a.city || a.town || a.village || a.suburb || a.hamlet ||
        a.municipality || a.county || a.state ||
        d.display_name.split(',')[0];
      // A tidy "Place, Region, Country" label for the dropdown.
      const region = a.state || a.region || a.county || '';
      const country = a.country || '';
      const label = [place, region, country].filter(Boolean).join(', ');
      return {
        name: d.display_name,
        label,
        place,
        region,
        country,
        countryCode: String(a.country_code || '').toUpperCase(),
        lat: parseFloat(d.lat),
        lon: parseFloat(d.lon),
        // A friendly category shown as a badge (city / town / village…).
        type: a.city ? 'city' : (d.addresstype || d.type || ''),
        importance: typeof d.importance === 'number' ? d.importance : 0,
      };
    })
    .filter((r) => {
      if (!r.lat || !r.lon) return false;
      const key = `${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.importance - a.importance);
}

// Geocode a place name but only accept results inside a bounding box
// (so we pin the spot the AI means, near the trip — not a same-named place
// on the other side of the world).
export async function geocodeInArea(query, box) {
  const viewbox = `${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}`;
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1` +
    `&q=${encodeURIComponent(query)}&viewbox=${encodeURIComponent(viewbox)}`;
  const data = await jsonFetch(url);
  if (!data || !data.length) return null;
  const d = data[0];
  return {
    name: d.name && d.name.trim() ? d.name : d.display_name.split(',')[0],
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    details: d.type || '',
  };
}

// Geocode a place name, biased toward the trip area (soft viewbox) but willing
// to return the real place even if it sits a bit outside a tight box — as long
// as it's within maxKm of the trip corridor. This is what lets us drop a dot on
// the *exact* place the AI named (e.g. a hotel in Detroit), instead of nothing.
export async function geocodeNear(query, refs, maxKm = 300) {
  if (!refs || !refs.length) return null;
  const lats = refs.map((r) => r.lat);
  const lons = refs.map((r) => r.lon);
  const pad = 0.4;
  const viewbox =
    `${Math.min(...lons) - pad},${Math.min(...lats) - pad},` +
    `${Math.max(...lons) + pad},${Math.max(...lats) + pad}`;
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6` +
    `&q=${encodeURIComponent(query)}&viewbox=${encodeURIComponent(viewbox)}`;
  const data = await jsonFetch(url);
  for (const d of data || []) {
    const p = { lat: parseFloat(d.lat), lon: parseFloat(d.lon) };
    if (!p.lat || !p.lon) continue;
    const near = refs.some((r) => haversine(r, p) <= maxKm * 1000);
    if (near) {
      return {
        name: d.name && d.name.trim() ? d.name : d.display_name.split(',')[0],
        lat: p.lat,
        lon: p.lon,
        details: d.type || '',
      };
    }
  }
  return null;
}

// Great-circle distance in meters between two lon/lat points.
export function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Straight-line fallback so the map still shows a route if OSRM is unavailable.
function fallbackRoute(points) {
  let dist = 0;
  for (let i = 1; i < points.length; i++) dist += haversine(points[i - 1], points[i]);
  const roadDist = dist * 1.3; // roads aren't straight — rough correction
  return {
    distance_m: roadDist,
    duration_s: roadDist / 24.6, // ~55 mph average
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
    approximate: true,
  };
}

// Route through an ordered list of [lon,lat] points.
// Tries the free OSRM demo server (with one retry); falls back to a
// straight-line estimate if that public service is down or rate-limited.
export async function route(points) {
  const coordStr = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false&annotations=false`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await jsonFetch(url);
      if (data.routes && data.routes.length) {
        const r = data.routes[0];
        return { distance_m: r.distance, duration_s: r.duration, geometry: r.geometry };
      }
    } catch (e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
      console.warn('OSRM routing failed, using straight-line fallback:', e.message);
    }
  }
  return fallbackRoute(points);
}

// Find interesting places near a coordinate using Nominatim's bounded
// search. Nominatim (same service we use for geocoding) is far more
// reliable and faster than the public Overpass API.
const KIND_TERM = {
  food: 'restaurant',
  lodging: 'hotel',
  fuel: 'gas station',
  attraction: 'park',
  rest: 'rest area',
};

// Cuisine/diet vocabularies that map to OpenStreetMap tags. Nominatim's free
// text search matches place NAMES, not cuisine, so "indian restaurant" finds
// nothing unless a place is literally named that. Overpass can filter by the
// real `cuisine=` and `diet:*=` tags, which is how we actually find a "halal
// indian" spot.
const CUISINE_TAGS = ['indian', 'chinese', 'thai', 'mexican', 'italian', 'japanese', 'sushi',
  'korean', 'pizza', 'burger', 'seafood', 'steak', 'mediterranean', 'greek', 'vietnamese',
  'ramen', 'american', 'french', 'spanish', 'turkish', 'lebanese', 'ethiopian', 'caribbean',
  'barbecue', 'bbq'];
const DIET_TAGS = ['halal', 'kosher', 'vegan', 'vegetarian'];

// Find eateries near a point filtered by cuisine and/or diet tags via Overpass.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

function parseOverpass(data) {
  return (data.elements || [])
    .map((el) => {
      const c = el.center || el; // ways/relations carry a `center`
      const details = [
        el.tags?.cuisine ? el.tags.cuisine.replace(/[_;]/g, ' ') : 'restaurant',
        el.tags?.['diet:halal'] && /^(yes|only)$/i.test(el.tags['diet:halal']) ? 'halal' : null,
        el.tags?.['diet:kosher'] && /^(yes|only)$/i.test(el.tags['diet:kosher']) ? 'kosher' : null,
        el.tags?.['diet:vegan'] && /^(yes|only)$/i.test(el.tags['diet:vegan']) ? 'vegan options' : null,
        el.tags?.['diet:vegetarian'] && /^(yes|only)$/i.test(el.tags['diet:vegetarian']) ? 'vegetarian options' : null,
      ].filter(Boolean);
      return {
        name: el.tags?.name || '',
        lat: c.lat,
        lon: c.lon,
        kind: 'food',
        details: details.join(' · '),
      };
    })
    .filter((p) => p.lat && p.lon && p.name);
}

export async function nearbyByTags(lat, lon, { cuisine, diet, radius = 25000 } = {}) {
  const sel = ['["amenity"~"restaurant|fast_food|cafe|food_court"]'];
  if (cuisine) sel.push(`["cuisine"~"${cuisine === 'bbq' ? 'barbecue' : cuisine}",i]`);
  if (diet) sel.push(`["diet:${diet}"~"yes|only|limited",i]`);
  const s = sel.join('');
  const q = `[out:json][timeout:10];(node${s}(around:${radius},${lat},${lon});way${s}(around:${radius},${lat},${lon}););out center 30;`;
  // Public Overpass mirrors are frequently busy (429/504) or slow. Rather than
  // try them one at a time (a single stalled mirror wastes the whole budget),
  // race all mirrors at once and take the first that answers successfully.
  const attempts = OVERPASS_ENDPOINTS.map((endpoint) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.timeout(12000),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parseOverpass(await res.json());
    }),
  );
  try {
    return await Promise.any(attempts);
  } catch (e) {
    throw (e && e.errors && e.errors[0]) || new Error('Overpass unavailable');
  }
}

export async function nearbyPlaces(lat, lon, kind = 'attraction', radius = 4000, term) {
  const searchTerm = term || KIND_TERM[kind] || KIND_TERM.attraction;
  const d = Math.max(radius / 111000, 0.06); // meters -> degrees, with a sensible minimum
  const viewbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&bounded=1` +
    `&q=${encodeURIComponent(searchTerm)}&viewbox=${encodeURIComponent(viewbox)}`;
  const data = await jsonFetch(url);
  return (data || [])
    .map((el) => ({
      name: el.name && el.name.trim() ? el.name : el.display_name.split(',')[0],
      lat: parseFloat(el.lat),
      lon: parseFloat(el.lon),
      kind,
      details: el.type || el.category || '',
    }))
    .filter((p) => p.lat && p.lon && p.name);
}

// Try a list of search terms (most specific first) near a point, returning the
// first that yields results. Lets us honour a request like "halal indian
// restaurant" and gracefully fall back to "indian restaurant" then "restaurant"
// if the exact match isn't mapped nearby.
export async function nearbyPlacesTerms(lat, lon, terms, kind, radius = 8000) {
  // Food requests that name a cuisine or diet ("halal indian restaurant") must
  // be matched by OSM tags, not by name. Derive the cuisine/diet ONCE and make
  // at most two Overpass attempts: the exact match, then a broader one. Stop on
  // a network error so a busy Overpass can't stall the whole request.
  if (kind === 'food') {
    const lc = (terms.find(Boolean) || '').toLowerCase();
    const cuisine = CUISINE_TAGS.find((c) => new RegExp(`\\b${c}\\b`).test(lc));
    const diet = DIET_TAGS.find((d) => new RegExp(`\\b${d}\\b`).test(lc));
    if (cuisine || diet) {
      const rad = Math.max(radius, 20000);
      let found;
      try { found = await nearbyByTags(lat, lon, { cuisine, diet, radius: rad }); }
      catch { found = []; }
      if (found.length) return { places: found, matchedTerm: [diet, cuisine].filter(Boolean).join(' ') };
      // A specific cuisine/diet was requested but nothing matched — return empty
      // rather than a wrong-cuisine name match (a plain diner for "halal indian").
      return { places: [], matchedTerm: null };
    }
  }
  // Name search (Nominatim) for generic terms.
  for (const term of terms) {
    try {
      const found = await nearbyPlaces(lat, lon, kind, radius, term);
      if (found.length) return { places: found, matchedTerm: term };
    } catch { /* try the next, broader term */ }
  }
  return { places: [], matchedTerm: null };
}

// Sample points evenly along a route geometry so we can look for
// interesting stops "on the way".
export function sampleAlongGeometry(geometry, count = 4) {
  const coords = geometry?.coordinates || [];
  if (coords.length < 2) return [];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const idx = Math.floor((coords.length - 1) * (i / (count + 1)));
    const [lon, lat] = coords[idx];
    out.push({ lat, lon });
  }
  return out;
}

// The coordinate a given fraction (0..1) of the way along a route, measured by
// actual distance travelled — so "25% into the trip" lands at the real 25%
// point, not just 25% of the coordinate count.
export function pointAtFraction(geometry, frac) {
  const coords = geometry?.coordinates || [];
  if (coords.length < 2) return null;
  const f = Math.min(Math.max(frac, 0), 1);
  // Total length + cumulative lengths.
  let total = 0;
  const segLen = [];
  for (let i = 1; i < coords.length; i++) {
    const a = { lon: coords[i - 1][0], lat: coords[i - 1][1] };
    const b = { lon: coords[i][0], lat: coords[i][1] };
    const l = haversine(a, b);
    segLen.push(l);
    total += l;
  }
  const target = total * f;
  let acc = 0;
  for (let i = 0; i < segLen.length; i++) {
    if (acc + segLen[i] >= target) {
      const t = segLen[i] ? (target - acc) / segLen[i] : 0;
      const lon = coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t;
      const lat = coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t;
      return { lat, lon };
    }
    acc += segLen[i];
  }
  const [lon, lat] = coords[coords.length - 1];
  return { lat, lon };
}
