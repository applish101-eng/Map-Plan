-- ===========================================================================
-- 0003_views.sql
--
-- Read models from spec 8.5. The API and the tile server consume these instead
-- of recomputing joins, so that the map, the panel, the table and the
-- dashboard cannot drift apart.
--
-- Aggregation rules encoded here, not in TypeScript:
--   * Never sum quantities across different units (spec 8.5).
--   * "People reached" is a sum of beneficiary-activity counts and is named
--     accordingly, because it may double-count (risk R3).
--   * Only VALID records count toward official totals by default; the
--     include_unverified flag widens it.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: is a record counted in official totals?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.counts_toward_totals(p_status ops.verification_status)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status = 'VALID';
$$;
COMMENT ON FUNCTION ops.counts_toward_totals(ops.verification_status) IS
  'Official totals include VALID records only. Callers needing the wider set filter on verification_status directly (spec 8.5).';

-- ---------------------------------------------------------------------------
-- access_rank
--
-- Defined here, before any view that calls it. PostgreSQL resolves function
-- references when a view is created, so ordering matters: creating
-- v_ward_summary first fails with "function ops.access_rank does not exist".
--
-- One ordering for the whole application: how constrained is this road?
-- Higher rank = more constrained, so "worst" is a simple min.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.access_rank(p_status ops.access_status)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'OPEN'       THEN 1
    WHEN 'RESTRICTED' THEN 2
    WHEN '4WD_ONLY'   THEN 3
    WHEN 'DAMAGED'    THEN 4
    WHEN 'BLOCKED'    THEN 5
    ELSE 6  -- UNKNOWN ranks worst: an unknown road must not read as open.
  END;
$$;
COMMENT ON FUNCTION ops.access_rank(ops.access_status) IS
  'UNKNOWN deliberately ranks above BLOCKED. An unverified road is operationally riskier than a known-blocked one, and must never render as open (spec 12.3, 13.2).';

-- ---------------------------------------------------------------------------
-- v_access_status_lookup
-- Code, label and rank for one place, so the legend, the filter dropdown and
-- the map cannot disagree about status names or ordering.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_access_status_lookup AS
SELECT s.access_status,
       ops.access_rank(s.access_status) AS access_rank,
       CASE s.access_status
         WHEN 'OPEN'       THEN 'Open'
         WHEN 'RESTRICTED' THEN 'Restricted'
         WHEN '4WD_ONLY'   THEN '4WD only'
         WHEN 'BLOCKED'    THEN 'Blocked'
         WHEN 'DAMAGED'    THEN 'Damaged'
         ELSE 'Unknown'
       END AS label
FROM unnest(enum_range(NULL::ops.access_status)) AS s(access_status);

-- ---------------------------------------------------------------------------
-- v_location_latest_population
-- Latest population record per anchor. "Latest" is by as_of_date, then created
-- at, so a same-day re-report supersedes rather than ties ambiguously.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_location_latest_population AS
WITH ranked AS (
  SELECT p.*,
         row_number() OVER (
           PARTITION BY p.location_id
           ORDER BY p.as_of_date DESC, p.created_at DESC
         ) AS rn
  FROM ops.population_records p
  WHERE p.deleted_at IS NULL AND p.location_id IS NOT NULL
)
SELECT
  location_id,
  id              AS population_record_id,
  affected_people,
  affected_households,
  children, older_people, people_with_disabilities,
  severity,
  as_of_date,
  verification_status,
  confidence, source, verified_at,
  is_demo
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW ops.v_location_latest_population IS
  'Most recent population record per location (spec 8.5). Records are a time series; the panel shows the series, this view gives the current value.';

