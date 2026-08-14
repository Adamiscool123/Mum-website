-- Staff daily log: check-in/out plus clinic safety checks, filled in the admin app.
CREATE TABLE staff_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,               -- YYYY-MM-DD (Europe/London)
  staff_name TEXT NOT NULL,
  check_in TEXT,                        -- HH:MM
  check_out TEXT,                       -- HH:MM, set at end of shift
  touch_count TEXT,
  freezer_temp TEXT,
  emergency_drugs TEXT,                 -- ok | issue
  emergency_drugs_notes TEXT,
  cleanliness TEXT,                     -- ok | issue
  cleanliness_notes TEXT,
  room_temp TEXT,
  notes TEXT,
  submitted_by TEXT,                    -- admin username of the session
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_staff_logs_date ON staff_logs (log_date DESC);
