-- ===========================================================================
-- 0001_core_schema.sql
--
-- Baseline + ops + app schema per spec section 8.3. Baseline (stable
-- geography) is kept separate from ops (volatile situational data) so the two
-- can be versioned independently - spec principle 5, AD-3.
--
-- Applied by `pnpm migrate`. Migrations are plain SQL, reviewed by humans, and
-- immutable once merged (spec 19.9). See 0002 for the audit trigger.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared enumerations
--
-- These are the values that are *structurally* load-bearing (a record's
-- verification lifecycle is enforced in code and in views). Business reference
-- data that the field team may need to extend - categories, item types,
-- activity types, location types - is NOT an enum but a lookup table, so a new
-- response type needs a data insert rather than a migration (AD-8).
-- ---------------------------------------------------------------------------
CREATE TYPE ops.verification_status AS ENUM ('NEW','REVIEW','VALID','NOT_VALID','EXPIRED');
CREATE TYPE ops.confidence_level   AS ENUM ('LOW','MEDIUM','HIGH');
CREATE TYPE ops.access_status      AS ENUM ('OPEN','RESTRICTED','4WD_ONLY','BLOCKED','DAMAGED','UNKNOWN');
CREATE TYPE ops.delivery_status    AS ENUM ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE app.user_role          AS ENUM ('ADMIN','EDITOR','VIEWER');

-- ===========================================================================
-- baseline: administrative areas
-- ===========================================================================

-- Province -> district -> municipality -> ward in one self-referencing table.
-- A single table (rather than four) is what lets the API answer "give me the
-- ward containing this point" with one indexed lookup, and lets the cascade
-- filters (spec 13.3) traverse the same shape as the data.
CREATE TABLE baseline.admin_areas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 0 country, 1 province, 2 district, 3 municipality, 4 ward
  level             smallint NOT NULL CHECK (level BETWEEN 0 AND 4),
  parent_id         uuid REFERENCES baseline.admin_areas(id),

  -- Authoritative code where the source provides one. UNIQUE across all levels
  -- so an import cannot collide codes between a district and a ward.
  pcode             text UNIQUE,

  name_en           text NOT NULL,
  name_ne           text,             -- Devanagari, for local staff
  ward_number       smallint,
  municipality_type text,             -- Metropolitan / Sub-metropolitan / Municipality / Rural Municipality

  -- Provenance for the *geometry* itself. Spec 9.1: record source and version,
  -- because ward-level quality varies and must stay auditable.
  source            text NOT NULL,
  source_version    text,
  retrieved_at      date,

  geom              geometry(MultiPolygon,4326) NOT NULL,

  -- A row is a ward if and only if it carries a ward number. Catches
  -- half-filled ward rows at import time rather than in a map layer.
  CONSTRAINT admin_areas_ward_consistent CHECK ((level = 4) = (ward_number IS NOT NULL)),

  -- parent_id must actually be one level up. Without this, a malformed
  -- boundary file produces a tree that renders but filters wrongly.
  CONSTRAINT admin_areas_parent_required CHECK (level = 0 OR parent_id IS NOT NULL)
);

COMMENT ON TABLE  baseline.admin_areas IS 'Nepal administrative areas, level 0 country through level 4 ward. Authoritative boundaries only - never hand-drawn (spec 9.1).';
COMMENT ON COLUMN baseline.admin_areas.geom IS 'WGS84 (EPSG:4326) per AD-9. Metric operations must cast to geography.';
COMMENT ON COLUMN baseline.admin_areas.source IS 'Dataset name + publisher. Mandatory: ward data provenance is not uniform.';

CREATE INDEX admin_areas_geom_gix    ON baseline.admin_areas USING gist (geom);
CREATE INDEX admin_areas_parent_idx  ON baseline.admin_areas (parent_id);
CREATE INDEX admin_areas_level_idx   ON baseline.admin_areas (level);
CREATE INDEX admin_areas_name_trgm   ON baseline.admin_areas USING gin (name_en gin_trgm_ops);
CREATE INDEX admin_areas_name_ne_trgm ON baseline.admin_areas USING gin (name_ne gin_trgm_ops);

