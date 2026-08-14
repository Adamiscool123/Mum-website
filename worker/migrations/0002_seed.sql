-- Catalogue seed — mirrors the website data-items (prices in pence, durations in minutes)

-- Wellness injections
INSERT INTO services (slug, name, category, price_pence, duration_min) VALUES
  ('b12',           'B12 Injection',          'injection', 4500, 15),
  ('vitamin-c',     'Vitamin C Injection',    'injection', 5500, 15),
  ('vitamin-d',     'Vitamin D Injection',    'injection', 5500, 15),
  ('zinc',          'Zinc Injection',         'injection', 4500, 15),
  ('magnesium',     'Magnesium Injection',    'injection', 5500, 15),
  ('glutathione',   'Glutathione Injection',  'injection', 7500, 15),
  ('nad-injection', 'NAD+ Injection',         'injection', 9500, 10);

-- IV therapies
INSERT INTO services (slug, name, category, price_pence, duration_min) VALUES
  ('hydrate-iv',     'Hydrate IV',              'iv', 22500, 35),
  ('performance-iv', 'Performance IV',          'iv', 24500, 60),
  ('energy-iv',      'Energy IV',               'iv', 27500, 75),
  ('immunity-iv',    'Immunity IV',             'iv', 27500, 60),
  ('glow-iv',        'Glow IV',                 'iv', 30500, 80),
  ('recovery-iv',    'Recovery IV',             'iv', 33500, 90),
  ('detox-iv',       'Detox IV',                'iv', 39500, 100),
  ('bespoke-iv',     'Bespoke IV Therapy',      'iv', 49500, 100);

-- NAD+ therapy
INSERT INTO services (slug, name, category, price_pence, duration_min) VALUES
  ('nad-250', 'NAD+ Therapy (250mg)',          'nad', 49500, 180),
  ('nad-500', 'NAD+ Advanced Therapy (500mg)', 'nad', 79500, 210);

-- LPG single sessions
INSERT INTO services (slug, name, category, price_pence, duration_min) VALUES
  ('lpg-face-1',  'Face Lift & Sculpt',                   'lpg',  9500, 30),
  ('lpg-body-1',  'Targeted Body Contouring',             'lpg', 13500, 35),
  ('lpg-combo-1', 'Face Lift & Sculpt + Targeted Body',   'lpg', 19500, 60),
  ('lpg-full-1',  'Full Body Sculpting',                  'lpg', 27000, 50);

-- Membership tiers
INSERT INTO membership_tiers (id, name, price_pence, sessions_per_month) VALUES
  ('foundation', 'Foundation', 29500, 5),
  ('signature',  'Signature',  49500, 9),
  ('private',    'Private',    79500, 12);

-- LPG session programmes (packages) — expiry months mirror the Fresha setup
INSERT INTO packages (slug, name, service_slug, sessions_total, price_pence, expires_months) VALUES
  ('lpg-face-8',   'Face Lift & Sculpt — 8 Session Programme',                 'lpg-face-1',   8,  68000,  9),
  ('lpg-face-10',  'Face Lift & Sculpt — 10 Session Programme',                'lpg-face-1',  10,  82000, 12),
  ('lpg-body-6',   'Targeted Body Contouring — 6 Session Programme',           'lpg-body-1',   6,  75000,  6),
  ('lpg-body-10',  'Targeted Body Contouring — 10 Session Programme',          'lpg-body-1',  10, 120000, 12),
  ('lpg-combo-10', 'Face Lift & Sculpt + Targeted Body — 10 Session Programme','lpg-combo-1', 10, 175000, 12),
  ('lpg-full-6',   'Full Body Sculpting — 6 Session Programme',                'lpg-full-1',   6, 150000,  6),
  ('lpg-full-10',  'Full Body Sculpting — 10 Session Programme',               'lpg-full-1',  10, 235000, 12);

-- Defaults: capacity 5, 15-min slots, Mon–Sat 10:00–19:00, Sunday closed (adjustable in admin)
INSERT INTO settings (key, value) VALUES
  ('capacity', '5'),
  ('slot_minutes', '15'),
  ('lead_time_minutes', '60'),
  ('cancel_window_hours', '24'),
  ('hours', '{"1":"10:00-19:00","2":"10:00-19:00","3":"10:00-19:00","4":"10:00-19:00","5":"10:00-19:00","6":"10:00-19:00","0":null}');
