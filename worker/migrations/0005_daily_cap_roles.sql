-- Daily treatment cap + admin roles + employee account

INSERT INTO settings (key, value) VALUES ('daily_cap', '5')
  ON CONFLICT(key) DO NOTHING;

ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';

INSERT INTO admin_users (username, password_hash, role)
  VALUES ('areumemployee', 'pbkdf2$50000$ss/fvLM6VnfZjgwUjF4dQw==$AeHpar/t4fPAnJpkJom+DDn/X9bwyb9jQhyaC8hKUAs=', 'staff');