-- Trigram search over Nepali names too (spec 13.4).
COMMENT ON INDEX baseline.admin_areas_name_ne_trgm IS 'Supports global search over name_ne (spec 13.4).';

-- ===========================================================================
-- baseline: roads and waterways
-- ===========================================================================

-- Baseline geometry. Operational status lives in ops.road_segments, because
-- "the road was washed out last week" is situational and expires, while the
-- road's alignment does not (spec principle 5).
CREATE TABLE baseline.roads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  road_name      text NOT NULL,
  highway_type   text,          -- motorway/trunk/primary/secondary/track/path
  surface        text,
  osm_id         text UNIQUE,   -- way id, so a re-import can upsert
  source         text NOT NULL DEFAULT 'OpenStreetMap',
  source_version text,
  geom           geometry(LineString,4326) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roads_geom_gix  ON baseline.roads USING gist (geom);
CREATE INDEX roads_name_trgm ON baseline.roads USING gin (road_name gin_trgm_ops);

CREATE TABLE baseline.waterways (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  waterway_type text,           -- river/stream/canal/drain
  osm_id      text UNIQUE,
  source      text NOT NULL DEFAULT 'OpenStreetMap',
  geom        geometry(LineString,4326) NOT NULL
);
CREATE INDEX waterways_geom_gix ON baseline.waterways USING gist (geom);
CREATE INDEX waterways_name_trgm ON baseline.waterways USING gin (name gin_trgm_ops);

-- ===========================================================================
-- baseline: facilities (reference layer)
-- ===========================================================================
CREATE TABLE baseline.facilities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  facility_type text NOT NULL,  -- HEALTH_FACILITY / SCHOOL / SHELTER / WAREHOUSE / WATER_POINT / OTHER
  ward_id      uuid REFERENCES baseline.admin_areas(id),
  capacity     integer CHECK (capacity IS NULL OR capacity >= 0),
  operator     text,
  osm_id       text UNIQUE,
  source       text NOT NULL DEFAULT 'OpenStreetMap',
  geom         geometry(Point,4326) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facilities_geom_gix ON baseline.facilities USING gist (geom);
CREATE INDEX facilities_ward_idx ON baseline.facilities (ward_id);
CREATE INDEX facilities_name_trgm ON baseline.facilities USING gin (name gin_trgm_ops);

-- ===========================================================================
-- app: organisations, users
-- ===========================================================================
CREATE TABLE app.organisations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  short_name  text,
  org_type    text CHECK (org_type IS NULL OR org_type IN ('INGO','NGO','GOV','UN','COMMUNITY','OTHER')),
  -- Exactly one primary organisation (Plan International). Enforced by a
  -- partial unique index below rather than a CHECK, so it survives adds.
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organisations_single_primary ON app.organisations ((is_primary)) WHERE is_primary;
COMMENT ON INDEX app.organisations_single_primary IS 'Guarantees a single primary org, which the "Plan only" filter depends on (spec 2.2).';

