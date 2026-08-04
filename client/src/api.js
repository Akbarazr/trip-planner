import { auth } from './firebase';
import {
  cacheTrip, getCachedTrip, getCachedTrips, removeCachedTrip,
} from './offline';

const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

async function req(path, opts = {}) {
  const token = opts.anonymous ? null : await auth.currentUser?.getIdToken();
  let responseReceived = false;
  try {
    const res = await fetch(base + path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    responseReceived = true;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    const data = await res.json();
    if (!opts.anonymous && data?.id && data?.days) {
      cacheTrip(auth.currentUser?.uid, data).catch((error) => {
        console.error('Could not refresh offline trip cache', error);
      });
    }
    return data;
  } catch (error) {
    if (responseReceived) throw error;
    if (opts.method && opts.method !== 'GET') throw error;
    if (path === '/trips') {
      const trips = await getCachedTrips(auth.currentUser?.uid);
      if (trips.length) return trips;
    }
    const match = path.match(/^\/trips\/([^/?]+)$/);
    if (match) {
      const trip = await getCachedTrip(auth.currentUser?.uid, match[1]);
      if (trip) return { ...trip, offline: true };
    }
    throw error;
  }
}

export const api = {
  listTrips: () => req('/trips'),
  getTrip: (id) => req(`/trips/${id}`),
  getSharedTrip: (token) => req(`/shared/${encodeURIComponent(token)}`),
  createTrip: (data) => req('/trips', { method: 'POST', body: data }),
  shareTrip: (id) => req(`/trips/${id}/share`, { method: 'POST' }),
  updateTripLocations: (id, data) => req(`/trips/${id}/locations`, { method: 'PUT', body: data }),
  addPollOption: (id, data) => req(`/trips/${id}/poll-options`, { method: 'POST', body: data }),
  deletePollOption: (id) => req(`/poll-options/${id}`, { method: 'DELETE' }),
  voteSharedOption: (token, optionId) =>
    req(`/shared/${encodeURIComponent(token)}/votes/${encodeURIComponent(optionId)}`, { method: 'POST' }),
  deleteTrip: async (id) => {
    const result = await req(`/trips/${id}`, { method: 'DELETE' });
    await removeCachedTrip(auth.currentUser?.uid, id);
    return result;
  },

  addDay: (tripId, data = {}) => req(`/trips/${tripId}/days`, { method: 'POST', body: data }),
  updateDay: (dayId, data) => req(`/days/${dayId}`, { method: 'PUT', body: data }),
  deleteDay: (dayId) => req(`/days/${dayId}`, { method: 'DELETE' }),

  addStop: (dayId, data) => req(`/days/${dayId}/stops`, { method: 'POST', body: data }),
  deleteStop: (stopId) => req(`/stops/${stopId}`, { method: 'DELETE' }),

  geocode: (q) => req(`/geocode?q=${encodeURIComponent(q)}`),
  searchTransport: (data) => req('/transport/search', { method: 'POST', body: data }),
  suggestItinerary: (data) => req('/itinerary/suggest', { method: 'POST', body: data }),
  route: (points) =>
    req(`/route?points=${points.map((p) => `${p.lon},${p.lat}`).join(';')}`),
  places: (lat, lon, kind) => req(`/places?lat=${lat}&lon=${lon}&kind=${kind}`),
  suggestions: (tripId, kind) => req(`/trips/${tripId}/suggestions?kind=${kind}`),
  tip: (tripId) => req(`/trips/${tripId}/tip`),
  dayTip: (tripId, day) => req(`/trips/${tripId}/day-tip?day=${day}`),

  chat: (data) => req('/ai/chat', { method: 'POST', body: data }),
  morePlaces: (data) => req('/ai/more-places', { method: 'POST', body: data }),
  messages: (tripId) => req(`/trips/${tripId}/messages`),
};
