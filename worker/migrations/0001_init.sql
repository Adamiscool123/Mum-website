-- AREUM core schema
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  notes TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE services (
  slug TEXT PRIMARY KEY,            -- matches data-item on the website
  name TEXT NOT NULL,
  category TEXT NOT NULL,           -- iv | injection | nad | lpg
  price_pence INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  starts_at TEXT NOT NULL,          -- ISO UTC
  ends_at TEXT NOT NULL,            -- ISO UTC
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|confirmed|completed|no_show|cancelled
  source TEXT NOT NULL DEFAULT 'online',   -- online|walk_in|admin
  payment_intent_id TEXT,
  amount_pence INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bookings_starts ON bookings(starts_at);
CREATE INDEX idx_bookings_status ON bookings(status);

CREATE TABLE booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_slug TEXT NOT NULL REFERENCES services(slug),
  price_pence INTEGER NOT NULL
);
CREATE INDEX idx_booking_items_booking ON booking_items(booking_id);

CREATE TABLE membership_tiers (
  id TEXT PRIMARY KEY,              -- foundation | signature | private
  name TEXT NOT NULL,
  price_pence INTEGER NOT NULL,
  sessions_per_month INTEGER NOT NULL,
  stripe_price_id TEXT
);

CREATE TABLE memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  tier_id TEXT NOT NULL REFERENCES membership_tiers(id),
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'incomplete', -- incomplete|active|past_due|cancelled
  sessions_used_this_cycle INTEGER NOT NULL DEFAULT 0,
  cycle_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE packages (
  slug TEXT PRIMARY KEY,            -- matches data-item on the website (lpg-face-8 etc.)
  name TEXT NOT NULL,
  service_slug TEXT NOT NULL REFERENCES services(slug),
  sessions_total INTEGER NOT NULL,
  price_pence INTEGER NOT NULL,
  expires_months INTEGER NOT NULL DEFAULT 12,
  stripe_price_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE package_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  package_slug TEXT NOT NULL REFERENCES packages(slug),
  sessions_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|active|expired
  payment_intent_id TEXT,
  purchased_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE closed_dates (
  date TEXT PRIMARY KEY,            -- YYYY-MM-DD (clinic local date)
  reason TEXT
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,      -- pbkdf2$iterations$salt_b64$hash_b64
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES admin_users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE TABLE webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