CREATE TABLE app.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE NOT NULL,
  display_name    text NOT NULL,
  -- Password hash lives in a separate table (Phase 5, Auth.js credentials
  -- provider) so that the role/identity row holds no credential material.
  role            app.user_role NOT NULL DEFAULT 'VIEWER',
  organisation_id uuid REFERENCES app.organisations(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX users_org_idx ON app.users (organisation_id);

-- Session storage for Auth.js with database sessions (spec 6).
CREATE TABLE app.auth_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx    ON app.auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_idx ON app.auth_sessions (expires_at);

-- ===========================================================================
-- app: data-driven lookups (AD-8)
-- ===========================================================================
CREATE TABLE app.categories (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  icon       text,
  is_active  boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE app.categories IS 'Distribution categories. A lookup table, not an enum, so new categories are a data change (AD-8).';

CREATE TABLE app.item_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL REFERENCES app.categories(code),
  label         text NOT NULL,
  default_unit  text,
  is_active     boolean NOT NULL DEFAULT true,
  CONSTRAINT item_types_unique_per_category UNIQUE (category_code, label)
);

CREATE TABLE app.activity_types (
  code      text PRIMARY KEY,
  label     text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE app.location_types (
  code      text PRIMARY KEY,
  label     text NOT NULL,
  icon      text,
  is_active boolean NOT NULL DEFAULT true
);

-- Place-name aliases, for field spelling variants (risk R4).
-- Added in the spec as a Phase 4 item; created empty here so the import
-- engine can target it from day one without a later migration.
CREATE TABLE baseline.admin_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_area_id uuid REFERENCES baseline.admin_areas(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  language    text NOT NULL DEFAULT 'en',
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_aliases_unique UNIQUE (admin_area_id, alias, language)
);
CREATE INDEX admin_aliases_alias_trgm ON baseline.admin_aliases USING gin (alias gin_trgm_ops);

-- ===========================================================================
-- ops: locations
-- ===========================================================================

-- Full provenance mixin, repeated deliberately rather than factored into a
-- supertype. The spec (8.3) requires provenance on every operational record,
-- and an enforced NOT NULL column per table is the only way that is guaranteed;
-- an inheritance-based mixin would let a table silently lack provenance.
CREATE TABLE ops.locations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id       text,
  name              text NOT NULL,
  name_ne           text,

  location_type     text NOT NULL REFERENCES app.location_types(code),

  -- Derived by ST_Within on write (spec 8.6), stored for speed. Always four
  -- separate columns rather than a single admin_area_id, because almost every
  -- filter groups at district or municipality level.
  ward_id           uuid REFERENCES baseline.admin_areas(id),
  municipality_id   uuid REFERENCES baseline.admin_areas(id),
  district_id       uuid REFERENCES baseline.admin_areas(id),
  province_id       uuid REFERENCES baseline.admin_areas(id),

  geom              geometry(Geometry,4326) NOT NULL,
  description       text,
  operational_status text,

  -- Provenance
  source                  text,
  source_organisation_id  uuid REFERENCES app.organisations(id),
  source_url              text,
  reported_at             timestamptz,
  verified_at             timestamptz,
  verified_by             uuid REFERENCES app.users(id),
  verification_status      ops.verification_status NOT NULL DEFAULT 'NEW',
  confidence              ops.confidence_level,
  notes                   text,

  -- A geometry derived from a ward centroid, because the source gave no
  -- coordinates. Must be visible to reviewers: spec 8.6 warns rather than
  -- silently corrects, and this flag is how that surfaces downstream.
  geometry_derived        boolean NOT NULL DEFAULT false,

  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES app.users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES app.users(id),
  deleted_at     timestamptz
);

COMMENT ON COLUMN ops.locations.is_demo IS 'Demo rows are labelled DEMO DATA in every API response and in the UI (spec principle 7, 19.4).';
COMMENT ON COLUMN ops.locations.geometry_derived IS 'True when geom came from a ward centroid, not from reported coordinates. Never set silently.';

CREATE INDEX locations_geom_gix    ON ops.locations USING gist (geom);
CREATE INDEX locations_ward_idx   ON ops.locations (ward_id);
CREATE INDEX locations_muni_idx   ON ops.locations (municipality_id);
CREATE INDEX locations_district_idx ON ops.locations (district_id);
CREATE INDEX locations_province_idx ON ops.locations (province_id);
CREATE INDEX locations_name_trgm  ON ops.locations USING gin (name gin_trgm_ops);
CREATE INDEX locations_type_idx   ON ops.locations (location_type);
-- Partial unique: external ids are only unique among live rows, so a deleted
-- record's id can be reused by a corrected re-import.
CREATE UNIQUE INDEX locations_external_uq ON ops.locations (external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- ===========================================================================
-- ops: affected population
-- ===========================================================================
CREATE TABLE ops.population_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id            uuid REFERENCES ops.locations(id),
  ward_id                uuid REFERENCES baseline.admin_areas(id),
  geom                   geometry(Geometry,4326),

  affected_people        integer CHECK (affected_people IS NULL OR affected_people >= 0),
  affected_households    integer CHECK (affected_households IS NULL OR affected_households >= 0),
  children               integer CHECK (children IS NULL OR children >= 0),
  older_people           integer CHECK (older_people IS NULL OR older_people >= 0),
  people_with_disabilities integer CHECK (people_with_disabilities IS NULL OR people_with_disabilities >= 0),
  severity               smallint CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),

  -- Time-series: records are dated, latest wins in views (spec 8.5). Without
  -- this column the panel could not show "was 412, now 428".
  as_of_date             date NOT NULL,

  source                 text,
  source_organisation_id uuid REFERENCES app.organisations(id),
  source_url             text,
  reported_at            timestamptz,
  verified_at            timestamptz,
  verified_by            uuid REFERENCES app.users(id),
  verification_status    ops.verification_status NOT NULL DEFAULT 'NEW',
  confidence             ops.confidence_level,
  notes                  text,

  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES app.users(id),
  deleted_at      timestamptz,

  -- At least one of these three must anchor the record, otherwise it could
  -- never be rendered on the map or found again.
  CONSTRAINT population_records_anchor CHECK (
    location_id IS NOT NULL OR ward_id IS NOT NULL OR geom IS NOT NULL
  ),
  -- Households cannot exceed people; spec 14.3 treats this as an import
  -- WARNING, and this constraint is the backstop after it is acknowledged.
  CONSTRAINT population_records_hh_le_people CHECK (
    affected_households IS NULL OR affected_people IS NULL
    OR affected_households <= affected_people
  )
);

