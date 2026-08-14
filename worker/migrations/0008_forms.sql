-- Signed client forms (medical assessment + treatment consent), captured on the /forms page.
CREATE TABLE form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('medical', 'consent')),
  client_name TEXT NOT NULL,
  client_email TEXT,
  data TEXT NOT NULL,                    -- JSON of every answer
  client_signature TEXT NOT NULL,        -- data:image/png;base64
  practitioner_signature TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_forms_created ON form_submissions (created_at DESC);
CREATE INDEX idx_forms_name ON form_submissions (client_name COLLATE NOCASE);
