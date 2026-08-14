-- Track refunds issued from the admin dashboard
ALTER TABLE bookings ADD COLUMN refunded_at TEXT;