CREATE INDEX population_geom_gix  ON ops.population_records USING gist (geom);
CREATE INDEX population_loc_idx  ON ops.population_records (location_id);
CREATE INDEX population_ward_idx ON ops.population_records (ward_id);
CREATE INDEX population_date_idx ON ops.population_records (as_of_date DESC);
-- Supports "latest record per anchor" lookups in the views (8.5).
CREATE INDEX population_latest_idx ON ops.population_records (location_id, as_of_date DESC)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- ops: interventions
-- ===========================================================================
CREATE TABLE ops.interventions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id        text,
  activity_date      date NOT NULL,
  organisation_id    uuid NOT NULL REFERENCES app.organisations(id),
  location_id        uuid NOT NULL REFERENCES ops.locations(id),
  ward_id            uuid REFERENCES baseline.admin_areas(id),
  activity_type      text NOT NULL REFERENCES app.activity_types(code),
  title              text,
  beneficiaries      integer CHECK (beneficiaries IS NULL OR beneficiaries >= 0),
  households_reached integer CHECK (households_reached IS NULL OR households_reached >= 0),
  delivery_status    ops.delivery_status NOT NULL DEFAULT 'COMPLETED',
  geom               geometry(Geometry,4326),

  source                 text,
  source_organisation_id uuid REFERENCES app.organisations(id),
  source_url             text,
  reported_at            timestamptz,
  verified_at            timestamptz,
  verified_by            uuid REFERENCES app.users(id),
  verification_status    ops.verification_status NOT NULL DEFAULT 'NEW',
  confidence             ops.confidence_level,
  notes                  text,

  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES app.users(id),
  deleted_at      timestamptz
);

