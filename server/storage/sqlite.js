import db from '../db.js';

function ownedTripId(id, ownerId) {
  return db.prepare('SELECT id FROM trips WHERE id = ? AND owner_id = ?').get(id, ownerId)?.id ?? null;
}

function tripWithDays(id, viewerUid = null) {
  const row = db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
  if (!row) return null;
  const { owner_id: _ownerId, ...trip } = row;
  trip.budget_amount = trip.budget_amount == null ? null : Number(trip.budget_amount);
  trip.budget_currency = trip.budget_currency || 'USD';
  if (trip.travel_option) {
    try {
      trip.travel_option = JSON.parse(trip.travel_option);
    } catch {
      trip.travel_option = null;
    }
  }
  const days = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(id);
  for (const day of days) {
    day.stops = db
      .prepare('SELECT * FROM stops WHERE day_id = ? ORDER BY position, id')
      .all(day.id);
  }
  trip.days = days;
  trip.expenses = db.prepare(`
    SELECT id, label, amount, category, created_at
    FROM expenses WHERE trip_id = ? ORDER BY id
  `).all(id).map((expense) => ({ ...expense, amount: Number(expense.amount) }));
  trip.poll_options = db.prepare(`
    SELECT p.id, p.label, p.category,
      COUNT(v.uid) AS vote_count,
      MAX(CASE WHEN v.uid = ? THEN 1 ELSE 0 END) AS user_voted
    FROM poll_options p
    LEFT JOIN poll_votes v ON v.option_id = p.id
    WHERE p.trip_id = ?
    GROUP BY p.id
    ORDER BY p.id
  `).all(viewerUid, id).map((option) => ({
    ...option,
    vote_count: Number(option.vote_count),
    user_voted: Boolean(option.user_voted),
  }));
  return trip;
}

function sharedTrip(id, viewerUid = null) {
  const trip = tripWithDays(id, viewerUid);
  if (!trip) return null;
  const {
    budget_amount: _budgetAmount,
    budget_currency: _budgetCurrency,
    expenses: _expenses,
    ...shared
  } = trip;
  return shared;
}