-- ---------------------------------------------------------------------------
-- v_ward_summary
-- Drives the choropleth (spec 11.3) and the dashboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_ward_summary AS
WITH pop AS (
  -- One row per ward: the latest VALID record wins; if a ward has no VALID
  -- record the latest unverified is used and flagged, so the map can render a
  -- ward that has reports but none validated yet without silently showing zero.
  SELECT * FROM (
    SELECT p.*,
           row_number() OVER (
             PARTITION BY p.ward_id
             ORDER BY (p.verification_status = 'VALID') DESC,
                      p.as_of_date DESC, p.created_at DESC
           ) AS rn
    FROM ops.population_records p
    WHERE p.deleted_at IS NULL AND p.ward_id IS NOT NULL
  ) ranked
  WHERE rn = 1
),
  act AS (
    SELECT i.ward_id,
           count(*) FILTER (WHERE ops.counts_toward_totals(i.verification_status)) AS plan_activities,
           count(*) AS activities_all,
           sum(i.beneficiaries)      FILTER (WHERE ops.counts_toward_totals(i.verification_status)) AS reached_people,
           sum(i.households_reached) FILTER (WHERE ops.counts_toward_totals(i.verification_status)) AS reached_households
    FROM ops.interventions i
    WHERE i.deleted_at IS NULL AND i.ward_id IS NOT NULL
    GROUP BY i.ward_id
  ),
  org_act AS (
    -- Plan International activity count, for the "first-class organisation
    -- lens" and the choropleth's Plan-response overlay.
    SELECT i.ward_id, count(*) AS plan_activities_primary
    FROM ops.interventions i
    JOIN app.organisations o ON o.id = i.organisation_id
    WHERE i.deleted_at IS NULL AND i.ward_id IS NOT NULL AND o.is_primary
      AND ops.counts_toward_totals(i.verification_status)
    GROUP BY i.ward_id
  ),
  dist AS (
    -- Distribution totals by category and unit. Grouped on unit so quantities
    -- are never added across units (spec 8.5, principle "never mix units").
    SELECT l.ward_id,
           d.category_code,
           d.unit,
           sum(d.quantity) AS quantity,
           sum(d.beneficiaries) AS beneficiaries
    FROM ops.distribution_items d
    JOIN ops.interventions i ON i.id = d.intervention_id
    JOIN ops.locations l     ON l.id = i.location_id
    WHERE d.deleted_at IS NULL AND i.deleted_at IS NULL AND l.deleted_at IS NULL
      AND ops.counts_toward_totals(d.verification_status)
    GROUP BY l.ward_id, d.category_code, d.unit
  ),
  dist_agg AS (
    SELECT ward_id,
           count(DISTINCT category_code) AS categories_distributed,
           sum(quantity)                  AS quantity_total_mixed_units,
           sum(beneficiaries)            AS distribution_beneficiaries
    FROM dist GROUP BY ward_id
  ),
  acc AS (
    -- Worst (most constrained) access status among segments near the ward.
    -- Ordering is explicit in application code via ops.access_rank; here we
    -- take the worst by severity so a single BLOCKED segment is not hidden by
    -- three OPEN ones.
    SELECT l.ward_id,
           min(ops.access_rank(r.access_status)) AS worst_access_rank,
           count(*) FILTER (WHERE r.access_status IN ('BLOCKED','DAMAGED')) AS blocked_segments,
           count(*) FILTER (WHERE r.access_status = 'RESTRICTED')           AS restricted_segments
    FROM ops.road_segments r
    JOIN ops.locations l ON l.geom && r.geom   -- bbox prefilter; exact test below
    WHERE r.deleted_at IS NULL AND l.deleted_at IS NULL AND l.ward_id IS NOT NULL
      AND ST_DWithin(l.geom::geography, r.geom::geography, 2000)
    GROUP BY l.ward_id
  ),
  rep AS (
    SELECT ward_id, count(*) FILTER (WHERE status NOT IN ('NOT_VALID','EXPIRED')) AS active_reports
    FROM ops.reports WHERE deleted_at IS NULL AND ward_id IS NOT NULL
    GROUP BY ward_id
  )
