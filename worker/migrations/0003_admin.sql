-- Admin login is a username (shared clinic account), not an email
ALTER TABLE admin_users RENAME COLUMN email TO username;

-- Seed account: areum / admin123 (changeable in Settings → Account)
INSERT INTO admin_users (username, password_hash) VALUES
  ('areum', 'pbkdf2$50000$J8ABz1pDHv5WpqccEGe85Q==$VDJnIrixRonktY9bCtwn7HDbTWe1GMEVYkdtP0wBaEg=');

CREATE INDEX idx_login_attempts ON login_attempts(ip, attempted_at);
CREATE INDEX idx_admin_sessions_exp ON admin_sessions(expires_at);
