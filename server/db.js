import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'trips.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  travel_mode TEXT NOT NULL DEFAULT 'car',
  travel_option TEXT,
  origin TEXT NOT NULL,
  origin_lat REAL,
  origin_lon REAL,
  destination TEXT NOT NULL,
  dest_lat REAL,
  dest_lon REAL,
  start_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  day_number INTEGER NOT NULL,
  date TEXT,
  notes TEXT,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  lat REAL,
  lon REAL,
  position INTEGER DEFAULT 0,
  FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_votes (
  option_id INTEGER NOT NULL,
  uid TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (option_id, uid),
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
);

`);

const tripColumns = new Set(db.prepare('PRAGMA table_info(trips)').all().map((column) => column.name));
if (!tripColumns.has('travel_mode')) {
  db.exec("ALTER TABLE trips ADD COLUMN travel_mode TEXT NOT NULL DEFAULT 'car'");
}
if (!tripColumns.has('travel_option')) {
  db.exec('ALTER TABLE trips ADD COLUMN travel_option TEXT');
}
if (!tripColumns.has('share_token')) {
  db.exec('ALTER TABLE trips ADD COLUMN share_token TEXT');
}
if (!tripColumns.has('owner_id')) {
  db.exec("ALTER TABLE trips ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'");
}
if (!tripColumns.has('budget_amount')) {
  db.exec('ALTER TABLE trips ADD COLUMN budget_amount REAL');
}
if (!tripColumns.has('budget_currency')) {
  db.exec("ALTER TABLE trips ADD COLUMN budget_currency TEXT NOT NULL DEFAULT 'USD'");
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_share_token ON trips(share_token)');
db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON expenses(trip_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_poll_options_trip_id ON poll_options(trip_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_poll_votes_option_id ON poll_votes(option_id)');

export default db;
