-- ===========================================================================
-- 0002_audit_trigger.sql
--
-- The audit mechanism from spec 8.4 / AD-7: audit rows are written by a
-- database trigger, not by application code. The rationale is that an
-- application-level logger can be bypassed by any code path that simply
-- forgets to call it; a trigger cannot be.
--
-- Two supporting pieces:
--   1. A generic trigger function that diffs OLD/NEW row JSONB.
--   2. An actor-context contract: the API sets app.actor_id and
--      app.request_id at the start of every write transaction, and the trigger
--      reads them with current_setting(..., true).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Generic change-audit function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old      jsonb;
  v_new      jsonb;
  v_changed  jsonb;
  v_record   uuid;
  v_action   text;
  v_actor    uuid;
  v_request  text;
  v_import   uuid;
  c_record_id text[] := ARRAY[
    'id', 'external_id', 'name', 'name_ne', 'access_status', 'status',
    'activity_date', 'as_of_date', 'severity', 'operational_status',
    'quantity', 'unit', 'item_label', 'affected_people', 'affected_households',
    'beneficiaries', 'households_reached', 'verification_status', 'confidence',
    'reason', 'source', 'title', 'description', 'accessibility'
  ];
BEGIN
  -- Resolve the row identity and action per operation type.
  IF TG_OP = 'DELETE' THEN
    v_old    := to_jsonb(OLD);
    v_record := (v_old ->> 'id')::uuid;
    v_action := CASE WHEN v_old ? 'deleted_at' THEN 'DELETE' ELSE 'DELETE' END;
  ELSIF TG_OP = 'INSERT' THEN
    v_new    := to_jsonb(NEW);
    v_record := (v_new ->> 'id')::uuid;
    v_action := 'INSERT';
  ELSE -- UPDATE
    v_old    := to_jsonb(OLD);
    v_new    := to_jsonb(NEW);
    v_record := (v_new ->> 'id')::uuid;
    -- A soft delete is a business event, so it is labelled RESTORE/DELATE on
    -- the deleted_at transition rather than appearing as an ordinary UPDATE.
    IF v_old ? 'deleted_at' AND v_old -> 'deleted_at' IS DISTINCT FROM v_new -> 'deleted_at' THEN
      IF v_new -> 'deleted_at' IS NULL THEN
        v_action := 'RESTORE';
      ELSE
        v_action := 'DELETE';
      END IF;
    ELSE
      v_action := 'UPDATE';
    END IF;
  END IF;

  -- Build the per-field diff. Only on UPDATE, and only for a defined list of
  -- fields the product actually shows in the History tab. Restricting to a
  -- known list keeps the History tab readable and keeps updated_at noise out
  -- (spec 8.4 requires excluding updated_at).
  IF TG_OP = 'UPDATE' AND v_action = 'UPDATE' THEN
    SELECT coalesce(
      jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)),
      '{}'::jsonb
    )
    INTO v_changed
    FROM (
      SELECT jsonb_object_keys(v_new) AS k
    ) keys
    WHERE k = ANY (c_record_id)
      AND v_old -> k IS DISTINCT FROM v_new -> k;

    -- Nothing a human would call a change (e.g. only updated_at moved).
    IF v_changed = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Actor context. The API sets these with:
  --   SET LOCAL app.actor_id = '<uuid>';
  --   SET LOCAL app.request_id = '<request id>';
  -- current_setting(..., true) returns NULL when unset, which is what makes
  -- direct-psql edits still log (with a null actor) rather than fail.
  BEGIN
    v_actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;
  v_request := nullif(current_setting('app.request_id', true), '');
  BEGIN
    v_import := nullif(current_setting('app.import_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_import := NULL;
  END;

  INSERT INTO audit.audit_log (
    occurred_at, actor_id, actor_label, table_name, record_id,
    action, changed_fields, old_row, new_row, import_id, request_id
  ) VALUES (
    now(), v_actor,
    nullif(current_setting('app.actor_label', true), ''),
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_record,
    v_action,
    CASE WHEN TG_OP = 'UPDATE' THEN v_changed ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN v_old ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN v_new ELSE NULL END,
    v_import, v_request
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION audit.log_change() IS
  'Generic audit trigger (spec 8.4 / AD-7). Actor context comes from app.actor_id, app.actor_label, app.request_id, app.import_id session settings set by the API.';

-- ---------------------------------------------------------------------------
-- Attach to every audited table
--
-- ops.* : all operational tables (AD-7).
-- app.users, app.organisations : identity and reference data, so that a role
--   change is auditable. Lookups (app.categories etc.) are configuration
--   tracked in code review; not audited to keep the log signal-rich.
-- audit.audit_log is deliberately NOT audited - that would recurse.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ops.locations',
    'ops.population_records',
    'ops.interventions',
    'ops.distribution_items',
    'ops.road_segments',
    'ops.road_status_history',
    'ops.routes',
    'ops.hazard_areas',
    'ops.reports',
    'ops.attachments',
    'ops.imports',
    'app.users',
    'app.organisations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- %s, not %I: the entries are already schema-qualified, and %I would quote
    -- "ops.locations" as a single identifier instead of two.
    EXECUTE format('DROP TRIGGER IF EXISTS audit_log_change ON %s', t);
    EXECUTE format(
      'CREATE TRIGGER audit_log_change AFTER INSERT OR UPDATE OR DELETE ON %s
       FOR EACH ROW EXECUTE FUNCTION audit.log_change()', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Actor-context helper
--
-- The API calls this at the start of every write transaction instead of
-- setting each GUC by hand. actor_label is denormalised into the log so a
-- deleted user's name survives (audit_log.actor_id is a soft reference).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.set_actor(
  p_actor_id    uuid DEFAULT NULL,
  p_actor_label text DEFAULT NULL,
  p_request_id  text DEFAULT NULL,
  p_import_id   uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actor_id IS NOT NULL THEN
    PERFORM set_config('app.actor_id', p_actor_id::text, true);
  ELSE
    PERFORM set_config('app.actor_id', '', true);
  END IF;
  IF p_actor_label IS NOT NULL THEN
    PERFORM set_config('app.actor_label', p_actor_label, true);
  ELSE
    PERFORM set_config('app.actor_label', '', true);
  END IF;
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('app.request_id', p_request_id, true);
  ELSE
    PERFORM set_config('app.request_id', '', true);
  END IF;
  IF p_import_id IS NOT NULL THEN
    PERFORM set_config('app.import_id', p_import_id::text, true);
  ELSE
    PERFORM set_config('app.import_id', '', true);
  END IF;
END;
$$;

COMMENT ON FUNCTION audit.set_actor(uuid, text, text, uuid) IS
  'Sets actor context for the current transaction (local=true). Call before writes so audit rows are attributable (spec 8.4).';

-- ---------------------------------------------------------------------------
-- Road status history side-effect
--
-- Editing a segment's status must also produce a status-history row (spec 8.2,
-- 15.3). Doing it here rather than in a route handler means a status change
-- cannot be written without its history - the same guarantee as the audit log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.record_road_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old     ops.access_status;
  v_history uuid;
  v_actor   uuid;
BEGIN
  IF NEW.access_status IS NOT DISTINCT FROM OLD.access_status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_old := NULL;
  ELSE
    v_old := OLD.access_status;
  END IF;

  BEGIN
    v_actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;

  INSERT INTO ops.road_status_history (
    road_segment_id, from_status, to_status, reason, source, changed_by
  ) VALUES (
    NEW.id, v_old, NEW.access_status, NEW.reason, NEW.source, v_actor
  ) RETURNING id INTO v_history;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS road_status_change ON ops.road_segments;
CREATE TRIGGER road_status_change AFTER INSERT OR UPDATE OF access_status ON ops.road_segments
  FOR EACH ROW EXECUTE FUNCTION ops.record_road_status_change();

COMMENT ON TRIGGER road_status_change ON ops.road_segments IS
  'Maintains ops.road_status_history for the Access tab, independently of the generic audit log (spec 15.3).';

-- ---------------------------------------------------------------------------
-- Re-assert audit immutability
--
-- init.sql already revokes this, but a database restored from a dump, or one
-- where someone ran GRANT manually, must also end up append-only.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_log FROM PUBLIC, app_rw;
REVOKE ALL ON audit.audit_log FROM tiles_ro;

COMMIT;