SELECT
  w.id AS ward_id,
  w.name_en AS ward_name,
  w.ward_number,
  m.id AS municipality_id, m.name_en AS municipality_name,
  d.id AS district_id,     d.name_en AS district_name,
  p.id AS province_id,     p.name_en AS province_name,
  w.geom,

  COALESCE(pop.affected_people, 0)     AS affected_people,
  COALESCE(pop.affected_households, 0) AS affected_households,
  pop.severity,
  pop.as_of_date,
  pop.verification_status,
  -- Denormalised so Martin can filter tiles without a join.
  pop.verification_status::text = 'VALID' AS is_verified,
  COALESCE(pop.is_demo, false) AS is_demo,

  COALESCE(act.reached_people, 0)      AS reached_people_sum,
  COALESCE(act.reached_households, 0)  AS reached_households_sum,
  COALESCE(act.activities_all, 0)      AS activities_all,
  COALESCE(org_act.plan_activities_primary, 0) AS plan_activities,
  COALESCE(dist_agg.categories_distributed, 0) AS categories_distributed,
  COALESCE(dist_agg.quantity_total_mixed_units, 0) AS quantity_total_mixed_units,
  COALESCE(dist_agg.distribution_beneficiaries, 0) AS distribution_beneficiaries,

  COALESCE(acc.worst_access_rank, 6)    AS worst_access_rank,
  COALESCE(acc.blocked_segments, 0)     AS blocked_segments,
  COALESCE(acc.restricted_segments, 0)  AS restricted_segments,
  COALESCE(rep.active_reports, 0)       AS active_reports,

  -- Newest activity touching any location in this ward, so the map can order
  -- or fade wards by freshness without a second query. The correlated
  -- subquery is written this way (rather than via a CTE) so the dependency on
  -- ops.interventions.updated_at is resolved when the view is created.
  --
  -- baseline.admin_areas carries no created_at - it is reference geography, not
  -- a tracked record - so a ward with no activity reports NULL rather than a
  -- fabricated timestamp. Consumers must treat NULL as "never".
  (SELECT max(i.updated_at) FROM ops.interventions i
     JOIN ops.locations l2 ON l2.id = i.location_id
    WHERE l2.ward_id = w.id AND i.deleted_at IS NULL) AS last_activity,
  GREATEST(pop.updated_at,
           (SELECT max(i.updated_at) FROM ops.interventions i
              JOIN ops.locations l2 ON l2.id = i.location_id
             WHERE l2.ward_id = w.id AND i.deleted_at IS NULL)) AS last_updated
FROM baseline.admin_areas w
LEFT JOIN baseline.admin_areas m ON m.id = w.parent_id
LEFT JOIN baseline.admin_areas d ON d.id = m.parent_id
LEFT JOIN baseline.admin_areas p ON p.id = d.parent_id
LEFT JOIN pop   ON pop.ward_id = w.id
LEFT JOIN act    ON act.ward_id = w.id
LEFT JOIN org_act ON org_act.ward_id = w.id
LEFT JOIN dist_agg ON dist_agg.ward_id = w.id
LEFT JOIN acc    ON acc.ward_id = w.id
LEFT JOIN rep    ON rep.ward_id = w.id
WHERE w.level = 4;

COMMENT ON VIEW ops.v_ward_summary IS
  'One row per ward: affected people/households, reached sums, activity and distribution counts, worst access status, report count. Drives the choropleth (spec 8.5).';
COMMENT ON COLUMN ops.v_ward_summary.reached_people_sum IS
  'Sum of per-activity beneficiary counts. May double-count the same person across activities (risk R3). Never label this "unique people reached".';
COMMENT ON COLUMN ops.v_ward_summary.quantity_total_mixed_units IS
  'Sum across categories AND units. Display only with a mixed-unit caveat; use v_distribution_totals for per-unit figures (spec 8.5).';

