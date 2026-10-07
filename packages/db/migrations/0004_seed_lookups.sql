-- ===========================================================================
-- 0004_seed_lookups.sql
--
-- Reference data only: lookup tables and the primary organisation.
-- Deliberately contains NO demo geography and NO demo situational figures.
-- Demo data is a separate concern (Phase 2, Appendix A) and every row it
-- creates must carry is_demo = true and source = 'DEMO DATA - not real'.
--
-- safe to re-run.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Categories (spec 8.3)
-- ---------------------------------------------------------------------------
INSERT INTO app.categories (code, label, sort_order) VALUES
  ('FOOD',          'Food',          10),
  ('WATER',         'Water',         20),
  ('HYGIENE_WASH',  'Hygiene & WASH',30),
  ('SHELTER_NFI',   'Shelter & NFI', 40),
  ('HEALTH',        'Health',        50),
  ('PROTECTION',    'Protection',    60),
  ('EDUCATION',     'Education',     70),
  ('CASH_VOUCHER',  'Cash / Voucher',80),
  ('OTHER',         'Other',         90)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- Item types
--
-- default_unit matters for imports: when a source file gives a quantity with no
-- unit, the item's default is used rather than rejecting the row (spec 14.3
-- treats an unknown unit as a WARNING, not an ERROR).
-- ---------------------------------------------------------------------------
INSERT INTO app.item_types (category_code, label, default_unit) VALUES
  ('FOOD',         'Rice',              'kg'),
  ('FOOD',         'Flour',             'kg'),
  ('FOOD',         'Lentils / Dal',     'kg'),
  ('FOOD',         'Cooking oil',       'L'),
  ('FOOD',         'Salt',              'kg'),
  ('FOOD',         'Sugar',             'kg'),
  ('FOOD',         'Instant noodles',   'pack'),
  ('FOOD',         'Canned fish',       'can'),
  ('FOOD',         'Ready-to-eat food',  'pack'),
  ('WATER',        'Drinking water',    'L'),
  ('WATER',        'Water purification tablet', 'tablet'),
  ('HYGIENE_WASH', 'Soap',              'piece'),
  ('HYGIENE_WASH', 'Sanitary pad',      'piece'),
  ('HYGIENE_WASH', 'Hygiene kit',       'kit'),
  ('HYGIENE_WASH', 'Water storage container', 'piece'),
  ('HYGIENE_WASH', 'Blanket',           'piece'),
  ('SHELTER_NFI',  'Tarpaulin',         'piece'),
  ('SHELTER_NFI',  'Tarpaulin rope',    'piece'),
  ('SHELTER_NFI',  'Shoe cover',        'pair'),
  ('SHELTER_NFI',  'Bucket',            'piece'),
  ('SHELTER_NFI',  'Mats',              'piece'),
  ('HEALTH',       'First aid kit',     'kit'),
  ('HEALTH',       'ORS (oral rehydration salts)', 'packet'),
  ('HEALTH',       'Anti-malarial',     'tablet'),
  ('PROTECTION',   'Safe space / dignity kit', 'kit'),
  ('PROTECTION',   'Child protection referral', 'case'),
  ('EDUCATION',    'Learning kit',      'kit'),
  ('CASH_VOUCHER', 'Cash transfer',     'NPR'),
  ('CASH_VOUCHER', 'Mobile money voucher','NPR'),
  ('OTHER',        'Other item',        'unit')
ON CONFLICT (category_code, label) DO UPDATE
  SET default_unit = EXCLUDED.default_unit;

-- ---------------------------------------------------------------------------
-- Activity types
-- ---------------------------------------------------------------------------
INSERT INTO app.activity_types (code, label) VALUES
  ('EMERGENCY_DISTRIBUTION','Emergency distribution'),
  ('ASSESSMENT',            'Assessment'),
  ('AWARENESS',             'Community awareness'),
  ('WASH',                  'WASH intervention'),
  ('PROTECTION',            'Protection intervention'),
  ('HEALTH',                'Health intervention'),
  ('EDUCATION',             'Education intervention'),
  ('SHELTER',               'Shelter intervention'),
  ('CASH_VOUCHER',          'Cash / voucher distribution'),
  ('LOGISTICS',             'Logistics support'),
  ('OTHER',                 'Other activity')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

-- ---------------------------------------------------------------------------
-- Location types
--
-- icon names refer to packages/icons (spec 11.7). Shape, not colour, is what
-- carries meaning, so these must survive greyscale printing.
-- ---------------------------------------------------------------------------
INSERT INTO app.location_types (code, label, icon) VALUES
  ('VILLAGE',            'Village / settlement',        'location-village'),
  ('SETTLEMENT',         'Settlement',                  'location-village'),
  ('WARD',               'Ward office',                 'location-ward'),
  ('DISTRIBUTION_POINT', 'Distribution point',          'location-distribution'),
  ('WAREHOUSE',          'Warehouse',                   'location-warehouse'),
  ('HEALTH_FACILITY',    'Health facility',             'location-health'),
  ('SHELTER',            'Shelter',                     'location-shelter'),
  ('EVACUATION_CENTER',  'Evacuation centre',           'location-shelter'),
  ('BRIDGE',             'Bridge',                      'location-bridge'),
  ('WATER_POINT',        'Water point',                 'location-water'),
  ('LOGISTICS_HUB',      'Logistics hub',               'location-hub'),
  ('GOVT_OFFICE',        'Government office',           'location-govt'),
  ('HELIPAD',            'Helipad',                     'location-helipad'),
  ('HOLDING_CENTER',     'Holding centre',              'location-holding'),
  ('OTHER',              'Other',                       'location-other')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, icon = EXCLUDED.icon;

-- ---------------------------------------------------------------------------
-- Primary organisation
--
-- app.organisations_single_primary allows exactly one is_primary row, so this
-- upsert must not fight an existing primary. If one already exists, leave it.
-- ---------------------------------------------------------------------------
INSERT INTO app.organisations (name, short_name, org_type, is_primary)
SELECT 'Plan International Nepal', 'Plan International', 'INGO', true
WHERE NOT EXISTS (SELECT 1 FROM app.organisations WHERE is_primary);

-- Non-primary reference orgs used by the Organisation filter. Not demo data in
-- the is_demo sense: these are real organisation names that appear in every
-- Nepal response, and their presence keeps the filter meaningful.
INSERT INTO app.organisations (name, short_name, org_type)
VALUES
  ('Nepal Red Cross Society',      'Nepal Red Cross', 'NGO'),
  ('United Nations Children''s Fund (UNICEF)', 'UNICEF', 'UN'),
  ('World Food Programme',         'WFP',            'UN'),
  ('Local Government (ward office)','Ward Office',   'GOV')
ON CONFLICT (name) DO UPDATE SET short_name = EXCLUDED.short_name;

COMMIT;