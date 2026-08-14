-- August 2026 menu update
-- Removed: Energy IV, NAD+ 250mg, Zinc, Magnesium. Glow IV becomes Radiance IV.
-- Old rows are deactivated (not deleted) so past bookings keep their names.

UPDATE services SET active = 0 WHERE slug IN ('energy-iv', 'glow-iv', 'nad-250', 'zinc', 'magnesium');

UPDATE services SET name = 'Methylated B12 Injection', price_pence = 4900 WHERE slug = 'b12';
UPDATE services SET price_pence = 4500 WHERE slug = 'vitamin-d';

INSERT INTO services (slug, name, category, price_pence, duration_min) VALUES
  ('radiance-iv', 'Radiance IV',          'iv',        30500, 80),
  ('biotin',      'Biotin Injection',     'injection',  5500, 15),
  ('coq10',       'CoQ10 Injection',      'injection',  8900, 15),
  ('methionine',  'Methionine Injection', 'injection',  7500, 15);

-- Memberships now include N Essential IV treatments (+ N injections) per month
UPDATE membership_tiers SET sessions_per_month = 1 WHERE id = 'foundation';
UPDATE membership_tiers SET sessions_per_month = 2 WHERE id = 'signature';
UPDATE membership_tiers SET sessions_per_month = 3 WHERE id = 'private';
