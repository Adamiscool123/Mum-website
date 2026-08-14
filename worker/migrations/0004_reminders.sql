-- Track reminder emails so each booking gets exactly one
ALTER TABLE bookings ADD COLUMN reminded_at TEXT;