const createTrip = db.transaction((trip, ownerId) => {
  const info = db.prepare(`
    INSERT INTO trips (
      owner_id, title, travel_mode, travel_option, origin, origin_lat, origin_lon,
      destination, dest_lat, dest_lon, start_date
    )
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    ownerId,
    trip.title,
    trip.travel_mode,
    trip.travel_option ? JSON.stringify(trip.travel_option) : null,
    trip.origin,
    trip.origin_lat,
    trip.origin_lon,
    trip.destination,
    trip.dest_lat,
    trip.dest_lon,
    trip.start_date,
  );
  const itinerary = trip.itinerary?.length
    ? trip.itinerary
    : [{ date: trip.start_date, stops: [] }];
  const insertDay = db.prepare(
    'INSERT INTO days (trip_id, day_number, date) VALUES (?,?,?)',
  );
  const insertStop = db.prepare(
    'INSERT INTO stops (day_id, name, lat, lon, position) VALUES (?,?,?,?,?)',
  );
  itinerary.forEach((day, dayIndex) => {
    const dayInfo = insertDay.run(info.lastInsertRowid, dayIndex + 1, day.date || null);
    day.stops.forEach((stop, stopIndex) => {
      insertStop.run(
        dayInfo.lastInsertRowid,
        stop.name,
        stop.lat ?? null,
        stop.lon ?? null,
        stopIndex,
      );
    });
  });
  return tripWithDays(info.lastInsertRowid, ownerId);
});

const storage = {
  async listTrips(ownerId) {
    const rows = db.prepare(`
      SELECT id FROM trips WHERE owner_id = ? ORDER BY updated_at DESC
    `).all(ownerId);
    return rows.map(({ id }) => {
      const trip = tripWithDays(id, ownerId);
      return {
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
      };
    });
  },

  async getTrip(id, ownerId) {
    return ownedTripId(id, ownerId) ? tripWithDays(id, ownerId) : null;
  },

  async getSharedTrip(token, viewerUid = null) {
    const trip = db.prepare('SELECT id FROM trips WHERE share_token = ?').get(token);
    return trip ? sharedTrip(trip.id, viewerUid) : null;
  },

  async ensureShareToken(id, ownerId, token) {
    const trip = db.prepare(
      'SELECT id, share_token FROM trips WHERE id = ? AND owner_id = ?',
    ).get(id, ownerId);
    if (!trip) return null;
    if (!trip.share_token) {
      db.prepare("UPDATE trips SET share_token = ?, updated_at = datetime('now') WHERE id = ?")
        .run(token, id);
    }
    return trip.share_token || token;
  },

  async createTrip(trip, ownerId) {
    return createTrip(trip, ownerId);
  },

  async updateLocations(id, ownerId, locations) {
    const result = db.prepare(`
      UPDATE trips
      SET title = ?, origin = ?, origin_lat = ?, origin_lon = ?,
          destination = ?, dest_lat = ?, dest_lon = ?, updated_at = datetime('now')
      WHERE id = ? AND owner_id = ?
    `).run(
      locations.title,
      locations.origin,
      locations.origin_lat,
      locations.origin_lon,
      locations.destination,
      locations.dest_lat,
      locations.dest_lon,
      id,
      ownerId,
    );
    return result.changes ? tripWithDays(id, ownerId) : null;
  },

  async updateBudget(id, ownerId, values) {
    const result = db.prepare(`
      UPDATE trips
      SET budget_amount = ?, budget_currency = ?, updated_at = datetime('now')
      WHERE id = ? AND owner_id = ?
    `).run(values.budget_amount, values.budget_currency, id, ownerId);
    return result.changes ? tripWithDays(id, ownerId) : null;
  },

  async addExpense(tripId, ownerId, values) {
    if (!ownedTripId(tripId, ownerId)) return null;
    db.prepare('INSERT INTO expenses (trip_id, label, amount, category) VALUES (?,?,?,?)')
      .run(tripId, values.label, values.amount, values.category);
    db.prepare("UPDATE trips SET updated_at = datetime('now') WHERE id = ?").run(tripId);
    return tripWithDays(tripId, ownerId);
  },

  async deleteExpense(expenseId, ownerId) {
    const expense = db.prepare(`
      SELECT e.trip_id FROM expenses e
      JOIN trips t ON t.id = e.trip_id
      WHERE e.id = ? AND t.owner_id = ?
    `).get(expenseId, ownerId);
    if (!expense) return null;
    db.prepare('DELETE FROM expenses WHERE id = ?').run(expenseId);
    db.prepare("UPDATE trips SET updated_at = datetime('now') WHERE id = ?").run(expense.trip_id);
    return tripWithDays(expense.trip_id, ownerId);
  },

  async addPollOption(tripId, ownerId, values) {
    if (!ownedTripId(tripId, ownerId)) return null;
    db.prepare('INSERT INTO poll_options (trip_id, label, category) VALUES (?,?,?)')
      .run(tripId, values.label, values.category);
    db.prepare("UPDATE trips SET updated_at = datetime('now') WHERE id = ?").run(tripId);
    return tripWithDays(tripId, ownerId);
  },

  async deletePollOption(optionId, ownerId) {
    const option = db.prepare(`
      SELECT p.trip_id FROM poll_options p
      JOIN trips t ON t.id = p.trip_id
      WHERE p.id = ? AND t.owner_id = ?
    `).get(optionId, ownerId);
    if (!option) return null;
    db.prepare('DELETE FROM poll_votes WHERE option_id = ?').run(optionId);
    db.prepare('DELETE FROM poll_options WHERE id = ?').run(optionId);
    db.prepare("UPDATE trips SET updated_at = datetime('now') WHERE id = ?").run(option.trip_id);
    return tripWithDays(option.trip_id, ownerId);
  },

  async toggleSharedVote(token, optionId, uid) {
    const option = db.prepare(`
      SELECT p.trip_id FROM poll_options p
      JOIN trips t ON t.id = p.trip_id
      WHERE p.id = ? AND t.share_token = ?
    `).get(optionId, token);
    if (!option) return null;
    const vote = db.prepare(
      'SELECT 1 FROM poll_votes WHERE option_id = ? AND uid = ?',
    ).get(optionId, uid);
    if (vote) {
      db.prepare('DELETE FROM poll_votes WHERE option_id = ? AND uid = ?').run(optionId, uid);
    } else {
      db.prepare('INSERT INTO poll_votes (option_id, uid) VALUES (?,?)').run(optionId, uid);
    }
    return sharedTrip(option.trip_id, uid);
  },

  async deleteTrip(id, ownerId) {
    if (!ownedTripId(id, ownerId)) return false;
    db.prepare(`
      DELETE FROM poll_votes
      WHERE option_id IN (SELECT id FROM poll_options WHERE trip_id = ?)
    `).run(id);
    db.prepare('DELETE FROM poll_options WHERE trip_id = ?').run(id);
    db.prepare('DELETE FROM expenses WHERE trip_id = ?').run(id);
    db.prepare('DELETE FROM stops WHERE day_id IN (SELECT id FROM days WHERE trip_id = ?)').run(id);
    db.prepare('DELETE FROM days WHERE trip_id = ?').run(id);
    db.prepare('DELETE FROM messages WHERE trip_id = ?').run(id);
    db.prepare('DELETE FROM trips WHERE id = ?').run(id);
    return true;
  },

  async addDay(tripId, ownerId, values) {
    if (!ownedTripId(tripId, ownerId)) return null;
    const max = db.prepare('SELECT MAX(day_number) n FROM days WHERE trip_id = ?').get(tripId);
    db.prepare('INSERT INTO days (trip_id, day_number, date, notes) VALUES (?,?,?,?)')
      .run(tripId, (max?.n || 0) + 1, values.date || null, values.notes || null);
    db.prepare("UPDATE trips SET updated_at = datetime('now') WHERE id = ?").run(tripId);
    return tripWithDays(tripId, ownerId);
  },

  async updateDay(dayId, ownerId, values) {
    const day = db.prepare(`
      SELECT d.trip_id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.id = ? AND t.owner_id = ?
    `).get(dayId, ownerId);
    if (!day) return null;
    db.prepare('UPDATE days SET date = COALESCE(?, date), notes = COALESCE(?, notes) WHERE id = ?')
      .run(values.date ?? null, values.notes ?? null, dayId);
    return tripWithDays(day.trip_id, ownerId);
  },

  async deleteDay(dayId, ownerId) {
    const day = db.prepare(`
      SELECT d.trip_id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.id = ? AND t.owner_id = ?
    `).get(dayId, ownerId);
    if (!day) return null;
    db.prepare('DELETE FROM stops WHERE day_id = ?').run(dayId);
    db.prepare('DELETE FROM days WHERE id = ?').run(dayId);
    return tripWithDays(day.trip_id, ownerId);
  },

  async addStop(dayId, ownerId, values) {
    const day = db.prepare(`
      SELECT d.trip_id FROM days d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.id = ? AND t.owner_id = ?
    `).get(dayId, ownerId);
    if (!day) return null;
    const max = db.prepare('SELECT MAX(position) p FROM stops WHERE day_id = ?').get(dayId);
    db.prepare('INSERT INTO stops (day_id, name, lat, lon, position) VALUES (?,?,?,?,?)')
      .run(dayId, values.name, values.lat ?? null, values.lon ?? null, (max?.p ?? -1) + 1);
    return tripWithDays(day.trip_id, ownerId);
  },

  async deleteStop(stopId, ownerId) {
    const stop = db.prepare(`
      SELECT d.trip_id FROM stops s
      JOIN days d ON s.day_id = d.id
      JOIN trips t ON t.id = d.trip_id
      WHERE s.id = ? AND t.owner_id = ?
    `).get(stopId, ownerId);
    if (!stop) return null;
    db.prepare('DELETE FROM stops WHERE id = ?').run(stopId);
    return tripWithDays(stop.trip_id, ownerId);
  },

  async addMessage(tripId, ownerId, role, content) {
    if (!ownedTripId(tripId, ownerId)) return false;
    db.prepare('INSERT INTO messages (trip_id, role, content) VALUES (?,?,?)')
      .run(tripId, role, content);
    return true;
  },

  async listMessages(tripId, ownerId) {
    if (!ownedTripId(tripId, ownerId)) return null;
    return db.prepare(
      'SELECT role, content, created_at FROM messages WHERE trip_id = ? ORDER BY id',
    ).all(tripId);
  },
};

export default storage;
