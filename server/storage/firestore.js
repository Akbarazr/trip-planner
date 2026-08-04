import { randomUUID } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase.js';

const trips = firestore.collection('trips');

const now = () => Timestamp.now();
const nestedId = (tripId) =>
  Buffer.from(`${tripId}:${randomUUID()}`, 'utf8').toString('base64url');

function tripIdFromNestedId(id) {
  try {
    const decoded = Buffer.from(id, 'base64url').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator > 0 ? decoded.slice(0, separator) : null;
  } catch {
    return null;
  }
}

function timestampValue(value) {
  return value?.toDate instanceof Function ? value.toDate().toISOString() : value ?? null;
}

function publicTrip(snapshot, viewerUid = null) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data();
  return {
    id: snapshot.id,
    title: data.title,
    travel_mode: data.travel_mode || 'car',
    travel_option: data.travel_option ?? null,
    origin: data.origin,
    origin_lat: data.origin_lat ?? null,
    origin_lon: data.origin_lon ?? null,
    destination: data.destination,
    dest_lat: data.dest_lat ?? null,
    dest_lon: data.dest_lon ?? null,
    start_date: data.start_date ?? null,
    share_token: data.share_token ?? null,
    budget_amount: data.budget_amount ?? null,
    budget_currency: data.budget_currency || 'USD',
    expenses: (data.expenses || []).map((expense) => ({
      id: expense.id,
      label: expense.label,
      amount: expense.amount,
      category: expense.category,
      created_at: timestampValue(expense.created_at),
    })),
    poll_options: (data.poll_options || []).map((option) => {
      const voterUids = [...new Set(option.voter_uids || [])];
      return {
        id: option.id,
        label: option.label,
        category: option.category,
        vote_count: voterUids.length,
        user_voted: Boolean(viewerUid && voterUids.includes(viewerUid)),
      };
    }),
    created_at: timestampValue(data.created_at),
    updated_at: timestampValue(data.updated_at),
    days: [...(data.days || [])]
      .sort((a, b) => a.day_number - b.day_number)
      .map((day) => ({
        ...day,
        trip_id: snapshot.id,
        stops: [...(day.stops || [])]
          .sort((a, b) => (a.position - b.position) || String(a.id).localeCompare(String(b.id)))
          .map((stop) => ({ ...stop, day_id: day.id })),
      })),
  };
}

function sharedTrip(snapshot, viewerUid = null) {
  const trip = publicTrip(snapshot, viewerUid);
  if (!trip) return null;
  const {
    budget_amount: _budgetAmount,
    budget_currency: _budgetCurrency,
    expenses: _expenses,
    ...shared
  } = trip;
  return shared;
}

async function ownedSnapshot(id, ownerId) {
  if (!id || !ownerId) return null;
  const snapshot = await trips.doc(String(id)).get();
  return snapshot.exists && snapshot.get('owner_id') === ownerId ? snapshot : null;
}

async function mutateNested(id, ownerId, update) {
  if (!id || !ownerId) return false;
  const ref = trips.doc(String(id));
  const changed = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get('owner_id') !== ownerId) return false;
    const data = snapshot.data();
    const next = update(data);
    if (!next) return false;
    transaction.update(ref, { ...next, updated_at: now() });
    return true;
  });
  return changed;
}

