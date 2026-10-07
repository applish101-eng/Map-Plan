-- ===========================================================================
-- nepal-flood-gis :: instance initialisation
--
-- Runs once, on first initialisation of an empty Postgres data directory.
-- Creates extensions, the four schemas (spec AD-3), and least-privilege roles
-- (spec 16.2). Application roles must never own tables, so that the audit
-- trigger in migration 0002 cannot be bypassed by a code path that "forgets
-- to log" (spec AD-7).
-- ===========================================================================

\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- Extensions
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- --------------------------------------------------------------------------
-- Schemas
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS baseline;   -- stable geography (wards, roads, rivers)
CREATE SCHEMA IF NOT EXISTS ops;        -- volatile situational + workflow data
CREATE SCHEMA IF NOT EXISTS app;        -- users, organisations, lookups, config
CREATE SCHEMA IF NOT EXISTS audit;      -- append-only

COMMENT ON SCHEMA baseline IS 'Stable reference geography. Versioned independently of situational data.';
COMMENT ON SCHEMA ops      IS 'Volatile situational data, workflow records and import jobs.';
COMMENT ON SCHEMA app      IS 'Application configuration, identity and data-driven lookups.';
COMMENT ON SCHEMA audit    IS 'Append-only change log. No role may UPDATE or DELETE here.';

-- --------------------------------------------------------------------------
-- Application roles
--
-- NOINHERIT so a session cannot accidentally pick up elevated rights through
-- role inheritance. app_rw / tiles_ro are granted table privileges in
-- migrations, not here, so that migrations remain the single source of truth
-- for privileges.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw   LOGIN PASSWORD 'nepal_dev_pw' NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiles_ro') THEN
    CREATE ROLE tiles_ro LOGIN PASSWORD 'nepal_dev_pw' NOINHERIT;
  END IF;
END
$$;

-- Audit immutability (spec 8.4). The audit log must be append-only for every
-- application role, including admin. Revoked below, re-asserted in migration
-- 0002 so a fresh `migrate` run cannot forget it.
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_log FROM PUBLIC;

-- Read-only role for Martin (spec 5.1).
GRANT CONNECT ON DATABASE nepal_flood_gis TO app_rw, tiles_ro;
GRANT USAGE ON SCHEMA baseline, ops, app TO app_rw, tiles_ro;
GRANT USAGE ON SCHEMA audit TO app_rw;  -- SELECT only; see migration 0002
GRANT USAGE ON SCHEMA public TO app_rw, tiles_ro;