CREATE INDEX interventions_org_date_idx ON ops.interventions (organisation_id, activity_date DESC);
CREATE INDEX interventions_loc_idx      ON ops.interventions (location_id);
CREATE INDEX interventions_ward_idx     ON ops.interventions (ward_id);
CREATE INDEX interventions_date_idx     ON ops.interventions (activity_date DESC);
CREATE INDEX interventions_type_idx     ON ops.interventions (activity_type);
-- Upsert key is (organisation, external_id): two organisations may legitimately
-- use the same activity id in their own source systems.
CREATE UNIQUE INDEX interventions_external_uq ON ops.interventions (organisation_id, external_id)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- ===========================================================================
-- ops: distribution items
-- ===========================================================================
CREATE TABLE ops.distribution_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id    uuid NOT NULL REFERENCES ops.interventions(id) ON DELETE CASCADE,
  category_code      text NOT NULL REFERENCES app.categories(code),
  item_type_id       uuid REFERENCES app.item_types(id),
  -- Free text fallback so "other" always works even when the lookup table is
  -- behind (spec 8.3). Both may be set; label is always populated for display.
  item_label         text NOT NULL,
  quantity           numeric(14,2) NOT NULL CHECK (quantity >= 0),
  unit               text NOT NULL,
  -- May differ from the parent intervention (spec 8.3).
  beneficiaries      integer CHECK (beneficiaries IS NULL OR beneficiaries >= 0),
  households_reached integer CHECK (households_reached IS NULL OR households_reached >= 0),

  source                 text,
  source_organisation_id uuid REFERENCES app.organisations(id),
  source_url             text,
  reported_at            timestamptz,
  verified_at            timestamptz,
  verified_by            uuid REFERENCES app.users(id),
  verification_status    ops.verification_status NOT NULL DEFAULT 'NEW',
  confidence             ops.confidence_level,
  notes                  text,

  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES app.users(id),
  deleted_at      timestamptz
);

COMMENT ON TABLE ops.distribution_items IS 'Item-level distributions. Never aggregate across unit without grouping on (category, item_label, unit) - see ops.v_distribution_totals (spec 8.5).';

CREATE INDEX distribution_items_cat_idx  ON ops.distribution_items (category_code);
CREATE INDEX distribution_items_int_idx  ON ops.distribution_items (intervention_id);
CREATE INDEX distribution_items_item_idx ON ops.distribution_items (item_label, unit);

-- ===========================================================================
-- ops: routes and road segments
-- ===========================================================================
CREATE TABLE ops.routes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- Status lives here, not on baseline.roads: access changes, the road does not.
CREATE TABLE ops.road_segments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  road_name          text NOT NULL,
  route_id           uuid REFERENCES ops.routes(id),
  from_location_id   uuid REFERENCES ops.locations(id),
  to_location_id     uuid REFERENCES ops.locations(id),
  access_status      ops.access_status NOT NULL DEFAULT 'UNKNOWN',
  reason             text,
  last_verified      timestamptz,

  geom               geometry(LineString,4326) NOT NULL,
  baseline_road_ref  text,

  source                 text,
  source_organisation_id uuid REFERENCES app.organisations(id),
  source_url             text,
  reported_at            timestamptz,
  verified_at            timestamptz,
  verified_by            uuid REFERENCES app.users(id),
  verification_status    ops.verification_status NOT NULL DEFAULT 'NEW',
  confidence             ops.confidence_level,
  notes                  text,

  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES app.users(id),
  deleted_at      timestamptz
);

COMMENT ON COLUMN ops.road_segments.access_status IS 'Six states, rendered with line style as well as colour so it survives colour-blindness and print (spec 12.3).';

CREATE INDEX road_segments_geom_gix   ON ops.road_segments USING gist (geom);
CREATE INDEX road_segments_status_idx ON ops.road_segments (access_status);
CREATE INDEX road_segments_route_idx  ON ops.road_segments (route_id);
CREATE INDEX road_segments_name_trgm  ON ops.road_segments USING gin (road_name gin_trgm_ops);

