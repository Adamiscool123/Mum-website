-- Staff operational checklists digitised from the clinic's three Excel sheets:
-- opening = daily morning opening checklist
-- drugs = drug stock counts + nurse initials
-- consumables = consumables stock & order list
CREATE TABLE checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'drugs', 'consumables')),
  log_date TEXT NOT NULL,               -- YYYY-MM-DD (Europe/London)
  data TEXT NOT NULL,                   -- JSON of answers
  submitted_by TEXT,                    -- admin username of the session
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_checklists_kind_date ON checklists (kind, log_date DESC);