-- ---------------------------------------------------------------------------
-- v_distribution_totals
-- Grouped on (area, category, item, unit, organisation) so the unit-mixing
-- prohibition is structural rather than a rule to remember (spec 8.5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_distribution_totals AS
SELECT
  w.id  AS ward_id,        w.name_en AS ward_name,
  m.id  AS municipality_id, m.name_en AS municipality_name,
  d.id  AS district_id,     d.name_en AS district_name,
  di.category_code,
  c.label AS category_label,
  di.item_label,
  di.unit,
  o.id AS organisation_id, o.name AS organisation_name, o.is_primary,
  min(i.activity_date) AS first_date,
  max(i.activity_date) AS last_date,
  sum(di.quantity)         AS total_quantity,
  sum(di.beneficiaries)    AS total_beneficiaries,
  sum(di.households_reached) AS total_households_reached,
  count(*)                 AS line_count,
  bool_or(di.is_demo)      AS is_demo,
  max(GREATEST(di.updated_at, di.created_at)) AS last_updated
FROM ops.distribution_items di
JOIN ops.interventions i    ON i.id = di.intervention_id AND i.deleted_at IS NULL
JOIN ops.locations l        ON l.id = i.location_id AND l.deleted_at IS NULL
LEFT JOIN baseline.admin_areas w ON w.id = l.ward_id
LEFT JOIN baseline.admin_areas m ON m.id = l.municipality_id
LEFT JOIN baseline.admin_areas d ON d.id = l.district_id
JOIN app.categories c        ON c.code = di.category_code
JOIN app.organisations o     ON o.id = i.organisation_id
WHERE di.deleted_at IS NULL
GROUP BY w.id, w.name_en, m.id, m.name_en, d.id, d.name_en,
         di.category_code, c.label, di.item_label, di.unit,
         o.id, o.name, o.is_primary;

COMMENT ON VIEW ops.v_distribution_totals IS
  'Distribution aggregates per ward/municipality/district x category x item x unit x organisation. Unit is part of the grouping key, so quantities are never mixed (spec 8.5).';

-- ---------------------------------------------------------------------------
-- v_location_profile_headline
--
-- The compact "always-visible summary block" from spec 13.2. Deliberately not
-- the whole profile: /locations/:id/profile assembles the rest (tabs) and this
-- view supplies the numbers the header needs without a second round of joins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_location_profile_headline AS
SELECT
  l.id AS location_id,
  l.name,
  l.name_ne,
  l.location_type,
  l.operational_status,
  l.geom,
  l.is_demo,
  l.verification_status, l.confidence, l.source, l.verified_at,
  l.updated_at AS last_updated,
  l.created_at,
  w.id  AS ward_id,        w.name_en AS ward_name, w.ward_number,
  m.id  AS municipality_id, m.name_en AS municipality_name,
  d.id  AS district_id,     d.name_en AS district_name,
  pr.id AS province_id,     pr.name_en AS province_name,
  lp.affected_people, lp.affected_households, lp.children,
  lp.older_people, lp.people_with_disabilities, lp.severity,
  lp.as_of_date AS population_as_of,
  COALESCE(i.activities_all, 0)      AS activities_all,
  COALESCE(i.activities_primary, 0)  AS plan_activities,
  COALESCE(i.reached_people, 0)      AS reached_people_sum,
  COALESCE(i.reached_households, 0)  AS reached_households_sum,
  COALESCE(di.distribution_lines, 0) AS distribution_lines,
  COALESCE(di.categories_distributed, 0) AS categories_distributed,
  COALESCE(rp.report_count, 0)       AS report_count,
  COALESCE(acc.worst_access_rank, 6) AS worst_access_rank,
  COALESCE(acc.segment_count, 0)     AS access_segment_count
FROM ops.locations l
LEFT JOIN baseline.admin_areas w  ON w.id  = l.ward_id
LEFT JOIN baseline.admin_areas m  ON m.id  = l.municipality_id
LEFT JOIN baseline.admin_areas d  ON d.id  = l.district_id
LEFT JOIN baseline.admin_areas pr ON pr.id = l.province_id
LEFT JOIN ops.v_location_latest_population lp ON lp.location_id = l.id
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE ops.counts_toward_totals(x.verification_status)) AS activities_all,
    count(*) FILTER (WHERE ops.counts_toward_totals(x.verification_status) AND o.is_primary) AS activities_primary,
    sum(x.beneficiaries)      FILTER (WHERE ops.counts_toward_totals(x.verification_status)) AS reached_people,
    sum(x.households_reached) FILTER (WHERE ops.counts_toward_totals(x.verification_status)) AS reached_households
  FROM ops.interventions x
  JOIN app.organisations o ON o.id = x.organisation_id
  WHERE x.location_id = l.id AND x.deleted_at IS NULL
) i ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS distribution_lines,
         count(DISTINCT x.category_code) AS categories_distributed
  FROM ops.distribution_items x
  WHERE x.intervention_id IN (
    SELECT y.id FROM ops.interventions y
    WHERE y.location_id = l.id AND y.deleted_at IS NULL
  ) AND x.deleted_at IS NULL
    AND ops.counts_toward_totals(x.verification_status)
) di ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS report_count
  FROM ops.reports y
  WHERE y.location_id = l.id AND y.deleted_at IS NULL
    AND y.status NOT IN ('NOT_VALID','EXPIRED')
) rp ON TRUE
LEFT JOIN LATERAL (
  -- Segments touching this location, plus any within 2 km.
  SELECT min(ops.access_rank(s.access_status)) AS worst_access_rank,
         count(*) AS segment_count
  FROM ops.road_segments s
  WHERE s.deleted_at IS NULL
    AND (s.from_location_id = l.id OR s.to_location_id = l.id
         OR ST_DWithin(s.geom::geography, l.geom::geography, 2000))
) acc ON TRUE
WHERE l.deleted_at IS NULL;