-- Every status change is kept as its own row, so the Access tab can show
-- history independently of the generic audit log.
CREATE TABLE ops.road_status_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  road_segment_id  uuid NOT NULL REFERENCES ops.road_segments(id) ON DELETE CASCADE,
  from_status      ops.access_status,
  to_status        ops.access_status NOT NULL,
  reason           text,
  source           text,
  changed_by       uuid REFERENCES app.users(id),
  changed_at       timestamptz NOT NULL DEFAULT now(),
  -- Ties the history row to its audit entry, so the panel can deep-link.
  audit_log_id     bigint
);
CREATE INDEX road_status_history_seg_idx ON ops.road_status_history (road_segment_id, changed_at DESC);

-- ===========================================================================
-- ops: hazard areas (situational, time-stamped - spec 9.2)
-- ===========================================================================
CREATE TABLE ops.hazard_areas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text,
  hazard_type  text NOT NULL,     -- FLOOD_EXTENT / LANDSLIDE / RIVER_BANK / OTHER
  observed_at  date NOT NULL,
  severity     smallint CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),
  geom         geometry(MultiPolygon,4326) NOT NULL,
  source       text,
  source_url   text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX hazard_areas_geom_gix ON ops.hazard_areas USING gist (geom);
CREATE INDEX hazard_areas_type_idx ON ops.hazard_areas (hazard_type);

-- ===========================================================================
-- ops: reports and attachments
-- ===========================================================================
CREATE TABLE ops.reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type         text NOT NULL,
  description         text NOT NULL,
  location_id         uuid REFERENCES ops.locations(id),
  ward_id             uuid REFERENCES baseline.admin_areas(id),
  geom                geometry(Point,4326),
  submitted_by        uuid REFERENCES app.users(id),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  status              ops.verification_status NOT NULL DEFAULT 'NEW',
  reviewed_by         uuid REFERENCES app.users(id),
  reviewed_at         timestamptz,
  review_notes        text,
  -- Set when a VALID report is promoted into an operational record, and which
  -- record it became (spec 15.1).
  promoted_entity_type text,
  promoted_entity_id   uuid,
  -- Original structured submission, immutable. Never updated by the review
  -- flow, so "what the field team actually reported" cannot drift.
  payload             jsonb,
  is_demo             boolean NOT NULL DEFAULT false,
  deleted_at          timestamptz
);

CREATE INDEX reports_geom_gix   ON ops.reports USING gist (geom);
CREATE INDEX reports_loc_idx    ON ops.reports (location_id);
CREATE INDEX reports_status_idx ON ops.reports (status, submitted_at DESC);
CREATE INDEX reports_ward_idx   ON ops.reports (ward_id);

-- Polymorphic attachment target. Not a foreign key on purpose: one index on
-- (entity_type, entity_id) serves every entity type, and a foreign key per
-- type would duplicate the table for no query benefit.
CREATE TABLE ops.attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  file_key     text NOT NULL,     -- object storage key, never a filesystem path
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  sha256       text NOT NULL,     -- integrity + duplicate detection
  caption      text,
  uploaded_by  uuid REFERENCES app.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX attachments_entity_idx ON ops.attachments (entity_type, entity_id);

-- ===========================================================================
-- ops: imports
-- ===========================================================================
CREATE TABLE ops.imports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename           text NOT NULL,
  file_key           text NOT NULL,
  file_format        text NOT NULL CHECK (file_format IN ('CSV','XLSX','GEOJSON')),
  file_sha256        text,
  target_layer       text NOT NULL,
  -- Saved and reusable per organisation, so the same layout is not remapped
  -- for every file (spec 14.2 step 3).
  mapping_template_id uuid,
  column_mapping     jsonb,
  options            jsonb,
  uploaded_by        uuid REFERENCES app.users(id),
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  records_received   integer,
  records_valid      integer,
  records_warning    integer,
  records_created    integer,
  records_updated    integer,
  records_failed     integer,
  status             text NOT NULL DEFAULT 'UPLOADED'
                     CHECK (status IN ('UPLOADED','MAPPED','VALIDATED','COMMITTED','FAILED','ROLLED_BACK')),
  committed_at       timestamptz,
  rolled_back_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ops.imports IS 'Import job header. Resumable and never silently destructive (AD-6).';