async function deleteMessages(tripRef) {
  while (true) {
    const snapshot = await tripRef.collection('messages').limit(400).get();
    if (snapshot.empty) return;
    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

const storage = {
  async listTrips(ownerId) {
    if (!ownerId) return [];
    const snapshot = await trips.where('owner_id', '==', ownerId).get();
    return snapshot.docs
      .map((doc) => publicTrip(doc, ownerId))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map((trip) => ({
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
      }));
  },

  async getTrip(id, ownerId) {
    return publicTrip(await ownedSnapshot(id, ownerId), ownerId);
  },

  async getSharedTrip(token, viewerUid = null) {
    const snapshot = await trips.where('share_token', '==', token).limit(1).get();
    return snapshot.empty ? null : sharedTrip(snapshot.docs[0], viewerUid);
  },

  async ensureShareToken(id, ownerId, token) {
    const ref = trips.doc(String(id));
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.get('owner_id') !== ownerId) return null;
      const current = snapshot.get('share_token');
      if (current) return current;
      transaction.update(ref, { share_token: token, updated_at: now() });
      return token;
    });
  },

  async createTrip(trip, ownerId) {
    if (!ownerId) return null;
    const ref = trips.doc();
    const createdAt = now();
    const itinerary = trip.itinerary?.length
      ? trip.itinerary
      : [{ date: trip.start_date ?? null, stops: [] }];
    await ref.set({
      owner_id: ownerId,
      title: trip.title,
      travel_mode: trip.travel_mode,
      travel_option: trip.travel_option ?? null,
      origin: trip.origin,
      origin_lat: trip.origin_lat ?? null,
      origin_lon: trip.origin_lon ?? null,
      destination: trip.destination,
      dest_lat: trip.dest_lat ?? null,
      dest_lon: trip.dest_lon ?? null,
      start_date: trip.start_date ?? null,
      share_token: null,
      budget_amount: null,
      budget_currency: 'USD',
      expenses: [],
      poll_options: [],
      created_at: createdAt,
      updated_at: createdAt,
      days: itinerary.map((day, dayIndex) => {
        const dayId = nestedId(ref.id);
        return {
          id: dayId,
          day_number: dayIndex + 1,
          date: day.date ?? null,
          notes: null,
          stops: day.stops.map((stop, stopIndex) => ({
            id: nestedId(ref.id),
            day_id: dayId,
            name: stop.name,
            lat: stop.lat ?? null,
            lon: stop.lon ?? null,
            position: stopIndex,
          })),
        };
      }),
    });
    return publicTrip(await ref.get(), ownerId);
  },

  async updateLocations(id, ownerId, locations) {
    const ref = trips.doc(String(id));
    const snapshot = await ownedSnapshot(id, ownerId);
    if (!snapshot) return null;
    await ref.update({ ...locations, updated_at: now() });
    return publicTrip(await ref.get(), ownerId);
  },

  async updateBudget(id, ownerId, values) {
    const ref = trips.doc(String(id));
    const snapshot = await ownedSnapshot(id, ownerId);
    if (!snapshot) return null;
    await ref.update({ ...values, updated_at: now() });
    return publicTrip(await ref.get(), ownerId);
  },

  async addExpense(tripId, ownerId, values) {
    const changed = await mutateNested(tripId, ownerId, (data) => ({
      expenses: [...(data.expenses || []), {
        id: nestedId(tripId),
        label: values.label,
        amount: values.amount,
        category: values.category,
        created_at: now(),
      }],
    }));
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async deleteExpense(expenseId, ownerId) {
    const tripId = tripIdFromNestedId(expenseId);
    const changed = await mutateNested(tripId, ownerId, (data) => {
      const expenses = data.expenses || [];
      if (!expenses.some((expense) => expense.id === expenseId)) return null;
      return { expenses: expenses.filter((expense) => expense.id !== expenseId) };
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async addPollOption(tripId, ownerId, values) {
    const changed = await mutateNested(tripId, ownerId, (data) => ({
      poll_options: [...(data.poll_options || []), {
        id: nestedId(tripId),
        label: values.label,
        category: values.category,
        voter_uids: [],
      }],
    }));
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async deletePollOption(optionId, ownerId) {
    const tripId = tripIdFromNestedId(optionId);
    const changed = await mutateNested(tripId, ownerId, (data) => {
      const options = data.poll_options || [];
      if (!options.some((option) => option.id === optionId)) return null;
      return { poll_options: options.filter((option) => option.id !== optionId) };
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async toggleSharedVote(token, optionId, uid) {
    const tripId = tripIdFromNestedId(optionId);
    if (!tripId || !uid) return null;
    const ref = trips.doc(tripId);
    const changed = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.get('share_token') !== token) return false;
      const options = [...(snapshot.get('poll_options') || [])];
      const index = options.findIndex((option) => option.id === optionId);
      if (index < 0) return false;
      const voterUids = new Set(options[index].voter_uids || []);
      if (voterUids.has(uid)) voterUids.delete(uid);
      else voterUids.add(uid);
      options[index] = { ...options[index], voter_uids: [...voterUids] };
      transaction.update(ref, { poll_options: options, updated_at: now() });
      return true;
    });
    return changed ? sharedTrip(await ref.get(), uid) : null;
  },

  async deleteTrip(id, ownerId) {
    const snapshot = await ownedSnapshot(id, ownerId);
    if (!snapshot) return false;
    await deleteMessages(snapshot.ref);
    await snapshot.ref.delete();
    return true;
  },

  async addDay(tripId, ownerId, values) {
    const changed = await mutateNested(tripId, ownerId, (data) => {
      const days = [...(data.days || [])];
      const next = Math.max(0, ...days.map((day) => Number(day.day_number) || 0)) + 1;
      days.push({
        id: nestedId(tripId),
        day_number: next,
        date: values.date || null,
        notes: values.notes || null,
        stops: [],
      });
      return { days };
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async updateDay(dayId, ownerId, values) {
    const tripId = tripIdFromNestedId(dayId);
    const changed = await mutateNested(tripId, ownerId, (data) => {
      const days = [...(data.days || [])];
      const index = days.findIndex((day) => day.id === dayId);
      if (index < 0) return null;
      days[index] = {
        ...days[index],
        ...(values.date != null ? { date: values.date } : {}),
        ...(values.notes != null ? { notes: values.notes } : {}),
      };
      return { days };
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async deleteDay(dayId, ownerId) {
    const tripId = tripIdFromNestedId(dayId);
    const changed = await mutateNested(tripId, ownerId, (data) => {
      const days = data.days || [];
      if (!days.some((day) => day.id === dayId)) return null;
      return { days: days.filter((day) => day.id !== dayId) };
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async addStop(dayId, ownerId, values) {
    const tripId = tripIdFromNestedId(dayId);
    const changed = await mutateNested(tripId, ownerId, (data) => {
      const days = [...(data.days || [])];
      const index = days.findIndex((day) => day.id === dayId);
      if (index < 0) return null;
      const stops = [...(days[index].stops || [])];
      const position = Math.max(-1, ...stops.map((stop) => Number(stop.position) || 0)) + 1;
      stops.push({
        id: nestedId(tripId),
        day_id: dayId,
        name: values.name,
        lat: values.lat ?? null,
        lon: values.lon ?? null,
        position,
      });
      days[index] = { ...days[index], stops };
      return { days };
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async deleteStop(stopId, ownerId) {
    const tripId = tripIdFromNestedId(stopId);
    const changed = await mutateNested(tripId, ownerId, (data) => {
      let found = false;
      const days = (data.days || []).map((day) => {
        const stops = day.stops || [];
        if (!stops.some((stop) => stop.id === stopId)) return day;
        found = true;
        return { ...day, stops: stops.filter((stop) => stop.id !== stopId) };
      });
      return found ? { days } : null;
    });
    return changed ? this.getTrip(tripId, ownerId) : null;
  },

  async addMessage(tripId, ownerId, role, content) {
    const snapshot = await ownedSnapshot(tripId, ownerId);
    if (!snapshot) return false;
    await snapshot.ref.collection('messages').add({
      role,
      content,
      created_at: now(),
    });
    return true;
  },

  async listMessages(tripId, ownerId) {
    const snapshot = await ownedSnapshot(tripId, ownerId);
    if (!snapshot) return null;
    const messages = await snapshot.ref.collection('messages').orderBy('created_at').get();
    return messages.docs.map((doc) => ({
      role: doc.get('role'),
      content: doc.get('content'),
      created_at: timestampValue(doc.get('created_at')),
    }));
  },
};

export default storage;