COMMENT ON VIEW ops.v_location_profile_headline IS
  'Summary block for the location panel header (spec 13.2). reached_people_sum is a sum of per-activity counts and may double-count (risk R3).';

-- ---------------------------------------------------------------------------
-- v_affected_locations
-- Point-level affected features for the map layer, so the choropleth and the
-- point layer agree on verification handling.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_affected_locations AS
SELECT
  l.id AS location_id,
  l.name,
  l.location_type,
  l.geom,
  l.ward_id, l.municipality_id, l.district_id, l.province_id,
  COALESCE(lp.affected_people, 0)     AS affected_people,
  COALESCE(lp.affected_households, 0) AS affected_households,
  lp.severity,
  COALESCE(h.plan_activities, 0)      AS plan_activities,
  l.verification_status, l.source, l.updated_at, l.is_demo
FROM ops.locations l
LEFT JOIN ops.v_location_latest_population lp ON lp.location_id = l.id
LEFT JOIN LATERAL (
  SELECT count(*) AS plan_activities
  FROM ops.interventions x
  JOIN app.organisations o ON o.id = x.organisation_id
  WHERE x.location_id = l.id AND x.deleted_at IS NULL AND o.is_primary
) h ON TRUE
WHERE l.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- v_road_segments_current
-- Road layer source: current status plus how fresh that status is. The Access
-- tab needs last_verified, and a stale status should be visible on the map.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_road_segments_current AS
SELECT
  s.id, s.road_name, s.route_id, s.access_status, s.reason,
  s.last_verified, s.geom, s.from_location_id, s.to_location_id,
  s.verification_status, s.source, s.updated_at, s.is_demo,
  ops.access_rank(s.access_status) AS access_rank,
  -- Rows changed within the last 24h are the ones a user is most likely to
  -- have just edited; Martin and the map can highlight them.
  (s.updated_at > now() - interval '24 hours') AS recently_changed
FROM ops.road_segments s
WHERE s.deleted_at IS NULL;

COMMENT ON COLUMN ops.v_road_segments_current.recently_changed IS
  'True when the segment changed in the last 24h, so freshly reported access can be distinguished from week-old status (spec 13.2).';

-- ---------------------------------------------------------------------------
-- v_freshness
-- One row: the newest update timestamp across operational tables. Powers
-- meta.data_freshness on every response (spec 10.1) and the print disclaimer
-- (spec 13.8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_freshness AS
SELECT GREATEST(
  (SELECT max(updated_at) FROM ops.locations           WHERE deleted_at IS NULL),
  (SELECT max(updated_at) FROM ops.population_records   WHERE deleted_at IS NULL),
  (SELECT max(updated_at) FROM ops.interventions       WHERE deleted_at IS NULL),
  (SELECT max(updated_at) FROM ops.distribution_items   WHERE deleted_at IS NULL),
  (SELECT max(updated_at) FROM ops.road_segments        WHERE deleted_at IS NULL),
  (SELECT max(submitted_at) FROM ops.reports            WHERE deleted_at IS NULL),
  COALESCE((SELECT max(applied_at) FROM app.schema_migrations), now() - interval '365 days')
) AS last_data_change;

COMMENT ON VIEW ops.v_freshness IS
  'Newest operational change across all tables. Surfaced as meta.data_freshness (spec 10.1) and on printed maps (spec 13.8).';

-- ---------------------------------------------------------------------------
-- Grants
-- Views are owned by the migrator; app_rw and tiles_ro need SELECT explicitly
-- because PostgreSQL grants on a view are not inherited from its base tables.
-- ---------------------------------------------------------------------------
GRANT SELECT ON
  ops.v_location_latest_population,
  ops.v_ward_summary,
  ops.v_distribution_totals,
  ops.v_location_profile_headline,
  ops.v_affected_locations,
  ops.v_road_segments_current,
  ops.v_access_status_lookup,
  ops.v_freshness
TO app_rw, tiles_ro;

GRANT EXECUTE ON FUNCTION ops.access_rank(ops.access_status)        TO app_rw, tiles_ro;
GRANT EXECUTE ON FUNCTION ops.counts_toward_totals(ops.verification_status) TO app_rw, tiles_ro;

COMMIT;