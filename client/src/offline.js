const DB_NAME = 'wander-offline';
const DB_VERSION = 1;
const STORE_NAME = 'trips';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('userId', 'userId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const result = await action(transaction.objectStore(STORE_NAME));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
}

const keyFor = (userId, tripId) => `${userId}:${tripId}`;

export async function cacheTrip(userId, trip) {
  if (!userId || !trip?.id || !trip.days) return;
  await withStore('readwrite', async (store) => {
    const key = keyFor(userId, trip.id);
    const current = await requestResult(store.get(key));
    store.put({
      ...current,
      key,
      userId,
      tripId: String(trip.id),
      trip,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function cacheRoute(userId, tripId, route) {
  if (!userId || !tripId || !route) return;
  await withStore('readwrite', async (store) => {
    const key = keyFor(userId, tripId);
    const current = await requestResult(store.get(key));
    if (!current?.trip) return;
    store.put({
      ...current,
      route,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function getCachedTrip(userId, tripId) {
  if (!userId || !tripId) return null;
  return withStore('readonly', async (store) => {
    const bundle = await requestResult(store.get(keyFor(userId, tripId)));
    return bundle?.trip || null;
  });
}

export async function getCachedRoute(userId, tripId) {
  if (!userId || !tripId) return null;
  return withStore('readonly', async (store) => {
    const bundle = await requestResult(store.get(keyFor(userId, tripId)));
    return bundle?.route || null;
  });
}

export async function getCachedTrips(userId) {
  if (!userId) return [];
  return withStore('readonly', async (store) => {
    const rows = await requestResult(store.index('userId').getAll(userId));
    return rows
      .filter((row) => row.trip)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(({ trip }) => ({
        id: trip.id,
        title: trip.title,
        travel_mode: trip.travel_mode,
        origin: trip.origin,
        destination: trip.destination,
        start_date: trip.start_date,
        budget_amount: trip.budget_amount,
        budget_currency: trip.budget_currency,
        expenses: trip.expenses,
        created_at: trip.created_at,
        updated_at: trip.updated_at,
        offline: true,
      }));
  });
}

export async function getOfflineStatus(userId, tripId) {
  if (!userId || !tripId) return null;
  return withStore('readonly', async (store) => {
    const bundle = await requestResult(store.get(keyFor(userId, tripId)));
    return bundle ? { updatedAt: bundle.updatedAt, hasRoute: Boolean(bundle.route) } : null;
  });
}

export async function removeCachedTrip(userId, tripId) {
  if (!userId || !tripId) return;
  await withStore('readwrite', async (store) => {
    store.delete(keyFor(userId, tripId));
  });
}