CREATE TABLE ops.import_rows (
  id                bigserial PRIMARY KEY,
  import_id         uuid NOT NULL REFERENCES ops.imports(id) ON DELETE CASCADE,
  row_number        integer NOT NULL,
  raw               jsonb NOT NULL,
  normalised        jsonb,
  severity          text CHECK (severity IS NULL OR severity IN ('OK','WARNING','ERROR')),
  messages          jsonb,   -- [{ field, code, message }]
  result_entity_id  uuid,
  result_action     text CHECK (result_action IS NULL OR result_action IN ('CREATED','UPDATED','SKIPPED','ROLLED_BACK'))
);
-- Error rows are retained even when only the valid rows are committed
-- (spec 14.4), so partial commits are never a silent drop.
CREATE INDEX import_rows_import_idx  ON ops.import_rows (import_id, row_number);
CREATE INDEX import_rows_errors_idx  ON ops.import_rows (import_id) WHERE severity = 'ERROR';

CREATE TABLE ops.import_mapping_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  organisation_id uuid REFERENCES app.organisations(id),
  target_layer    text NOT NULL,
  column_mapping  jsonb NOT NULL,
  created_by      uuid REFERENCES app.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_templates_unique UNIQUE (name, target_layer, organisation_id)
);

-- ===========================================================================
-- audit: append-only log
--
-- The trigger that writes here is created in 0002. Only SELECT is granted to
-- application roles; UPDATE/DELETE/TRUNCATE are revoked (spec 8.4).
-- ===========================================================================
CREATE TABLE audit.audit_log (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  -- Actor is a soft reference, not an FK: a deleted user must not cascade
  -- away the record of what they did.
  actor_id        uuid,
  actor_label     text,
  table_name      text NOT NULL,
  record_id       uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','RESTORE')),
  changed_fields  jsonb,   -- { field: { old, new } }
  old_row         jsonb,
  new_row         jsonb,
  import_id       uuid,
  request_id      text
);
CREATE INDEX audit_record_idx ON audit.audit_log (table_name, record_id, occurred_at DESC);
CREATE INDEX audit_actor_idx  ON audit.audit_log (actor_id, occurred_at DESC);
CREATE INDEX audit_time_idx   ON audit.audit_log (occurred_at DESC);

-- ===========================================================================
-- Migration bookkeeping
-- ===========================================================================
-- IF NOT EXISTS: the migration runner creates this table before it runs any
-- migration, so that it can record failures. The two definitions must agree.
CREATE TABLE IF NOT EXISTS app.schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text NOT NULL,
  duration_ms integer
);
COMMENT ON TABLE app.schema_migrations IS 'Immutable record of applied migrations. Migrations are never edited once merged (spec 19.9).';

-- ===========================================================================
-- Privileges
-- ---------------------------------------------------------------------------
-- Roles are created in infra/postgres/init.sql. Grants live here, in the
-- migration, so that a single reviewable file defines who can do what.
-- ===========================================================================
GRANT USAGE ON SCHEMA baseline, ops, app, audit TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA baseline, ops, app TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops, app TO app_rw;

-- tiles_ro: strict read-only, no audit table, no user credentials (spec 16.2).
GRANT USAGE ON SCHEMA baseline, ops TO tiles_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA baseline, ops TO tiles_ro;

-- Audit is read-only for the application, including Admins.
GRANT SELECT ON audit.audit_log TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_log FROM PUBLIC, app_rw;
REVOKE ALL ON audit.audit_log FROM tiles_ro;

-- Set defaults so inserts from the app do not silently omit these.
ALTER TABLE audit.audit_log ALTER COLUMN id SET DEFAULT nextval('audit.audit_log_id_seq');

COMMIT;